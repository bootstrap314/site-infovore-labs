import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const results=[];
await mkdir('.test-results',{recursive:true});
const ready=page=>page.waitForFunction(()=>window.siteMetrics?.ready);
const shell=page=>page.waitForFunction(()=>window.siteMetrics?.identity?.page===6 && window.siteMetrics.identity.shellPid>1);
const text=page=>page.locator('.xterm-accessibility-tree');
const prompt=page=>text(page).getByText(/^personal:\/notes#\s*$/).last().waitFor();
// Check the editable prompt, never an older command elsewhere in the transcript.
const inputLine=(page,line)=>page.waitForFunction(expected=>{
  const screen=document.querySelector('.xterm-accessibility-tree')?.innerText || '';
  return screen.slice(screen.lastIndexOf('personal:/notes# ')).replace(/\n|\u00a0/g,'').trimEnd()===`personal:/notes# ${expected}`.trimEnd();
},line);
const history=async(page,touch=false)=>{
  await command(page,'echo HISTORY_ONE');await inputLine(page,'');
  await command(page,'echo HISTORY_TWO');await inputLine(page,'');
  await page.keyboard.type('echo DRAFT');await inputLine(page,'echo DRAFT');
  const arrow=async direction=>touch
    ? page.getByRole('button',{name:`${direction} arrow`,exact:true}).tap()
    : page.keyboard.press(`Arrow${direction}`);
  await arrow('Up');await inputLine(page,'echo HISTORY_TWO');
  await arrow('Up');await inputLine(page,'echo HISTORY_ONE');
  await arrow('Down');await inputLine(page,'echo HISTORY_TWO');
  await arrow('Down');await inputLine(page,'echo DRAFT');
  await page.keyboard.press('Enter');await text(page).getByText('DRAFT',{exact:true}).waitFor();await inputLine(page,'');
};
const pager=async page=>{
  await text(page).getByText('A small machine',{exact:true}).waitFor();
  const footer=await text(page).getByText(/\[ Quit \].*\d+\/\d+/).innerText();
  const match=footer.match(/\[ Quit \]\s+(\d+)\/(\d+)/);
  assert.ok(match);return {page:Number(match[1]),pages:Number(match[2])};
};
const pagerPage=(page,index)=>text(page).getByText(new RegExp(`\\[ Quit \\]\\s+${index}/`)).waitFor();
const imageVisible=page=>page.waitForFunction(()=>{
  const canvas=document.querySelector('.xterm-image-layer');
  return canvas && canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3 && v>0);
});
const command=async(page,line)=>{await page.keyboard.type(line);await page.keyboard.press('Enter');};
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await ready(page);
  await page.keyboard.press('7');await shell(page);await prompt(page);
  await text(page).getByText(/BusyBox v1\.38\.0.*built-in shell/).waitFor();
  await history(page);
  await command(page,'? | head -n 12');await prompt(page);
  await text(page).getByText(/List files/).waitFor();
  await command(page,'ls');
  await text(page).getByText(/(?:^|\s)a-small-machine\.md(?:\s|$)/).waitFor();
  await command(page,"find /notes -maxdepth 2 -type f -name '*.md'");
  await text(page).getByText('/notes/a-small-machine.md',{exact:true}).waitFor();await inputLine(page,'');
  await command(page,"find /notes -type f -name '*.md' -exec wc -l '{}' +");
  await text(page).getByText(/^\s*\d+ \/notes\/a-small-machine\.md$/).waitFor();await inputLine(page,'');
  await page.screenshot({path:'.test-results/shell.png',fullPage:true});
  await page.keyboard.type('view a-');await page.keyboard.press('Tab');
  await text(page).getByText(/view a-small-machine\.md/).waitFor();
  await page.keyboard.press('Enter');
  await pager(page);await text(page).getByText(/\d+\/\d+ ASCII/).waitFor();
  await page.keyboard.press('d');await text(page).getByText(/\d+\/\d+ Images/).waitFor();
  const firstView=await pager(page);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.page),6);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  assert.equal(await page.locator('[data-page="6"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('#notes-controls').isVisible(),false);
  await imageVisible(page);
  await page.screenshot({path:'.test-results/shell-view.png',fullPage:true});
  let allText='';
  for(let n=1;n<=firstView.pages;n++) {
    await pagerPage(page,n);allText+=await text(page).innerText();
    if(n<firstView.pages)await page.keyboard.press('PageDown');
  }
  assert.match(allText,/a² \+ b² = c²/);assert.match(allText,/±/);assert.match(allText,/Until next time/);
  await page.keyboard.press('Home');await pagerPage(page,1);
  const screen=await page.locator('.xterm-screen').boundingBox();
  await page.mouse.move(screen.x+50,screen.y+80);await page.mouse.wheel(0,120);await pagerPage(page,2);
  await page.getByRole('button',{name:'02 About'}).click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===1);
  await page.getByRole('button',{name:'07 Shell'}).click();await pagerPage(page,2);
  await page.setViewportSize({width:1040,height:820});await pager(page);
  await page.keyboard.press('q');await prompt(page);
  await page.setViewportSize({width:1280,height:900});
  await command(page,'view /notes/a-small-machine');await pager(page);
  await page.keyboard.press('Escape');await prompt(page);
  await command(page,'view missing.md');await text(page).getByText(/view: missing.md: no such post/).waitFor();
  await command(page,"view a-small-machine.md | grep 'a²'");
  await text(page).getByText(/Inline expressions fit into a sentence: a²/).waitFor();
  await page.getByRole('button',{name:'04 Notes'}).click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===3);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.note),-1);
  await page.getByRole('button',{name:'07 Shell'}).click();await shell(page);await prompt(page);
  await history(page);
  await command(page,'echo SHELL:$0 PID:$$');
  await text(page).getByText(/^SHELL:ash PID:\d+$/).waitFor();
  await command(page,"printf 'pipeline works\\n' | grep pipeline > /root/check; cat /root/check");
  await text(page).getByText('pipeline works',{exact:true}).waitFor();
  await command(page,'uname -a');
  await text(page).getByText(/Linux personal 6\.6\.90-personal.*i686/).waitFor();
  await page.keyboard.press('ArrowUp');await inputLine(page,'uname -a');
  await page.keyboard.press('Control+u');
  await command(page,'bad-command');
  await text(page).getByText(/bad-command: not found/).waitFor();
  await command(page,'clear');await prompt(page);
  await command(page,'top');
  await text(page).getByText(/Mem:.*used/).waitFor();
  await text(page).getByText(/\binit\b/).waitFor();
  await page.screenshot({path:'.test-results/shell-top.png',fullPage:true});
  await page.keyboard.press('q');await prompt(page);
  await command(page,'KEEP=preserved');await prompt(page);
  const pid=await page.evaluate(()=>window.siteMetrics.identity.shellPid);
  await command(page,'top');await text(page).getByText(/Mem:.*used/).waitFor();
  await page.getByRole('button',{name:'02 About'}).click();
  await page.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===1);
  await page.getByRole('button',{name:'07 Shell'}).click();await shell(page);
  assert.equal(await page.evaluate(()=>window.siteMetrics.identity.shellPid),pid);
  await page.keyboard.press('q');await prompt(page);
  await command(page,'echo SESSION:$KEEP');
  await text(page).getByText('SESSION:preserved',{exact:true}).waitFor();
  await command(page,'exit');
  await page.waitForFunction(()=>window.siteMetrics.identity.page===0 && window.siteMetrics.identity.shellPid===0);
  assert.deepEqual(errors,[]);
  results.push({test:'real BusyBox ash, help, ls/find, native Tab completion, standalone view with math/images, paging/mouse/resize, q/Esc, resumed pager and unchanged Notes state, plain-text piping, pipes/redirection, uname, history, errors, clear, real top, q, page switching with session preservation, exit',passed:true});
  await page.close();
  const mobile=await browser.newPage({viewport:{width:320,height:740},isMobile:true,hasTouch:true,colorScheme:'light'});
  mobile.setDefaultTimeout(15000);
  await mobile.goto(base);await ready(mobile);
  await mobile.locator('[data-page="6"]').tap();await shell(mobile);await prompt(mobile);
  await history(mobile,true);
  await mobile.getByRole('button',{name:'? Commands',exact:true}).tap();
  await text(mobile).getByText(/Built-in commands:/).waitFor();
  // This completion wraps onto a second row at 320px.
  await mobile.keyboard.type('view /notes/a-');
  await inputLine(mobile,'view /notes/a-');
  await mobile.locator('[data-page="1"]').tap();
  await mobile.waitForFunction(()=>window.siteMetrics.renderedIdentity?.page===1);
  await mobile.locator('[data-page="6"]').tap();await shell(mobile);
  await inputLine(mobile,'view /notes/a-');
  await mobile.getByRole('button',{name:'Tab ↹',exact:true}).tap();
  await inputLine(mobile,'view /notes/a-small-machine.md');
  const smallCols=await mobile.evaluate(()=>window.siteMetrics.identity.cols);
  await mobile.setViewportSize({width:390,height:740});
  await mobile.waitForFunction(cols=>window.siteMetrics.identity.cols>cols,smallCols);
  await inputLine(mobile,'view /notes/a-small-machine.md');
  await mobile.setViewportSize({width:320,height:740});
  await mobile.waitForFunction(cols=>window.siteMetrics.identity.cols===cols,smallCols);
  await inputLine(mobile,'view /notes/a-small-machine.md');
  await mobile.screenshot({path:'.test-results/shell-completion-mobile.png',fullPage:true});
  await mobile.keyboard.press('Enter');
  await pager(mobile);await text(mobile).getByText(/\d+\/\d+ ASCII/).waitFor();
  await mobile.keyboard.press('d');await text(mobile).getByText(/\d+\/\d+ Images/).waitFor();
  let mobileView=await pager(mobile);
  assert.equal(await mobile.evaluate(()=>window.siteMetrics.identity.page),6);
  assert.equal(await mobile.locator('#notes-controls').isVisible(),false);
  // The compact terminal has room for the diagram on its first page.
  await imageVisible(mobile);
  await mobile.screenshot({path:'.test-results/shell-view-mobile.png',fullPage:true});
  if(mobileView.pages>1) {
    await mobile.getByRole('button',{name:'Down arrow',exact:true}).tap();await pagerPage(mobile,2);
    await mobile.getByRole('button',{name:'Up arrow',exact:true}).tap();await pagerPage(mobile,1);
  }
  await mobile.keyboard.press('q');await prompt(mobile);
  await command(mobile,'view a-small-machine.md');await pager(mobile);
  await mobile.getByRole('button',{name:'Ctrl+C',exact:true}).tap();await prompt(mobile);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await command(mobile,'clear');await prompt(mobile);
  await command(mobile,'ls');await prompt(mobile);
  await mobile.screenshot({path:'.test-results/shell-mobile.png',fullPage:true});
  await command(mobile,'top');await text(mobile).getByText(/Mem:.*used/).waitFor();
  await mobile.keyboard.press('q');await prompt(mobile);
  await command(mobile,'sleep 30');
  await mobile.getByRole('button',{name:'Ctrl+C',exact:true}).tap();await prompt(mobile);
  await mobile.close();
  results.push({test:'320px ash layout, touch history, help, wrapped completion across page switches/resizes, standalone pager with images, arrows and q/Ctrl+C, quit top, and Ctrl+C interrupts real child process',passed:true});
  await writeFile('.test-results/shell-browser.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} catch(error) {
  const active=browser.contexts().flatMap(context=>context.pages())[0];
  if(active) {
    await active.screenshot({path:'.test-results/shell-failure.png',fullPage:true});
    console.error(await text(active).innerText());
    console.error(await active.evaluate(()=>window.siteMetrics));
  }
  throw error;
} finally {await browser.close();}
