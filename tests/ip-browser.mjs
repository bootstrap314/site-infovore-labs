import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:4173';
const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
await mkdir('.test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});
page.setDefaultTimeout(15000);
const text=()=>page.locator('.xterm-accessibility-tree');
const requests=[],errors=[],results=[];
let response='203.0.113.42', delayed;
page.on('pageerror',error=>errors.push(error.message));
await page.context().route(/^https:\/\/api(6|64)?\.ipify\.org/,async route=>{
  requests.push(route.request().url());
  if(response==='abort')return route.abort('failed');
  if(response==='delay')return new Promise(resolve=>{delayed=async()=>{
    await route.fulfill({json:{ip:'203.0.113.42'},headers:{'Access-Control-Allow-Origin':'*'}}).catch(()=>{});resolve();
  };});
  await route.fulfill({json:{ip:response},headers:{'Access-Control-Allow-Origin':'*'}});
});
const command=async line=>{
  await page.keyboard.type(line);await page.keyboard.press('Enter');
};
const line=expected=>text().getByText(expected,{exact:true}).last().waitFor();
const done=()=>page.waitForFunction(()=>{
  const screen=document.querySelector('.xterm-accessibility-tree')?.innerText||'';
  return screen.slice(screen.lastIndexOf('personal:/notes# ')).replace(/\n|\u00a0/g,'').trimEnd()==='personal:/notes#';
});
let sequence=0;
async function run(commandText) {
  const marker=`IP_DONE_${++sequence}`;
  await command(`clear; ${commandText}; echo ${marker}:$?`);
  await line(new RegExp(`^${marker}:\\d+$`));await done();
  return (await text().innerText()).replaceAll('\u00a0',' ').replaceAll(marker,'STATUS');
}
try {
  await page.goto(base+'/#shell');
  await page.waitForFunction(()=>window.siteMetrics?.ready && window.siteMetrics.identity.shellPid>1);
  await done();assert.deepEqual(requests,[],'No public IP request during page load');
  let output=await run('ip a');
  assert.match(output,/1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536/);
  assert.match(output,/\d+: public0: <BROADCAST,NOARP,UP,LOWER_UP> mtu 1500/);
  assert.match(output,/inet 203\.0\.113\.42\/32 scope global public0/);
  assert.match(output,/valid_lft forever preferred_lft forever/);
  assert.match(output,/STATUS:0/);assert.equal(requests.length,1);
  await page.screenshot({path:'.test-results/ip.png',fullPage:true});
  const stableInterface=output.match(/\d+: public0:.*\n.*link\/ether [a-f0-9:]+/)[0];
  output=await run('ip a');assert.ok(output.includes(stableInterface),'Interface index and MAC remain stable');
  output=await run('first=$(ip a); second=$(busybox ip a); test "$first" = "$second"');
  assert.match(output,/^STATUS:0$/m,'Output exactly matches native BusyBox ip');
  output=await run("ip -4 addr show | grep 'inet 203' > /root/ip-output; cat /root/ip-output");
  assert.match(output,/inet 203\.0\.113\.42\/32 scope global public0/);
  assert.match(requests.at(-1),/^https:\/\/api\.ipify/);
  results.push('IPv4, native interface output, stable identity, aliases, pipes and redirection');

  response='2001:db8::42';
  output=await run('ip -6 a');
  assert.match(output,/inet6 2001:db8::42\/128 scope global/);
  assert.doesNotMatch(output,/tentative|deprecated|fe80:/);
  assert.match(output,/STATUS:0/);assert.match(requests.at(-1),/^https:\/\/api6\.ipify/);
  results.push('IPv6 with the real Linux address and lifetime fields');

  for(const failure of ['abort','not-an-ip','999.999.999.999','1.2.3.4\nP 0']) {
    response=failure;
    output=await run('ip a > /root/failed-ip; wc -c < /root/failed-ip');
    assert.match(output,/ip: public IP lookup failed/);
    assert.match(output,/\n\s*0\n/,'Failure leaves stdout empty');
    assert.equal(await page.evaluate(()=>window.siteMetrics.identity.page),6);
  }
  output=await run('ip a');assert.match(output,/^STATUS:1$/m);
  results.push('Blocked requests and malformed responses fail without printing a stale address');

  response='delay';
  await command('clear');await done();await command('ip a');
  await page.waitForFunction(()=>document.querySelector('.xterm-accessibility-tree').innerText.includes('ip a'));
  const deadline=Date.now()+5000;
  while(!delayed && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(delayed,'The pending lookup reached the browser');
  await page.keyboard.press('Control+c');await done();
  await delayed();delayed=undefined;
  response='203.0.113.43';
  output=await run('ip a');assert.match(output,/inet 203\.0\.113\.43\/32/);assert.match(output,/STATUS:0/);
  results.push('Ctrl+C cancels the command and a later lookup still works');

  response='delay';
  const started=Date.now();
  output=await run('ip a');
  assert.match(output,/lookup failed/);assert.match(output,/^STATUS:1$/m);
  assert.ok(Date.now()-started<12000,'Requests time out without hanging the shell');
  await delayed();delayed=undefined;
  assert.deepEqual(errors,[]);
  results.push('Slow requests time out and leave the VM usable');
  console.log(JSON.stringify(results,null,2));
  await writeFile('.test-results/ip-browser.json',JSON.stringify(results,null,2)+'\n');
} catch(error) {
  console.error(await text().innerText());
  await page.screenshot({path:'.test-results/ip-failure.png',fullPage:true});
  throw error;
} finally { await browser.close(); }
