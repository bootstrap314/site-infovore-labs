import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000},colorScheme:'dark'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const results=[];
const text=()=>page.locator('#text-view');
const current=async index=>{
  await page.waitForFunction(n=>window.siteMetrics.renderedIdentity?.page===n,index);
  await page.waitForFunction(n=>{
    const visible=[...document.querySelectorAll('[data-text-page]')].filter(el=>!el.hidden);
    return visible.length===1 && visible[0].dataset.textPage===String(n);
  },index);
};
await mkdir('.test-results',{recursive:true});
try {
  await page.goto(base+'/#work');
  await page.waitForFunction(()=>window.siteMetrics?.ready);
  await page.getByRole('button',{name:'Read as text'}).click();await current(2);
  assert.match(await text().innerText(),/William Michael Turner/);
  assert.doesNotMatch(await text().innerText(),/Hello, visitor|A small machine|Until next time|A little about me/);
  await page.screenshot({path:'.test-results/text-work.png',fullPage:true});

  await page.locator('[data-page="0"]').click();await current(0);
  assert.match(await text().innerText(),/Hello, visitor/);
  assert.doesNotMatch(await text().innerText(),/William Michael Turner|A small machine/);
  await page.keyboard.press('2');await current(1);
  assert.match(await text().innerText(),/A little about me/);
  assert.doesNotMatch(await text().innerText(),/Hello, visitor|William Michael Turner|A small machine/);
  results.push('Work, Home and About show only their own content; open text follows mouse and keyboard navigation');

  await page.keyboard.press('4');await current(3);
  assert.equal(await text().locator('[data-text-note]:visible').count(),0);
  assert.equal(await page.locator('#text-notes-index').isVisible(),true);
  assert.doesNotMatch(await text().innerText(),/This is a sample note|Until next time/);
  await text().getByRole('link',{name:'A small machine',exact:true}).click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity.note===0);
  assert.equal(await text().locator('[data-text-note]:visible').count(),1);
  assert.equal(await page.locator('#text-notes-index').isVisible(),false);
  assert.match(await text().innerText(),/Until next time/);
  assert.match(await text().innerText(),/a² \+ b² = c²/);
  assert.equal(await text().locator('article:visible img').count(),1);
  await page.locator('#text-note-back').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity.note===-1);
  assert.equal(await text().locator('[data-text-note]:visible').count(),0);
  await page.locator('#note-open').click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity.note===0);
  assert.equal(await text().locator('[data-text-note]:visible').count(),1);
  results.push('Notes index hides article bodies; opening or leaving a note stays synchronized and preserves its math and diagram');

  await page.locator('[data-page="5"]').click();await current(5);
  await text().locator('[data-text-page="5"]').getByText(/Linux 6\.6\.90|6\.6\.90-personal/).waitFor();
  assert.doesNotMatch(await text().innerText(),/Until next time|William Michael Turner/);
  await page.locator('[data-page="6"]').click();await current(6);
  await page.locator('.xterm-accessibility-tree').getByText(/^personal:\/notes#\s*$/).last().waitFor();
  await page.keyboard.type("echo '<img src=x onerror=alert(1)>'");await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-text-page="6"] pre').textContent.includes('\n<img src=x onerror=alert(1)>\n'));
  assert.equal(await text().locator('[data-text-page="6"] img').count(),0);
  assert.doesNotMatch(await text().innerText(),/Until next time|William Michael Turner/);
  results.push('System and Shell display current terminal text, update with output, and treat shell output as text');

  await page.locator('#text-close').click();assert.equal(await text().isVisible(),false);
  assert.equal(await page.locator('#text-toggle').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-page="2"]').click();await current(2);
  await page.locator('#text-toggle').click();
  await text().getByRole('link',{name:'Read full résumé'}).click();
  await page.waitForURL('**/resume.html');
  await page.getByRole('link',{name:'Back to terminal'}).first().click();
  await page.waitForURL('**/#work');
  assert.equal(await text().isVisible(),true);await current(2);
  await text().focus();await page.keyboard.press('Escape');
  assert.equal(await text().isVisible(),false);
  results.push('Closing, Escape, focus restoration and résumé round trips preserve the scoped text view');

  const mobile=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
  await mobile.goto(base+'/#work');await mobile.waitForFunction(()=>window.siteMetrics?.ready);
  await mobile.locator('#text-toggle').tap();
  assert.equal(await mobile.locator('[data-text-page]:visible').count(),1);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.close();
  const noScript=await browser.newPage({javaScriptEnabled:false});
  await noScript.goto(base);
  assert.equal(await noScript.locator('#text-view').isVisible(),true);
  assert.equal(await noScript.locator('[data-text-note]').first().isVisible(),true);
  assert.match(await noScript.locator('#text-view').innerText(),/William Michael Turner/);
  await noScript.close();
  assert.deepEqual(errors,[]);
  results.push('Mobile layout and static content without JavaScript remain available');
  console.log(JSON.stringify(results,null,2));
  await writeFile('.test-results/text-view-browser.json',JSON.stringify(results,null,2)+'\n');
} catch(error) {
  console.error(await text().innerText());
  await page.screenshot({path:'.test-results/text-view-failure.png',fullPage:true});
  throw error;
} finally {await browser.close();}
