import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},colorScheme:'dark'});
const page=await context.newPage(),results=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
const screen=target=>target.locator('.xterm-accessibility-tree');
const ready=target=>target.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
const mode=(target,ascii)=>target.waitForFunction(n=>window.siteMetrics.renderedIdentity?.diagramAscii===n,ascii);
const position=async target=>{
  const {readerPage,readerPages}=await target.evaluate(()=>window.siteMetrics.renderedIdentity);
  await screen(target).getByText(new RegExp(`\\b${readerPage+1}/${readerPages}\\b`)).waitFor();
};
const next=async target=>{
  const before=await target.evaluate(()=>window.siteMetrics.renderedIdentity.readerPage);
  await target.locator('#note-next').click();
  await target.waitForFunction(n=>window.siteMetrics.renderedIdentity.readerPage===n+1,before);
  await position(target);
};
const findDiagram=async target=>{
  await target.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===4 && window.siteMetrics.renderedIdentity.note===0);
  await mode(target,1);
  for(let n=0;n<40;n++) {
    await position(target);
    if(/\|.*Swift.*\|/.test(await screen(target).innerText()))return;
    assert.ok(await target.locator('#note-next').isEnabled());await next(target);
  }
  assert.fail('No ASCII terminal diagram found');
};
const decoded=async(target,img)=>{
  await img.scrollIntoViewIfNeeded();await img.evaluate(el=>{el.loading='eager';});
  await target.waitForFunction(el=>el.complete && el.naturalWidth>0,await img.elementHandle());
  assert.match(await img.evaluate(el=>el.currentSrc),/\.svg$/);
};
const checkpoint=message=>{console.log(message);results.push(message);};
await mkdir('.test-results',{recursive:true});
try {
  await page.goto(base+'/#projects');await ready(page);
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===4);
  assert.equal(await page.locator('[data-note="diagrams"]').isVisible(),false);
  await page.locator('#note-open').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0);
  await findDiagram(page);
  const asciiPage=await page.evaluate(()=>window.siteMetrics.renderedIdentity.readerPage);
  await screen(page).getByText(/\|.*Cloud \+ AC.*\|/).waitFor();
  assert.equal(await page.locator('[data-note="diagrams"]').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:'.test-results/diagram-ascii-default.png'});
  await page.keyboard.press('d');await mode(page,0);await position(page);
  await page.waitForFunction(()=>window.siteMetrics.imageStorage>0);
  await page.screenshot({path:'.test-results/diagram-centered.png'});
  await page.locator('[data-note="diagrams"]').click();await mode(page,1);await position(page);
  assert.equal(await page.evaluate(()=>window.siteMetrics.renderedIdentity.readerPage),asciiPage);
  checkpoint('Ncurses defaults to ASCII; keyboard/mouse image comparison preserves the current diagram');

  await page.locator('#text-toggle').click();
  assert.equal(await page.locator('#text-view').getAttribute('data-diagrams'),'svg');
  const figure=page.locator('[data-text-project="0"] .mermaid-diagram').first(),img=figure.locator('img');
  await decoded(page,img);
  const vector=await page.evaluate(async url=>{const response=await fetch(url);return {type:response.headers.get('content-type'),source:await response.text()};},await img.evaluate(el=>el.currentSrc));
  assert.match(vector.type,/image\/svg\+xml/);assert.match(vector.source,/<svg/);
  assert.match(vector.source,/Swift/);assert.match(vector.source,/<text/);
  assert.doesNotMatch(vector.source,/<foreignObject|data:image\/png|<script/i);
  const centered=await figure.evaluate(el=>{const f=el.getBoundingClientRect(),i=el.querySelector('img').getBoundingClientRect();return Math.abs((i.x+i.width/2)-(f.x+f.width/2));});
  assert.ok(centered<1);
  await page.screenshot({path:'.test-results/diagram-svg-text.png'});
  await page.locator('[data-note="diagrams"]').click();await mode(page,0);
  assert.equal(await img.isVisible(),true,'Terminal mode leaves SVG text view alone');
  await page.locator('[data-text-diagrams]').click();
  await figure.locator('.diagram-ascii').waitFor();assert.equal(await img.isVisible(),false);
  assert.equal(await page.evaluate(()=>window.siteMetrics.renderedIdentity.diagramAscii),0,'Text mode leaves terminal images alone');
  assert.equal(await page.locator('[data-text-project="0"] .post-screenshot img:visible').count(),2);
  await page.locator('[data-text-diagrams]').click();await decoded(page,img);
  const darkSource=await img.evaluate(el=>el.currentSrc);
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(({el,old})=>el.currentSrc!==old,{el:await img.elementHandle(),old:darkSource});await decoded(page,img);
  await page.screenshot({path:'.test-results/diagram-svg-light.png'});
  for(const image of await page.locator('[data-text-project="0"] .mermaid-diagram img').all())await decoded(page,image);
  await page.locator('#text-close').click();
  await page.locator('[data-page="3"]').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===3);
  await page.locator('#note-open').click();await mode(page,1);
  await page.locator('[data-page="4"]').click();await mode(page,0);
  checkpoint('HTML defaults to centered standalone SVG with native vector labels, light/dark variants, and independent controls');

  await page.locator('[data-page="6"]').click();
  await screen(page).getByText(/^personal:\/notes#\s*$/).last().waitFor();
  await page.keyboard.type('view /projects/ac-man.md');await page.keyboard.press('Enter');
  await screen(page).getByText(/\d+\/\d+ ASCII/).waitFor();
  let found=false;
  for(let n=0;n<10;n++) {
    const value=await screen(page).innerText();
    if(/\|.*Swift.*\|/.test(value)){found=true;break;}
    const match=value.match(/\b(\d+)\/(\d+)\b/);assert.ok(match);
    await page.keyboard.press('PageDown');await screen(page).getByText(new RegExp(`\\b${Number(match[1])+1}/${match[2]}\\b`)).waitFor();
  }
  assert.ok(found);
  await page.keyboard.press('d');await screen(page).getByText(/\d+\/\d+ Images/).waitFor();
  await page.keyboard.press('q');await screen(page).getByText(/^personal:\/notes#\s*$/).last().waitFor();
  checkpoint('BusyBox view also defaults to ASCII and retains its optional image toggle');

  await page.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:60000});
  await context.setOffline(true);
  const offline=await context.newPage();await offline.goto(base+'/?cold#projects');await ready(offline);
  await offline.locator('#note-open').click();await findDiagram(offline);
  await offline.locator('#text-toggle').click();
  for(const image of await offline.locator('[data-text-project="0"] .mermaid-diagram img').all())await decoded(offline,image);
  await offline.close();await context.setOffline(false);
  checkpoint('Offline cold boot uses ASCII; all project SVGs decode from the static cache');

  const mobile=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true,colorScheme:'light'});
  await mobile.goto(base+'/#projects');await ready(mobile);
  await mobile.locator('#note-open').tap();await findDiagram(mobile);
  await mobile.screenshot({path:'.test-results/diagram-ascii-mobile.png',fullPage:true});
  await mobile.locator('#text-toggle').tap();
  await decoded(mobile,mobile.locator('[data-text-project="0"] .mermaid-diagram img').first());
  await mobile.screenshot({path:'.test-results/diagram-svg-mobile.png'});
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.locator('[data-text-diagrams]').tap();
  await mobile.locator('[data-text-project="0"] .diagram-ascii').first().waitFor();
  await mode(mobile,1);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.close();
  const noScript=await browser.newPage({javaScriptEnabled:false});await noScript.goto(base);
  await decoded(noScript,noScript.locator('[data-text-project="0"] .mermaid-diagram img').first());
  await noScript.close();
  assert.deepEqual(errors,[]);
  checkpoint('320px touch layout and SVG text view without JavaScript');
  await writeFile('.test-results/diagrams-browser.json',JSON.stringify(results,null,2)+'\n');
} catch(error) {console.error(error);await page.screenshot({path:'.test-results/diagrams-failure.png'}).catch(()=>{});throw error;}
finally {await context.close();await browser.close();}
