import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({channel:'chrome',headless:true});
await mkdir('.test-results',{recursive:true});
const results = [];
async function ready(page) {
  await page.waitForFunction(() => window.siteMetrics?.ready, null, {timeout:45_000});
  return page.evaluate(() => window.siteMetrics);
}
async function guestPage(page, index) {
  await page.waitForFunction(value => window.siteMetrics?.identity?.page === value, index);
}
try {
  const page = await browser.newPage({viewport:{width:1280,height:860}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const warm = await ready(page);
  assert.equal(warm.mode,'snapshot');
  assert.equal(warm.identity.pid,1);
  assert.match(warm.identity.kernel,/^6\.6\.90-personal/);
  assert.match(warm.identity.ncurses,/^ncurses 6\.5/);
  await page.screenshot({path:'.test-results/desktop.png',fullPage:true});
  await page.keyboard.press('ArrowRight'); await guestPage(page,1);
  await page.keyboard.press('Tab'); await guestPage(page,2);
  await page.keyboard.press('5'); await guestPage(page,4);
  await page.locator('.xterm-accessibility-tree').getByText(/Yes, this is Linux/).waitFor();
  await page.screenshot({path:'.test-results/system.png',fullPage:true});
  await page.keyboard.press('1'); await guestPage(page,0);
  const screen = await page.locator('.xterm-screen').boundingBox();
  const identity = await page.evaluate(() => window.siteMetrics.identity);
  await page.mouse.click(screen.x + screen.width / identity.cols * 29.5, screen.y + screen.height / identity.rows * 5.5);
  await guestPage(page,2);
  await page.getByRole('button',{name:'04 Notes'}).click(); await guestPage(page,3);
  await page.keyboard.press('?');
  await page.locator('.xterm-accessibility-tree').getByText(/A small field guide/).waitFor();
  await page.keyboard.press('?');
  await page.getByRole('button',{name:'Restart Linux session'}).click();
  await ready(page); await guestPage(page,0);
  await page.getByRole('button',{name:'Read as text'}).click();
  assert.equal(await page.locator('#text-view').isVisible(),true);
  assert.deepEqual(errors,[]);
  results.push({test:'snapshot, keyboard, native ncurses mouse, page buttons, help, restart, text view',readyMs:warm.readyMs,passed:true});
  await page.goto(base+'/?cold');
  const cold = await ready(page);
  assert.equal(cold.mode,'cold');
  assert.equal(cold.identity.pid,1);
  results.push({test:'cold Linux boot',readyMs:cold.readyMs,passed:true});
  await page.close();
  const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await mobile.goto(base); await ready(mobile);
  await mobile.locator('[data-page="4"]').tap(); await guestPage(mobile,4);
  await mobile.locator('.xterm-accessibility-tree').getByText(/Yes, this is Linux/).waitFor();
  await mobile.screenshot({path:'.test-results/mobile.png',fullPage:true});
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await mobile.setViewportSize({width:320,height:740});
  await mobile.waitForFunction(() => window.siteMetrics.identity.cols < 50);
  await mobile.locator('[data-page="0"]').tap(); await guestPage(mobile,0);
  await mobile.screenshot({path:'.test-results/mobile-small.png',fullPage:true});
  results.push({test:'touch navigation, 390px and 320px layout, live resize',passed:true});
  await mobile.close();
  const fallback = await browser.newPage();
  await fallback.route('**/*state.bin.zst',route => route.abort());
  await fallback.goto(base);
  const recovered = await ready(fallback);
  assert.equal(recovered.mode,'cold');
  results.push({test:'missing snapshot automatically falls back to a real cold boot',passed:true});
  await fallback.close();
  console.log(JSON.stringify(results,null,2));
  await writeFile('.test-results/smoke.json',JSON.stringify(results,null,2)+'\n');
} finally { await browser.close(); }
