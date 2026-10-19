import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const results=[];
await mkdir('.test-results',{recursive:true});
const terminalText=page=>page.locator('.xterm-accessibility-tree');
const command=async(page,line)=>{await page.keyboard.type(line);await page.keyboard.press('Enter');};
const inputLine=(page,line)=>page.waitForFunction(expected=>{
  const screen=document.querySelector('.xterm-accessibility-tree')?.innerText || '';
  return screen.slice(screen.lastIndexOf('personal:~# ')).replace(/\n|\u00a0/g,'').trimEnd()===`personal:~# ${expected}`.trimEnd();
},line);
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000},colorScheme:'dark'});
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).origin!==new URL(base).origin)external.push(request.url());});
  await page.goto(base+'/#work');
  await page.waitForFunction(()=>window.siteMetrics?.renderedIdentity?.page===2);
  await page.locator('.xterm-accessibility-tree').getByText(/William Michael Turner/).waitFor();
  const workSession=await page.evaluate(()=>window.siteMetrics.sessionStarted);
  await page.screenshot({path:'.test-results/resume-terminal.png',fullPage:true});
  await page.keyboard.press('Enter');
  await page.waitForURL('**/resume.html');
  await page.getByRole('heading',{name:'William Michael Turner',exact:true}).waitFor();
  await page.screenshot({path:'.test-results/resume-dark.png'});
  const data=JSON.parse(await readFile('.build/resume.json','utf8'));
  const text=await page.locator('.resume-paper').innerText();
  for(const entry of [...data.experience,...data.education])for(const item of entry.items)assert.ok(text.includes(item),`Missing accomplishment: ${item}`);
  assert.equal(await page.locator('.resume-paper a[href^="mailto:"]').count(),1);
  const downloaded=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download PDF'}).click();
  assert.equal((await downloaded).suggestedFilename(),'William-Turner-Resume.pdf');
  await page.getByRole('navigation',{name:'Résumé sections'}).getByRole('link',{name:'02 Skills'}).click();
  assert.match(page.url(),/#skills$/);
  await page.getByRole('link',{name:'Back to top'}).click();
  await page.emulateMedia({colorScheme:'light'});
  await page.screenshot({path:'.test-results/resume-light.png'});
  await page.getByRole('link',{name:'Back to terminal'}).click();
  await page.locator('#terminal-view').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.siteMetrics.sessionStarted),workSession);
  await page.waitForFunction(()=>window.siteMetrics?.renderedIdentity?.page===2);
  const rect=await page.locator('.xterm-screen').boundingBox(),size=await page.evaluate(()=>window.siteMetrics.identity);
  await page.mouse.click(rect.x+rect.width/size.cols*14,rect.y+rect.height/size.rows*(size.rows-5.5));
  await page.waitForURL('**/resume.html');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  results.push({test:'Work keyboard and mouse entry, complete résumé, email link, PDF download, anchors, return to Work, both Solarized themes',passed:true});
  for(const running of [false,true]) {
    await page.goto(base+`/?resume-case=${running ? 'top' : 'draft'}#shell`);
    await page.waitForFunction(()=>window.siteMetrics?.ready && window.siteMetrics?.identity?.page===6);
    await page.locator('.xterm-accessibility-tree').getByText(/^personal:\/notes#\s*$/).waitFor();
    await command(page,"KEEP=resume; echo disk > /root/resume-check; cd /root");await inputLine(page,'');
    await command(page,'echo HISTORY_MARKER');await inputLine(page,'');
    if(running) {
      await page.getByRole('textbox',{name:'Terminal input'}).pressSequentially('top');
      await page.getByRole('textbox',{name:'Terminal input'}).press('Enter');
      await page.locator('.xterm-accessibility-tree').getByText(/Mem:.*used/).waitFor();
    } else {await page.keyboard.type('echo unfinished');await inputLine(page,'echo unfinished');}
    const original=await page.evaluate(()=>({page:window.siteMetrics.identity.page,started:window.siteMetrics.sessionStarted,pid:window.siteMetrics.identity.shellPid,cols:window.siteMetrics.identity.cols,loads:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('manifest.json')).length}));
    await page.getByRole('link',{name:'Read résumé',exact:true}).click();
    await page.waitForURL('**/resume.html');
    await page.getByRole('heading',{name:'William Michael Turner',exact:true}).waitFor();
    await page.getByRole('navigation',{name:'Résumé sections'}).getByRole('link',{name:'02 Skills'}).click();
    await page.setViewportSize({width:1040,height:820});
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.cols),original.cols);
    if(running)await page.goBack();
    else await page.getByRole('link',{name:'Back to terminal'}).click();
    await page.locator('#terminal-view').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.page),original.page);
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.shellPid),original.pid);
    assert.equal(await page.evaluate(()=>window.siteMetrics.sessionStarted),original.started);
    assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.endsWith('manifest.json')).length),original.loads);
    if(running) {
      await terminalText(page).getByText(/Mem:.*used/).waitFor();
      await page.keyboard.press('q');await inputLine(page,'');
    } else {
      await inputLine(page,'echo unfinished');
      await page.keyboard.press('ArrowUp');await inputLine(page,'echo HISTORY_MARKER');
      await page.keyboard.press('ArrowDown');await inputLine(page,'echo unfinished');
      await page.keyboard.press('Control+u');await inputLine(page,'');
    }
    await command(page,'echo "$KEEP"; cat /root/resume-check; pwd');
    for(const output of ['resume','disk','/root'])await terminalText(page).getByText(output,{exact:true}).waitFor();
    await inputLine(page,'');
    await page.goForward();await page.locator('#resume-view').waitFor({state:'visible'});
    await page.getByRole('link',{name:'Return to the terminal',exact:true}).click();
    await page.locator('#terminal-view').waitFor({state:'visible'});await inputLine(page,'');
    assert.equal(await page.evaluate(()=>window.siteMetrics.sessionStarted),original.started);
    await page.screenshot({path:`.test-results/resume-return-${running ? 'top' : 'shell'}.png`,fullPage:true});
    await page.setViewportSize({width:1280,height:1000});
  }
  results.push({test:'résumé return links and browser Back/Forward preserve the VM, shell history, unfinished input, variables, files, working directory, and running top across résumé anchors and resizing',passed:true});
  await page.close();
  const mobile=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true,colorScheme:'light'});
  await mobile.goto(base+'/resume.html');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.screenshot({path:'.test-results/resume-mobile.png'});
  await mobile.getByRole('navigation',{name:'Résumé sections'}).getByRole('link',{name:'03 Education'}).tap();
  await mobile.getByRole('heading',{name:'Moorpark College'}).waitFor();
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.close();
  const touch=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true});
  await touch.goto(base+'/#shell');
  await touch.waitForFunction(()=>window.siteMetrics?.ready && window.siteMetrics.identity.page===6);
  await touch.getByRole('textbox',{name:'Terminal input'}).tap();
  await command(touch,'cd /root; echo TOUCH_SAVED');await inputLine(touch,'');
  const touchSession=await touch.evaluate(()=>window.siteMetrics.sessionStarted);
  await touch.getByRole('link',{name:'Read résumé',exact:true}).tap();
  await touch.getByRole('heading',{name:'William Michael Turner',exact:true}).waitFor();
  await touch.getByRole('link',{name:'Back to terminal'}).tap();
  await touch.locator('#terminal-view').waitFor({state:'visible'});await inputLine(touch,'');
  await touch.getByRole('button',{name:'Up arrow',exact:true}).tap();await inputLine(touch,'cd /root; echo TOUCH_SAVED');
  assert.equal(await touch.evaluate(()=>window.siteMetrics.sessionStarted),touchSession);
  assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await touch.screenshot({path:'.test-results/resume-return-mobile.png',fullPage:true});
  await touch.close();
  const noJs=await browser.newPage({javaScriptEnabled:false});
  const requests=[];noJs.on('request',request=>requests.push(request.url()));
  await noJs.goto(base+'/#shell');
  await noJs.getByRole('link',{name:'Read résumé',exact:true}).click();
  await noJs.getByRole('heading',{name:'William Michael Turner',exact:true}).waitFor();
  assert.ok(!requests.some(url=>/\.wasm|state\.bin|manifest\.json/.test(url)));
  await noJs.close();
  results.push({test:'320px touch layout and anchor navigation; full résumé works without JavaScript or booting Linux',passed:true});
  await writeFile('.test-results/resume-browser.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} catch(error) {
  const active=browser.contexts().flatMap(context=>context.pages())[0];
  if(active) {
    await active.screenshot({path:'.test-results/resume-failure.png',fullPage:true});
    console.error(await terminalText(active).allTextContents());
    console.error(await active.evaluate(()=>window.siteMetrics));
  }
  throw error;
} finally {await browser.close();}
