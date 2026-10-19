import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:'dark'});
const page=await context.newPage(),results=[],errors=[],external=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
const ready=target=>target.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
const section=(target,index)=>target.waitForFunction(n=>window.siteMetrics.renderedIdentity?.page===n,index);
const position=async(target,index)=>{
  await target.waitForFunction(n=>window.siteMetrics.renderedIdentity?.readerPage===n,index);
  const pages=await target.evaluate(()=>window.siteMetrics.renderedIdentity.readerPages);
  await target.locator('.xterm-accessibility-tree').getByText(new RegExp(`\\b${index+1}/${pages}\\b`)).waitFor();
};
const screen=()=>page.locator('.xterm-accessibility-tree');
const prompt=()=>screen().getByText(/^personal:\/notes#\s*$/).last().waitFor();
await mkdir('.test-results',{recursive:true});
try {
  await page.goto(base+'/#projects');await ready(page);await section(page,4);
  assert.equal(await page.locator('[data-page]').count(),7);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  await screen().getByText(/Engineering ac-man/).waitFor();
  await page.screenshot({path:'.test-results/projects-index.png'});
  await page.keyboard.press('ArrowRight');await section(page,5);
  await page.keyboard.press('ArrowLeft');await section(page,4);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  assert.equal(await page.locator('#post-repository').isVisible(),true);
  const session=await page.evaluate(()=>window.siteMetrics.sessionStarted);
  await context.route('https://github.com/bootstrap314/ac-man',route=>route.fulfill({contentType:'text/html',body:'<title>Project link test</title>'}));
  const popupPromise=page.waitForEvent('popup');
  await page.locator('#post-repository').click();
  const popup=await popupPromise;await popup.waitForLoadState();
  assert.equal(popup.url(),'https://github.com/bootstrap314/ac-man');
  await popup.close();await page.bringToFront();
  assert.equal(await page.evaluate(()=>window.siteMetrics.sessionStarted),session);
  await page.locator('.xterm-helper-textarea').focus();
  const pages=await page.evaluate(()=>window.siteMetrics.identity.readerPages);
  let text='',sawImage=false;
  for(let n=0;n<pages;n++) {
    await position(page,n);
    text+=await screen().innerText();
    if(!sawImage && await page.evaluate(()=>window.siteMetrics.imageStorage>0)) {
      assert.match(await screen().innerText(),/menu-bar panel/,'Screenshot shares its terminal page with the app description');
      sawImage=true;await page.screenshot({path:'.test-results/projects-diagram.png'});
    }
    if(n+1<pages)await page.keyboard.press('PageDown');
  }
  assert.match(text,/SmartHome/);assert.match(text,/readback/);assert.match(text,/provenance|notarization/);
  assert.ok(sawImage,'Project diagram decoded inside xterm');
  await page.keyboard.press('Home');await position(page,0);
  await page.keyboard.press('PageDown');await position(page,1);
  await page.keyboard.press('4');await section(page,3);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  await page.keyboard.press('PageDown');await position(page,1);
  await page.keyboard.press('5');await section(page,4);await position(page,1);
  await screen().getByText(/Engineering ac-man/).waitFor();
  await page.keyboard.press('4');await section(page,3);await position(page,1);
  await screen().getByText(/A small machine/).first().waitFor();
  console.log('Checkpoint passed');results.push('Projects route, seven-page navigation, complete post pagination, terminal diagrams, and independent Notes/Projects reading positions');

  await page.locator('[data-page="4"]').click();await section(page,4);
  await page.locator('#text-toggle').click();
  assert.equal(await page.locator('[data-text-page]:visible').count(),1);
  assert.equal(await page.locator('[data-text-project]:visible').count(),1);
  assert.equal(await page.locator('[data-text-note]:visible').count(),0);
  const images=page.locator('[data-text-project="0"] img');
  assert.equal(await images.count(),5);
  assert.equal(await page.locator('[data-text-project="0"] .post-screenshot').count(),1);
  assert.equal(await page.locator('#post-repository').getAttribute('href'),'https://github.com/bootstrap314/ac-man');
  for(const image of await images.all()) {await image.scrollIntoViewIfNeeded();await image.evaluate(el=>{el.loading='eager';});await page.waitForFunction(el=>el.complete && el.naturalWidth>0,await image.elementHandle());}
  assert.equal(await images.evaluateAll(items=>items.every(el=>el.complete && el.naturalWidth>0)),true);
  const fullImage=page.locator('[data-text-project="0"] .post-screenshot a').first();
  const fullSizePromise=page.waitForEvent('popup');await fullImage.click();
  const fullSize=await fullSizePromise;await fullSize.waitForLoadState();
  assert.equal(await fullSize.locator('img').evaluate(el=>el.naturalWidth),760);
  await fullSize.close();await page.bringToFront();
  await page.locator('[data-text-project="0"] .post-screenshot').first().scrollIntoViewIfNeeded();
  const wrapped=await page.locator('[data-text-project="0"] .post-screenshot').evaluate(figure=>{
    const image=figure.getBoundingClientRect(),paragraph=figure.nextElementSibling;
    const range=document.createRange();range.selectNodeContents(paragraph);
    const first=range.getClientRects()[0];
    return first.right<image.left && first.top<image.bottom && first.bottom>image.top;
  });
  assert.equal(wrapped,true,'Article prose flows beside the single screenshot');
  await page.screenshot({path:'.test-results/projects-screenshots-text.png'});
  await page.locator('#text-project-back').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===-1);
  assert.equal(await page.locator('[data-text-project]:visible').count(),0);
  assert.equal(await page.locator('#post-repository').isVisible(),false);
  await page.locator('[data-text-project-open="0"]').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  assert.equal(await page.locator('[data-text-project]:visible').count(),1);
  await page.emulateMedia({colorScheme:'light'});
  for(const image of await images.all()) {await image.scrollIntoViewIfNeeded();await image.evaluate(el=>{el.loading='eager';});await page.waitForFunction(el=>el.complete && el.naturalWidth>0,await image.elementHandle());}
  await page.locator('#text-close').click();
  console.log('Checkpoint passed');results.push('Scoped text view, index-to-reader synchronization, and clickable repository/full-size links, four light/dark diagrams and one native app screenshot with wrapped text');

  await page.locator('[data-page="6"]').click();await section(page,6);await prompt();
  await page.keyboard.type('view /projects/ac-man.md');await page.keyboard.press('Enter');
  await screen().getByText(/Engineering ac-man/).waitFor();
  assert.equal(await page.locator('[data-page="6"]').getAttribute('aria-current'),'page');
  await page.keyboard.press('q');await prompt();
  await page.keyboard.type("view /projects/ac-man.md | grep '^One controller, two interfaces$'");await page.keyboard.press('Enter');
  await screen().getByText('One controller, two interfaces',{exact:true}).waitFor();await prompt();
  await page.keyboard.type("find /projects -name '*.md'");await page.keyboard.press('Enter');
  await screen().getByText('/projects/ac-man.md',{exact:true}).waitFor();
  console.log('Checkpoint passed');results.push('Published project source, standalone shell pager, and piped project output');

  await page.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:45000});
  await context.setOffline(true);
  await page.goto(base+'/?cold#projects');await ready(page);await section(page,4);
  assert.equal(await page.evaluate(()=>window.siteMetrics.mode),'cold');
  await page.locator('#note-open').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  await page.locator('#text-toggle').click();
  for(const image of await images.all()) {await image.scrollIntoViewIfNeeded();await image.evaluate(el=>{el.loading='eager';});await page.waitForFunction(el=>el.complete && el.naturalWidth>0,await image.elementHandle());}
  console.log('Checkpoint passed');results.push('Offline cold boot, project content, and all project diagram and screenshot files');
  await context.setOffline(false);
  await page.close();

  const mobile=await context.newPage();await mobile.setViewportSize({width:320,height:740});
  await mobile.goto(base+'/#projects');await ready(mobile);await section(mobile,4);
  for(const button of await mobile.locator('[data-page]').all())assert.equal(await button.isVisible(),true);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.locator('#note-open').click();
  await mobile.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  for(let n=0;n<15 && !await mobile.evaluate(()=>window.siteMetrics.imageStorage>0);n++) {
    const previous=await mobile.evaluate(()=>window.siteMetrics.identity.readerPage);
    await mobile.locator('#note-next').click();await position(mobile,previous+1);
  }
  assert.ok(await mobile.evaluate(()=>window.siteMetrics.imageStorage>0));
  await mobile.screenshot({path:'.test-results/projects-mobile.png',fullPage:true});
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.close();
  const noScript=await browser.newPage({javaScriptEnabled:false});
  await noScript.goto(base);
  assert.equal(await noScript.locator('[data-text-project="0"]').isVisible(),true);
  assert.match(await noScript.locator('[data-text-project="0"]').innerText(),/Engineering ac-man/);
  await noScript.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Checkpoint passed');results.push('320px navigation and diagram layout, static fallback, and no external requests');
  await writeFile('.test-results/projects-browser.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} catch(error) {
  console.error(error);
  if(!page.isClosed()) {console.error(await screen().innerText().catch(()=>''));await page.screenshot({path:'.test-results/projects-failure.png'});}
  throw error;
} finally {await context.close();await browser.close();}
