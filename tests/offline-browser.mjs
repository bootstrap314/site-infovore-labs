import assert from 'node:assert/strict';
import http from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildOffline } from '../scripts/offline.mjs';

await mkdir('.test-results',{recursive:true});
const root=resolve(await mkdtemp('.test-results/offline-'));
await cp('dist',root,{recursive:true});
// An isolated origin tests deployment changes without touching the user's site.
const prefix='/personal/',requests=[],results=[];
let broken=false;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml','.pdf':'application/pdf'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
  if(!url.pathname.startsWith(prefix))return res.writeHead(404).end();
  const relative=decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file=resolve(root,relative);
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  if(broken && relative==='resume.pdf')return res.writeHead(200,{'Content-Type':'application/pdf'}).end('incomplete deployment');
  try {
    let bytes=await readFile(file);
    const headers={'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache','Vary':'Accept-Encoding'};
    if(req.headers['accept-encoding']?.includes('br')) {
      try {bytes=await readFile(file+'.br');headers['Content-Encoding']='br';} catch {}
    }
    res.writeHead(200,headers).end(bytes);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}${prefix}`;
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const ready=page=>page.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
const build=async()=>JSON.parse((await readFile(`${root}/sw.js`,'utf8')).match(/const BUILD=(.*);/)[1]);
const update=page=>page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.getRegistration();
  let worker;
  const found=()=>{worker=registration.installing;};
  registration.addEventListener('updatefound',found);
  try {await registration.update();}
  finally {registration.removeEventListener('updatefound',found);}
  worker ||= registration.installing;
  if(!worker)return 'unchanged';
  if(['activated','redundant'].includes(worker.state))return worker.state;
  return new Promise(resolve=>worker.addEventListener('statechange',()=>{
    if(['activated','redundant'].includes(worker.state))resolve(worker.state);
  }));
});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'#shell');await ready(page);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  const first=await build();
  const cacheName=`personal-space:${base}:${first.version}`;
  const cached=await page.evaluate(async name=>(await (await caches.open(name)).keys()).map(request=>request.url),cacheName);
  assert.equal(cached.length,first.files.length);
  assert.ok(cached.some(url=>url.endsWith('initramfs.cpio.gz')),'Cold boot initramfs is cached');
  assert.ok(!cached.some(url=>url.endsWith('.br') || url.endsWith('.js.gz')),'No duplicate compression sidecars');
  await context.setOffline(true);
  const fromWorker=[];
  page.on('response',response=>{if(response.fromServiceWorker())fromWorker.push(response.url());});
  await page.reload();await ready(page);
  assert.equal(await page.evaluate(()=>window.siteMetrics.mode),'snapshot');
  assert.ok(fromWorker.some(url=>url.endsWith('state.bin.zst')));
  assert.ok(fromWorker.some(url=>url.endsWith('.wasm')));
  const failures=await page.evaluate(async files=>{
    const failures=[];
    for(const file of files) {
      const response=await fetch(file.path);
      const data=await response.arrayBuffer();
      const hash=await crypto.subtle.digest('SHA-256',data);
      const integrity='sha256-'+btoa(String.fromCharCode(...new Uint8Array(hash)));
      if(!response.ok || integrity!==file.integrity)failures.push(file.path);
    }
    return failures;
  },first.files);
  assert.deepEqual(failures,[],'Every shipped resource remains readable offline with matching bytes');
  await page.goto(base+'?cold#shell');await ready(page);
  assert.equal(await page.evaluate(()=>window.siteMetrics.mode),'cold');
  await page.keyboard.type("find /notes -name '*.md' | wc -l");await page.keyboard.press('Enter');
  await page.locator('.xterm-accessibility-tree').getByText('2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'04 Notes'}).click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===3);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>window.siteMetrics.identity.selectedNote===1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===1);
  await page.screenshot({path:'.test-results/architecture-terminal.png'});
  await page.keyboard.press('d');
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.diagramAscii===0);
  for(let n=0;n<20 && !await page.evaluate(()=>window.siteMetrics.imageStorage>0);n++) {
    const previous=await page.evaluate(()=>window.siteMetrics.identity.readerPage);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(n=>window.siteMetrics.renderedIdentity.readerPage>n,previous);
  }
  assert.ok(await page.evaluate(()=>window.siteMetrics.imageStorage>0),'Architecture diagram renders in the terminal');
  await page.screenshot({path:'.test-results/architecture-diagram.png'});
  await page.getByRole('button',{name:'Read as text'}).click();
  await page.locator('#text-view').getByRole('heading',{name:'How this site works',exact:true}).first().waitFor();
  assert.ok(await page.locator('#text-view [data-text-note="1"] img').count()>=4);
  for(const image of await page.locator('#text-view [data-text-note="1"] img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(image=>image.decode());
  }
  assert.equal(await page.locator('#text-view [data-text-note="1"] img').evaluateAll(images=>images.every(image=>image.complete && image.naturalWidth>0)),true);
  const mobile=await context.newPage();
  await mobile.setViewportSize({width:320,height:740});
  await mobile.goto(base);await ready(mobile);
  await mobile.locator('[data-page="3"]').click();
  await mobile.waitForFunction(()=>window.siteMetrics.identity.page===3);
  await mobile.locator('#note-next').click();await mobile.locator('#note-open').click();
  await mobile.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===1);
  await mobile.locator('[data-note="diagrams"]').click();
  await mobile.waitForFunction(()=>window.siteMetrics.renderedIdentity?.diagramAscii===0);
  for(let n=0;n<30 && !await mobile.evaluate(()=>window.siteMetrics.imageStorage>0);n++) {
    const previous=await mobile.evaluate(()=>window.siteMetrics.identity.readerPage);
    await mobile.locator('#note-next').click();
    await mobile.waitForFunction(n=>window.siteMetrics.renderedIdentity.readerPage>n,previous);
  }
  assert.ok(await mobile.evaluate(()=>window.siteMetrics.imageStorage>0));
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.screenshot({path:'.test-results/architecture-mobile.png'});
  await mobile.close();await page.bringToFront();
  await page.goto(base+'resume.html');
  await page.getByRole('heading',{name:'William Michael Turner',exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>new TextDecoder().decode((await (await fetch('resume.pdf')).arrayBuffer()).slice(0,5))),'%PDF-');
  assert.equal(await page.evaluate(async()=>{try {await fetch('missing-file');return 'unexpected response';} catch {return 'unavailable';}}),'unavailable');
  results.push({test:'complete offline cache, hashed bytes, snapshot and cold boot, real shell, architecture note and images, standalone résumé and PDF, subdirectory hosting',passed:true});

  await context.setOffline(false);
  await page.goto(base+'#shell');await ready(page);
  await page.keyboard.type('KEEP=offline_update');await page.keyboard.press('Enter');
  const session=await page.evaluate(()=>({start:window.siteMetrics.sessionStarted,pid:window.siteMetrics.identity.shellPid}));
  await writeFile(`${root}/index.html`,(await readFile(`${root}/index.html`,'utf8')).replace('</head>','<meta name="offline-test-build" content="second"></head>'));
  const second=await buildOffline(root);
  assert.equal(await update(page),'activated');
  assert.deepEqual(await page.evaluate(()=>({start:window.siteMetrics.sessionStarted,pid:window.siteMetrics.identity.shellPid})),session);
  assert.equal(await page.locator('meta[name="offline-test-build"]').count(),0,'No automatic page reload');
  await page.keyboard.type('echo "$KEEP"');await page.keyboard.press('Enter');
  await page.locator('.xterm-accessibility-tree').getByText('offline_update',{exact:true}).waitFor();
  await page.reload();await ready(page);
  assert.equal(await page.locator('meta[name="offline-test-build"]').getAttribute('content'),'second');

  await writeFile(`${root}/index.html`,(await readFile(`${root}/index.html`,'utf8')).replace('content="second"','content="broken"'));
  const third=await buildOffline(root);
  broken=true;
  assert.equal(await update(page),'redundant','Integrity failure rejects incomplete release');
  const cacheKeys=await page.evaluate(()=>caches.keys());
  assert.ok(cacheKeys.includes(`personal-space:${base}:${second.version}`));
  assert.ok(!cacheKeys.includes(`personal-space:${base}:${third.version}`));
  await context.setOffline(true);
  await page.reload();await ready(page);
  assert.equal(await page.locator('meta[name="offline-test-build"]').getAttribute('content'),'second');
  results.push({test:'atomic update without resetting an active shell, next navigation uses new build, invalid deployment retains previous complete offline build',passed:true});
  assert.deepEqual(errors,[]);
  await context.close();

  const blocked=await browser.newContext({serviceWorkers:'block'});
  const plain=await blocked.newPage();
  await plain.goto(base);await ready(plain);
  assert.equal(await plain.evaluate(()=>navigator.serviceWorker.controller),null);
  results.push({test:'site still starts when service workers are blocked',passed:true});
  await blocked.close();
  console.log(JSON.stringify(results,null,2));
  await writeFile('.test-results/offline-browser.json',JSON.stringify(results,null,2)+'\n');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(root,{recursive:true,force:true});
}
