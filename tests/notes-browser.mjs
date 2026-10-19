import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base=process.env.TEST_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const results=[];
const ready=page=>page.waitForFunction(()=>window.siteMetrics?.ready,null,{timeout:45000});
const guest=async(page,predicate)=>page.waitForFunction(predicate);
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.origin!==new URL(base).origin && url.protocol!=='data:')external.push(request.url());});
  await page.goto(base);await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'solarized-dark');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='solarized-light');
  await page.emulateMedia({colorScheme:'dark'});
  await page.getByRole('button',{name:'04 Notes'}).click();
  await guest(page,()=>window.siteMetrics.identity.page===3);
  // Horizontal navigation must pass through Notes without opening its selection.
  for(const [key,target] of [['ArrowRight',4],['ArrowLeft',3],['ArrowLeft',2],['ArrowRight',3]]) {
    await page.keyboard.press(key);
    await page.waitForFunction(n=>window.siteMetrics.identity.page===n,target);
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  }
  await page.keyboard.press('ArrowLeft');
  await guest(page,()=>window.siteMetrics.identity.page===2);
  const menuScreen=await page.locator('.xterm-screen').boundingBox();
  const menuSize=await page.evaluate(()=>window.siteMetrics.identity);
  await page.mouse.click(menuScreen.x+menuScreen.width/menuSize.cols*40,menuScreen.y+menuScreen.height/menuSize.rows*1.5);
  await guest(page,()=>window.siteMetrics.identity.page===3);
  await page.keyboard.press('ArrowRight');
  await guest(page,()=>window.siteMetrics.identity.page===4);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  // Browser-focused navigation retains focus, including through Shell and wraparound.
  await page.locator('[data-page="3"]').focus();
  for(const [key,target] of [['ArrowRight',4],['ArrowRight',5],['ArrowRight',6],['ArrowRight',0],['ArrowLeft',6],['ArrowLeft',5],['ArrowLeft',4],['ArrowLeft',3]]) {
    await page.keyboard.press(key);
    await page.waitForFunction(n=>window.siteMetrics.identity.page===n,target);
    assert.equal(await page.locator(`[data-page="${target}"]`).evaluate(element=>element===document.activeElement),true);
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  }
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.xterm-helper-textarea').evaluate(element=>element===document.activeElement),true);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  await page.keyboard.press('Enter');
  await guest(page,()=>window.siteMetrics.identity.note===0);
  await page.keyboard.press('PageDown');
  await guest(page,()=>window.siteMetrics.identity.readerPage===1);
  for(const [key,target] of [['ArrowRight',4],['ArrowLeft',3],['ArrowLeft',2],['ArrowRight',3]]) {
    await page.keyboard.press(key);
    await page.waitForFunction(n=>window.siteMetrics.identity.page===n,target);
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),target===4 ? -1 : 0);
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.readerPage),target===4 ? 0 : 1);
  }
  await page.keyboard.press('Home');
  await guest(page,()=>window.siteMetrics.identity.readerPage===0);
  results.push({test:'Left/Right section navigation through Notes, native menu selection, focused buttons and wraparound, Enter opens notes, reader position preserved',passed:true});
  await page.keyboard.press('d');
  await guest(page,()=>window.siteMetrics.renderedIdentity?.diagramAscii===0);
  const pages=await page.evaluate(()=>window.siteMetrics.identity.readerPages);
  let allText='',sawImage=false;
  for(let index=0;index<pages;index++) {
    await page.waitForFunction(n=>window.siteMetrics.renderedIdentity?.note===0 && window.siteMetrics.renderedIdentity.readerPage===n,index);
    await page.locator('.xterm-accessibility-tree').getByText(new RegExp(`${index+1}/${pages}`)).waitFor();
    await page.locator('.xterm-accessibility-tree').getByText('A small machine',{exact:false}).first().waitFor();
    allText+=await page.locator('.xterm-accessibility-tree').innerText();
    if(!sawImage && await page.evaluate(()=>window.siteMetrics.imageStorage>0)) {
      sawImage=true;
      await page.screenshot({path:'.test-results/notes-diagram.png',fullPage:true});
    }
    if((await page.locator('.xterm-accessibility-tree').innerText()).includes('±')) await page.screenshot({path:'.test-results/notes-math.png',fullPage:true});
    if(index+1<pages) {
      await page.keyboard.press('PageDown');
      await page.waitForFunction(n=>window.siteMetrics.identity.readerPage===n,index+1);
      await page.waitForFunction(()=>window.siteMetrics.imageStorage>=0);
    }
  }
  assert.ok(sawImage,'Mermaid image decoded inside the terminal');
  assert.match(allText,/a² \+ b² = c²/);
  assert.match(allText,/±/);
  assert.match(allText,/Until next time/);
  await page.keyboard.press('Escape');
  await guest(page,()=>window.siteMetrics.identity.note===-1);
  const screen=await page.locator('.xterm-screen').boundingBox();
  const size=await page.evaluate(()=>window.siteMetrics.identity);
  await page.mouse.click(screen.x+screen.width/size.cols*15,screen.y+screen.height/size.rows*7.5);
  await guest(page,()=>window.siteMetrics.identity.note===0);
  await page.mouse.wheel(0,120);
  await guest(page,()=>window.siteMetrics.identity.readerPage>0);
  results.push({test:'Markdown reader, Unicode termtex math, Mermaid terminal images, keyboard and native mouse navigation',passed:true});
  await page.keyboard.press('Escape');
  await guest(page,()=>window.siteMetrics.identity.note===-1);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await guest(page,()=>window.siteMetrics.renderedIdentity?.note===1);
  let codeFound=false;
  for(let n=0;n<15;n++) {
    const output=await page.locator('.xterm-accessibility-tree').innerText();
    if(output.includes('make build')) {
      assert.match(output,/┌─+┐/);assert.match(output,/│ +make build +│/);assert.match(output,/└─+┘/);
      codeFound=true;await page.screenshot({path:'.test-results/notes-code-box.png'});break;
    }
    await page.keyboard.press('PageDown');
    await guest(page,()=>window.siteMetrics.renderedIdentity?.readerPage===window.siteMetrics.identity.readerPage);
    await page.locator('.xterm-accessibility-tree').getByText(new RegExp(`\\b${n+2}/`)).waitFor();
  }
  assert.ok(codeFound,'Build command appears in a bordered terminal code box');
  await page.getByRole('button',{name:'Read as text',exact:true}).click();
  assert.ok((await page.locator('[data-text-note="1"] .code-block code').allTextContents()).some(text=>text==='make build'));
  await page.getByRole('button',{name:'Close text view'}).click();
  results.push({test:'Commands render in bordered ncurses boxes and semantic HTML code blocks',passed:true});
  await page.getByRole('button',{name:'06 System'}).click();
  await guest(page,()=>window.siteMetrics.identity.page===5);
  await page.keyboard.press('t');
  await guest(page,()=>window.siteMetrics.identity.themePicker===1);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='solarized-light');
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.themeChoice===2);
  await page.screenshot({path:'.test-results/theme-solarized-light.png',fullPage:true});
  assert.equal(await page.locator('#theme-select').count(),0);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dracula');
  await page.emulateMedia({colorScheme:'light'});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dracula');
  await page.reload();await ready(page);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dracula');
  await page.getByRole('button',{name:'06 System'}).click();
  await guest(page,()=>window.siteMetrics.identity.page===5);
  await page.keyboard.press('t');
  await guest(page,()=>window.siteMetrics.identity.themePicker===1);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='solarized-light');
  await page.keyboard.press('Escape');
  await guest(page,()=>window.siteMetrics.identity.themePicker===0);
  results.push({test:'OS light/dark detection, ncurses theme selection, manual persistence, restoring automatic mode',passed:true});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await page.close();
  const mobile=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true,colorScheme:'light'});
  mobile.setDefaultTimeout(15000);
  await mobile.goto(base);await ready(mobile);
  await mobile.locator('[data-page="3"]').tap();
  await mobile.locator('#note-open').tap();
  await guest(mobile,()=>window.siteMetrics.identity.note===0);
  await mobile.locator('[data-note="diagrams"]').tap();
  await guest(mobile,()=>window.siteMetrics.renderedIdentity?.diagramAscii===0);
  for(let i=0;i<10;i++) {
    await mobile.waitForFunction(()=>window.siteMetrics.renderedIdentity?.note===0 && window.siteMetrics.renderedIdentity.readerPage===window.siteMetrics.identity.readerPage);
    if(await mobile.evaluate(()=>window.siteMetrics.imageStorage>0)) break;
    assert.equal(await mobile.locator('#note-next').isEnabled(),true,'Image appears before the end of the note');
    const previous=await mobile.evaluate(()=>window.siteMetrics.identity.readerPage);
    await mobile.locator('#note-next').tap();
    await mobile.waitForFunction(n=>window.siteMetrics.identity.readerPage>n,previous);
  }
  await mobile.waitForFunction(()=>window.siteMetrics.imageStorage>0);
  await mobile.screenshot({path:'.test-results/notes-mobile.png',fullPage:true});
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.setViewportSize({width:390,height:844});
  await mobile.locator('#note-back').tap();
  await guest(mobile,()=>window.siteMetrics.identity.note===-1);
  await mobile.locator('[data-page="5"]').tap();
  assert.equal(await mobile.locator('#theme-select').count(),0);
  await mobile.locator('#text-toggle').tap();
  assert.equal(await mobile.locator('#text-view').isVisible(),true);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.getByRole('button',{name:'Close text view'}).tap();
  assert.equal(await mobile.locator('#text-view').isVisible(),false);
  results.push({test:'320px images, touch reader controls, live resize, closing text on touch',passed:true});
  await mobile.close();
  console.log(JSON.stringify(results,null,2));
  await writeFile('.test-results/notes-browser.json',JSON.stringify(results,null,2)+'\n');
} finally {await browser.close();}
