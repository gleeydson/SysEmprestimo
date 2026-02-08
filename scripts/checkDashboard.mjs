import { chromium } from 'playwright';

const BASE_URL = process.env.CHECK_URL || 'http://localhost:3000';
const EMAIL = process.env.CHECK_EMAIL || 'admin@local.test';
const PASSWORD = process.env.CHECK_PASSWORD || 'admin123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#loginEmail', EMAIL);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#appRoot:not(.hidden)');
  await page.waitForTimeout(1500);
  const metrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyHeight: document.body.scrollHeight,
    contents: Array.from(document.querySelectorAll('.content')).map((el) => ({
      id: el.id,
      display: getComputedStyle(el).display,
      classes: el.className,
    })),
  }));
  console.log(JSON.stringify(metrics, null, 2));
  await page.screenshot({ path: 'dashboard.png', fullPage: true });
  await browser.close();
})();
