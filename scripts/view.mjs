// Usage: node scripts/view.mjs "<query>" out.png [waitMs]
import { chromium } from 'playwright';
const [,, q, out, waitMs = '12000'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:4173/?viewer=ship&hq=1&${q}`);
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log([...new Set(logs)].slice(0, 20).join('\n'));
await browser.close();
