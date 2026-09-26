// Usage: node scripts/campfocus.mjs out.png "<js returning [x,z,dist,yaw]>" [faction]
import { chromium } from 'playwright';
const [,, out, where, faction = 'aldmere', extra = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:4173/?quickstart=${faction}&hq=1${extra}`);
await page.waitForTimeout(40000);
const info = await page.evaluate(`(() => { const cs = window.__realm.campaign; const r = (${where})(cs); const c = cs.view.cam; c.yaw = c.goalYaw = r[3] ?? 0; c.focus(r[0], r[1], r[2], true); document.getElementById('ui').style.opacity = '0'; return JSON.stringify(r); })()`);
await page.waitForTimeout(6000);
await page.screenshot({ path: out, timeout: 120000 });
console.log(info, [...new Set(logs)].slice(0, 10).join('\n'));
await browser.close();
