import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {deploymentPlan} from '../scripts/publish.mjs';

// Exercise actual HTTP caching, independently of the public offline worker.
// The local gate stands in for Access; live Access is checked by the publisher.
const plan=await deploymentPlan('staging');
const files=new Map(await Promise.all(plan.files.map(async file=>[file.key,{...file,body:await readFile(file.path)}])));
const manifest=JSON.parse(files.get('manifest.json').body);
const requests=[];
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  const key=pathname==='/'?'index.html':pathname.slice(1);
  const authenticated=/(?:^|;\s*)staging-test-auth=yes(?:;|$)/.test(request.headers.cookie || '');
  if(!authenticated) {
    requests.push({key,status:403,bytes:0});
    response.writeHead(403,{'Content-Type':'text/html','Cache-Control':'private, no-store'}).end('<h1>Login required</h1>');
    return;
  }
  const file=files.get(key);
  if(!file) {response.writeHead(404).end();return;}
  requests.push({key,status:200,bytes:file.body.length});
  response.writeHead(200,{'Content-Type':file.contentType,'Cache-Control':file.cacheControl,'Content-Length':file.body.length});
  response.end(file.body);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
const page=await context.newPage();
const bytes=entries=>entries.reduce((sum,entry)=>sum+entry.bytes,0);
try {
  assert.equal((await page.goto(base)).status(),403);
  await context.addCookies([{name:'staging-test-auth',value:'yes',url:base,httpOnly:true,sameSite:'Lax'}]);
  let start=requests.length;
  await page.goto(base);await page.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
  const first=requests.slice(start);
  for(const key of [manifest.snapshot,manifest.wasm])assert.ok(first.some(request=>request.key===key && request.status===200),`Initial download: ${key}`);
  start=requests.length;
  await page.reload();await page.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
  const repeat=requests.slice(start);
  assert.ok(repeat.some(request=>request.key==='index.html' && request.status===200),'Entry page reaches the authentication gate on reload');
  for(const key of [manifest.snapshot,manifest.wasm])assert.ok(!repeat.some(request=>request.key===key),`Reused from the browser cache: ${key}`);
  assert.ok(bytes(repeat)<bytes(first)/10,'Repeat visits avoid the large static downloads');
  await context.clearCookies();
  assert.equal((await page.goto(base)).status(),403,'A warmed browser must authenticate again after logout');
  await page.getByRole('heading',{name:'Login required'}).waitFor();
  assert.equal(await page.evaluate(()=>Boolean(window.siteMetrics?.ready)),false);
  const assetStatus=await page.evaluate(async url=>(await fetch(url,{cache:'reload'})).status,base+'/'+manifest.snapshot);
  assert.equal(assetStatus,403,'Network requests for assets remain protected after logout');
  const anonymous=await browser.newContext(),other=await anonymous.newPage();
  assert.equal((await other.goto(base+'/'+manifest.snapshot)).status(),403,'Cached files are not exposed to another browser profile');
  await anonymous.close();
  const result={firstOriginBytes:bytes(first),repeatOriginBytes:bytes(repeat),snapshotAndWasmReused:true,entryReauthenticated:true,loggedOutDenied:true,anonymousAssetDenied:true};
  await mkdir('.test-results',{recursive:true});
  await writeFile('.test-results/staging-cache-browser.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {
  await browser.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
