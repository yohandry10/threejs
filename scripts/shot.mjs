// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [js-to-eval-before]
import { chromium } from 'playwright';
const [,, url, out, waitMs = '4000', evalJs = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()}`));
await page.goto(url);
await page.waitForTimeout(Number(waitMs));
if (evalJs) { await page.evaluate(evalJs); await page.waitForTimeout(3000); }
await page.screenshot({ path: out });
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
