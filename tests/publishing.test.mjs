import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {deploymentPlan,validateBucket,validateAccess,uploadPlan,checkAccessChallenge,cloudflareClient} from '../scripts/publish.mjs';
import {verifyPromotion} from '../scripts/verify-promotion.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'infovore-publish-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const entries={'index.html':'home','resume.html':'resume','manifest.json':'{}','resume.pdf':'pdf',
    'assets/abc-machine.wasm':'wasm','assets/abc-state.bin.zst':'snapshot','assets/abc-initramfs.cpio.gz':'initrd',
    'notes-assets/abc.svg':'<svg/>','licenses/linux.txt':'license'};
  const files=[];
  for(const [path,body] of Object.entries(entries)) {
    await mkdir(join(root,path,'..'),{recursive:true});
    await writeFile(join(root,path),body);
    files.push({path,integrity:'sha256-'+createHash('sha256').update(body).digest('base64'),bytes:body.length});
  }
  await writeFile(join(root,'sw.js'),`const BUILD=${JSON.stringify({version:'test-build',files})};\n`);
  await writeFile(join(root,'_headers'),'Pages-only headers');
  await writeFile(join(root,'assets/abc-machine.wasm.br'),'sidecar');
  await writeFile(join(root,'.env'),'not deployable');
  return root;
}

test('publish only the build inventory, with explicit MIME/cache metadata and sidecars excluded',async t=>{
  const root=await fixture(t),production=await deploymentPlan('production',root),staging=await deploymentPlan('staging',root);
  assert.deepEqual(production.domains,['www.infovore-labs.com','infovore-labs.com']);
  assert.equal(production.files.length,10);
  assert.ok(!production.files.some(file=>['_headers','.env','assets/abc-machine.wasm.br'].includes(file.key)));
  assert.equal(production.files.find(file=>file.key.endsWith('.wasm')).contentType,'application/wasm');
  assert.equal(production.files.find(file=>file.key.endsWith('.zst')).contentType,'application/octet-stream');
  assert.ok(production.files.some(file=>file.key.endsWith('initramfs.cpio.gz')));
  assert.ok(production.files.every(file=>!Object.hasOwn(file,'contentEncoding')));
  assert.equal(production.files.at(-1).key,'sw.js');
  assert.ok(production.files.filter(file=>file.phase===0).every(file=>file.cacheControl.includes('immutable')));
  assert.ok(production.files.filter(file=>file.phase!==0).every(file=>file.cacheControl==='no-cache'));
  assert.ok(staging.files.every(file=>file.cacheControl==='private, no-store'));
  await writeFile(join(root,'index.html'),'changed after build');
  await assert.rejects(deploymentPlan('production',root),/integrity mismatch/);
  await assert.rejects(deploymentPlan('prodution',root),/Choose staging or production/);
});

test('failed asset uploads never publish entry pages or service workers',async t=>{
  const plan=await deploymentPlan('production',await fixture(t)),uploaded=[];
  await assert.rejects(uploadPlan(plan,async file=>{
    uploaded.push(file.key);
    if(file.key.endsWith('.wasm'))throw new Error('R2 failed');
  }),/R2 failed/);
  assert.ok(!uploaded.includes('index.html') && !uploaded.includes('sw.js'));
  const phases=[];
  await uploadPlan(plan,async file=>{phases.push(file.phase);});
  assert.deepEqual(phases,[...phases].sort());
});

test('traversal and duplicate paths fail before upload',async t=>{
  const root=await fixture(t),sw=JSON.parse((await readFile(join(root,'sw.js'),'utf8')).match(/const BUILD=(.*);/)[1]);
  sw.files.unshift({...sw.files[0],path:'../outside'});
  await writeFile(join(root,'sw.js'),`const BUILD=${JSON.stringify(sw)};`);
  await assert.rejects(deploymentPlan('staging',root),/Invalid or duplicate/);
  sw.files[0]=sw.files[1];
  await writeFile(join(root,'sw.js'),`const BUILD=${JSON.stringify(sw)};`);
  await assert.rejects(deploymentPlan('staging',root),/Invalid or duplicate/);
});

test('bucket validation rejects alternate public origins and enabled r2.dev access',()=>{
  const plan={domains:['staging.infovore-labs.com']};
  const custom={domains:[{domain:plan.domains[0],enabled:true}]};
  validateBucket(plan,{enabled:false},custom);
  assert.throws(()=>validateBucket(plan,{enabled:true},custom),/r2.dev/);
  assert.throws(()=>validateBucket(plan,{enabled:false},{domains:[...custom.domains,{domain:'other.example.com',enabled:true}]}),/custom domains/);
});

const accessFixture=()=>({
  plan:{domains:['staging.infovore-labs.com']},
  app:{type:'self_hosted',domain:'staging.infovore-labs.com',allowed_idps:['cf']},
  policies:[{decision:'allow',include:[{email:{email:'owner@example.com'}}]}],
  idps:[{id:'cf',type:'cloudflare',config:{restrict_to_account_members:true}}],
});
test('staging requires Cloudflare account authentication and exactly the owner email policy',()=>{
  const {plan,app,policies,idps}=accessFixture();
  const validate=(a=app,p=policies,i=idps)=>validateAccess(plan,a,p,i,'owner@example.com');
  validate();
  assert.throws(()=>validate({...app,domain:app.domain+'/preview'}),/entire staging/);
  assert.throws(()=>validate({...app,allowed_idps:['cf','otp']}),/only the Cloudflare/);
  assert.throws(()=>validate(app,policies,[{...idps[0],type:'onetimepin'}]),/Cloudflare identity/);
  assert.throws(()=>validate(app,policies,[{...idps[0],config:{restrict_to_account_members:false}}]),/account members/);
  assert.throws(()=>validate(app,[...policies,{decision:'bypass'}]),/Bypass/);
  assert.throws(()=>validate(app,[{decision:'allow',include:[{everyone:{}}]}]),/STAGING_ACCESS_EMAIL/);
});

test('unauthenticated staging responses must challenge or deny, including assets',async()=>{
  const plan={domains:['staging.infovore-labs.com'],files:[{key:'assets/test.wasm'}]};
  const checked=[];
  await checkAccessChallenge(plan,async url=>{
    checked.push(url);
    return new Response(null,{status:302,headers:{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/staging.infovore-labs.com'}});
  });
  assert.ok(checked.some(url=>url.endsWith('.wasm')));
  await assert.rejects(checkAccessChallenge(plan,async()=>new Response('public',{status:200})),/did not require Access/);
  await assert.rejects(checkAccessChallenge(plan,async()=>new Response(null,{status:302,headers:{location:'https://public.example.com'}})),/did not require Access/);
});

test('Cloudflare API errors fail closed without exposing credentials',async()=>{
  const api=cloudflareClient('private-token',async()=>new Response(JSON.stringify({success:false}),{status:403}));
  await assert.rejects(api('accounts/example'),error=>error.message.includes('403') && !error.message.includes('private-token'));
});

test('production promotion accepts only completed main push runs with successful staging',()=>{
  const repository='bootstrap314/site-infovore-labs';
  const run={repository:{full_name:repository},head_repository:{full_name:repository},path:'.github/workflows/site.yml',
    event:'push',head_branch:'main',status:'completed',conclusion:'success',head_sha:'a'.repeat(40)};
  const jobs=[{name:'Publish staging',conclusion:'success'}];
  assert.equal(verifyPromotion(run,jobs,repository),run.head_sha);
  for(const patch of [{event:'pull_request'},{head_branch:'feature'},{conclusion:'failure'},{path:'.github/workflows/other.yml'},
    {head_repository:{full_name:'someone/fork'}}])assert.throws(()=>verifyPromotion({...run,...patch},jobs,repository));
  assert.throws(()=>verifyPromotion(run,[{name:'Publish staging',conclusion:'skipped'}],repository),/did not successfully/);
});

test('staging unregisters only this site’s cache; public hosts still register offline support',async()=>{
  const source=await readFile('src/offline.js','utf8');
  for(const hostname of ['staging.infovore-labs.com','www.infovore-labs.com','infovore-labs.com','localhost']) {
    const scope=`https://${hostname}/`,calls=[];
    const registration={scope,unregister:async()=>calls.push('unregister'),update:async()=>{}};
    const caches={keys:async()=>[`personal-space:${scope}:old`,'unrelated'],delete:async name=>calls.push(name)};
    const window={isSecureContext:true,caches};
    const context={window,location:{hostname},document:{readyState:'complete'},URL,caches,setTimeout,clearTimeout,
      navigator:{serviceWorker:{getRegistration:async()=>registration,register:async()=>{calls.push('register');return registration;}}}};
    vm.runInNewContext(source.replaceAll('import.meta.url',JSON.stringify(scope+'assets/offline.js')),context);
    await window.refreshSiteCache();
    assert.deepEqual(calls,hostname.startsWith('staging.') ? ['unregister',`personal-space:${scope}:old`] : ['register']);
  }
});
