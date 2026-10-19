import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve, extname} from 'node:path';
import {pathToFileURL} from 'node:url';

const execute=promisify(execFile);
const config=JSON.parse(await readFile(new URL('../deploy/cloudflare/config.json',import.meta.url),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('base64');
const immutable=key=>/^(assets|notes-assets|projects-assets)\//.test(key);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml',
  '.png':'image/png','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.gz':'application/gzip'};

export async function deploymentPlan(environment,root='dist') {
  if(!Object.hasOwn(config,environment))throw new Error('Choose staging or production.');
  const sw=await readFile(resolve(root,'sw.js'),'utf8');
  const match=sw.match(/^const BUILD=(\{.*\});$/m);
  if(!match)throw new Error('Missing offline build inventory. Run make build.');
  const build=JSON.parse(match[1]);
  if(!Array.isArray(build.files) || !build.files.length)throw new Error('Empty build inventory.');
  const seen=new Set();
  const files=[];
  // Publish only the integrity-checked inventory. _headers is a Pages convention;
  // R2 uses object metadata. Compression sidecars are handled by the CDN instead.
  for(const file of [...build.files,{path:'sw.js',integrity:'sha256-'+digest(sw)}]) {
    const key=file.path;
    if(typeof key!=='string' || !/^[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').some(part=>!part || part.startsWith('.')) || seen.has(key)) {
      throw new Error(`Invalid or duplicate deployment path: ${key}`);
    }
    seen.add(key);
    const bytes=await readFile(resolve(root,key));
    if(file.integrity!=='sha256-'+digest(bytes))throw new Error(`Build integrity mismatch: ${key}`);
    files.push({key,path:resolve(root,key),bytes:bytes.length,sha256:digest(bytes),
      contentType:types[extname(key)] || 'application/octet-stream',
      cacheControl:environment==='staging' ? 'private, no-store' : immutable(key) ? 'public, max-age=31536000, immutable' : 'no-cache',
      phase:immutable(key) ? 0 : ['index.html','resume.html'].includes(key) ? 2 : key==='sw.js' ? 3 : 1});
  }
  for(const key of ['index.html','resume.html','manifest.json','sw.js'])if(!seen.has(key))throw new Error(`Missing ${key}`);
  files.sort((a,b)=>a.phase-b.phase || a.key.localeCompare(b.key));
  return {environment,...config[environment],version:build.version,files};
}

export function validateBucket(plan,managed,custom) {
  if(managed.enabled!==false)throw new Error('Disable the bucket’s public r2.dev URL before publishing.');
  const active=custom.domains.filter(domain=>domain.enabled).map(domain=>domain.domain).sort();
  if(JSON.stringify(active)!==JSON.stringify([...plan.domains].sort())) {
    throw new Error('Bucket custom domains do not match deploy/cloudflare/config.json. Remove alternate public hostnames.');
  }
}

export function validateAccess(plan,app,policies,idps,email) {
  if(app.type!=='self_hosted' || app.domain!==plan.domains[0])throw new Error('Access must protect the entire staging hostname, with no path restriction.');
  if(app.allow_authenticate_via_warp || app.options_preflight_bypass)throw new Error('Disable WARP authentication and preflight bypass for this staging app.');
  if(app.allowed_idps?.length!==1)throw new Error('Select only the Cloudflare identity provider for staging.');
  const idp=idps.find(provider=>provider.id===app.allowed_idps[0]);
  if(idp?.type!=='cloudflare' || idp.config?.restrict_to_account_members!==true) {
    throw new Error('Staging requires the Cloudflare identity provider restricted to account members.');
  }
  const allow=policies.filter(policy=>policy.decision==='allow');
  if(allow.length!==1 || policies.some(policy=>!['allow','deny'].includes(policy.decision))) {
    throw new Error('Use one email Allow policy and no Bypass or Service Auth policies for staging.');
  }
  const includes=allow[0].include;
  if(includes?.length!==1 || includes[0].email?.email?.toLowerCase()!==email.toLowerCase()) {
    throw new Error('The staging Allow policy must include only STAGING_ACCESS_EMAIL.');
  }
}

export function cloudflareClient(token,request=fetch) {
  return async function api(path,body) {
    const response=await request(`https://api.cloudflare.com/client/v4/${path}`,{
      method:body ? 'POST' : 'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30000),redirect:'error',
    });
    const data=await response.json();
    if(!response.ok || data.success!==true)throw new Error(`Cloudflare API request failed (${response.status}) for ${path}. Check token permissions and configuration.`);
    return data.result;
  };
}

export async function checkAccessChallenge(plan,request=fetch) {
  // Access should challenge even a key that does not yet exist in an empty bucket.
  for(const key of ['', 'index.html', 'sw.js', plan.files.find(file=>immutable(file.key)).key]) {
    const response=await request(`https://${plan.domains[0]}/${key}`,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});
    const location=response.headers.get('location');
    const login=location && new URL(location,response.url || `https://${plan.domains[0]}`).hostname.endsWith('.cloudflareaccess.com');
    if(!([301,302,303,307,308].includes(response.status) && login) && ![401,403].includes(response.status)) {
      throw new Error(`Staging did not require Access authentication for /${key}. Check the Access policy and routing.`);
    }
  }
}

export async function uploadPlan(plan,put) {
  // A failed asset upload cannot publish new HTML or activate the service worker.
  // Keep older assets: open tabs and previous offline caches still reference them.
  for(const phase of [0,1,2,3]) {
    const files=plan.files.filter(file=>file.phase===phase);
    for(let offset=0;offset<files.length;offset+=4) {
      const results=await Promise.allSettled(files.slice(offset,offset+4).map(put));
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
    }
  }
}

export async function publish(plan,env=process.env) {
  const required=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_ZONE_ID','CLOUDFLARE_API_TOKEN','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'];
  if(plan.environment==='staging')required.push('CLOUDFLARE_ACCESS_APP_ID','STAGING_ACCESS_EMAIL');
  for(const name of required)if(!env[name])throw new Error(`Set ${name}; see deploy/cloudflare/README.md.`);
  for(const name of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_ZONE_ID'])if(!/^[a-f0-9]{32}$/i.test(env[name]))throw new Error(`Invalid ${name}.`);
  const aws=env.AWS || 'aws';
  try {
    const {stdout}=await execute(aws,['--version']);
    if(!stdout.startsWith('aws-cli/2.'))throw new Error('Wrong CLI version');
  } catch {throw new Error('Install AWS CLI v2 to upload to R2.');}
  const api=cloudflareClient(env.CLOUDFLARE_API_TOKEN);
  const account=`accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const bucket=`${account}/r2/buckets/${plan.bucket}/domains`;
  const [managed,custom]=await Promise.all([api(`${bucket}/managed`),api(`${bucket}/custom`)]);
  validateBucket(plan,managed,custom);
  if(plan.environment==='staging') {
    const application=`${account}/access/apps/${encodeURIComponent(env.CLOUDFLARE_ACCESS_APP_ID)}`;
    const [app,policies,idps]=await Promise.all([api(application),api(`${application}/policies`),api(`${account}/access/identity_providers`)]);
    validateAccess(plan,app,policies,idps,env.STAGING_ACCESS_EMAIL);
    await checkAccessChallenge(plan);
  }
  const endpoint=`https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  await uploadPlan(plan,async file=>{
    try {
      await execute(aws,['s3api','put-object','--endpoint-url',endpoint,'--region','auto',
        '--bucket',plan.bucket,'--key',file.key,'--body',file.path,'--content-type',file.contentType,
        '--cache-control',file.cacheControl,'--metadata',`sha256=${file.sha256}`,'--no-cli-pager'],{
        env:{...env,AWS_REQUEST_CHECKSUM_CALCULATION:'WHEN_REQUIRED',AWS_RESPONSE_CHECKSUM_VALIDATION:'WHEN_REQUIRED'},
        timeout:120000,maxBuffer:1024*1024,
      });
    } catch {throw new Error(`R2 upload failed for ${file.key}. Check bucket-scoped credentials and retry the same artifact.`);}
    console.log(`Uploaded ${file.key}`);
  });
  // Immutable paths are never purged. Fixed entry URLs and documents must update.
  const urls=plan.domains.flatMap(host=>['',...plan.files.filter(file=>!immutable(file.key)).map(file=>file.key)].map(key=>`https://${host}/${key}`));
  for(let offset=0;offset<urls.length;offset+=30)await api(`zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,{files:urls.slice(offset,offset+30)});
  if(plan.environment==='staging')await checkAccessChallenge(plan);
  else {
    for(const host of plan.domains) {
      for(const key of ['', 'sw.js']) {
        const file=plan.files.find(file=>file.key===(key || 'index.html'));
        const response=await fetch(`https://${host}/${key}`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok || digest(Buffer.from(await response.arrayBuffer()))!==file.sha256) {
          throw new Error(`Published bytes did not match at https://${host}/${key}. Check the root rewrite and cache rules; retry after propagation.`);
        }
      }
    }
  }
  console.log(`Published ${plan.version} to ${plan.domains.map(host=>'https://'+host).join(', ')}`);
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [environment,...flags]=process.argv.slice(2);
    if(flags.some(flag=>flag!=='--dry-run'))throw new Error('Usage: node scripts/publish.mjs staging|production [--dry-run]');
    const plan=await deploymentPlan(environment);
    if(flags.includes('--dry-run'))console.log(JSON.stringify(plan,null,2));
    else await publish(plan);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
