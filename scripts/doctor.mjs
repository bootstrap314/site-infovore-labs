import {execFileSync} from 'node:child_process';
import {zstdCompressSync} from 'node:zlib';
let failed=false;
function report(ok,label,detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${detail}`);
  failed ||= !ok;
}
function command(label,file,args,hint,accept=()=>true) {
  try {
    const output=execFileSync(file,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim();
    const ok=accept(output);report(ok,label,ok ? output.split('\n')[0] : hint);
  } catch {report(false,label,hint);}
}
report(Number(process.versions.node.split('.')[0])>=24 && typeof zstdCompressSync==='function','Node',process.version+' (24+ with zstd required)');
command('npm',process.env.NPM || 'npm',['--version'],'Install npm alongside Node.js.');
command('Go',process.env.GO || 'go',['version'],'Install Go 1.22+ to build termtex.',output=>{
  const [,major,minor]=output.match(/go(\d+)\.(\d+)/) || [];
  return Number(major)>1 || (Number(major)===1 && Number(minor)>=22);
});
const docker=process.env.DOCKER || 'docker';
command('Docker',docker,['info','--format','{{.ServerVersion}}'],'Install/start Docker Desktop, OrbStack, or a Docker daemon.');
command('Compose',docker,['compose','version'],'Install the Docker Compose plugin.');
try {
  const {chromium}=await import('playwright');
  const channel=process.env.CHROME_CHANNEL || 'chrome';
  const browser=await chromium.launch({channel,headless:true,timeout:10000});
  report(true,'Browser',`${channel} ${browser.version()}`);await browser.close();
} catch(error) {
  report(false,'Browser',error.code==='ERR_MODULE_NOT_FOUND' ? 'Run make setup to install the locked dependencies, then retry.' : 'Install Chrome, or run make browser-install and use CHROME_CHANNEL=chromium.');
}
console.log(failed ? '\nResolve the failed checks, then run make doctor again.' : '\nReady. Run make build, then make serve (or make preview for both).');
process.exitCode=failed ? 1 : 0;
