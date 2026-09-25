import { chromium } from 'playwright';
const [,, url, js, wait = '12000'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(Number(wait));
console.log(JSON.stringify(await page.evaluate(js), null, 1));
await browser.close();
