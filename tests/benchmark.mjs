import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const results = [];
try {
  for (const profile of ['snapshot-fresh','snapshot-cached','cold-boot','snapshot-fast4g']) {
    const context = await browser.newContext({viewport:{width:1280,height:860}});
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (profile === 'snapshot-cached') {
      await page.goto(base);
      await page.waitForFunction(() => window.siteMetrics?.ready);
    }
    if (profile === 'snapshot-fast4g') await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1_250_000,uploadThroughput:625_000});
    for (let i=0;i<3;i++) {
      if (profile !== 'snapshot-cached') await cdp.send('Network.clearBrowserCache');
      await page.goto(base+(profile === 'cold-boot' ? '/?cold' : '/'));
      await page.waitForFunction(() => window.siteMetrics?.ready, null, {timeout:45_000});
      const result = await page.evaluate(() => ({readyMs:window.siteMetrics.readyMs,sessionMs:window.siteMetrics.sessionMs,mode:window.siteMetrics.mode,bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0)+window.siteMetrics.workerTransferBytes}));
      results.push({profile,run:i+1,...result});
    }
    await context.close();
  }
  await mkdir('.test-results',{recursive:true});
  await writeFile('.test-results/benchmark.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally { await browser.close(); }
