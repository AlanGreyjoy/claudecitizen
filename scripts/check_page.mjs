import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
try {
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 8000 });
} catch (e) {
  errors.push(`goto: ${e.message}`);
}
await page.waitForTimeout(2500);
const stats = await page.evaluate(() => ({
  title: document.title,
  fps: document.getElementById('hud-fps-value')?.textContent ?? null,
  renderStats: window.__claudecitizenRenderStats ?? null,
  scene: Boolean(window.__spikeScene),
}));
console.log(JSON.stringify({ ...stats, errors }, null, 2));
await browser.close();
