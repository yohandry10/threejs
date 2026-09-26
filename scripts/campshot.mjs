// Usage: node scripts/campshot.mjs <outPrefix> [faction] ; takes campaign screenshots at several zooms
import { chromium } from 'playwright';
const [,, out, faction = 'aldmere', extra = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:4173/?quickstart=${faction}&hq=1${extra}`);
await page.waitForTimeout(40000);
const views = [
  ['wide', 3200, 0.0],
  ['mid', 1100, 0.5],
  ['close', 320, 0.9],
  ['street', 110, 1.3],
];
for (const [name, dist, yaw] of views) {
  await page.evaluate(`(() => { const cs = window.__realm.campaign; const g = cs.sim.geo; const cap = g.provinces[cs.sim.fac(cs.sim.s.player).capital]; const c = cs.view.cam; c.yaw = c.goalYaw = ${yaw}; c.focus(cap.x, cap.z, ${dist}, true); document.getElementById('ui').style.opacity = '${name === 'wide' ? 1 : 0}'; })()`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}_${name}.png`, timeout: 120000 });
}
console.log([...new Set(logs)].filter((l) => !l.includes('PCFSoft')).slice(0, 20).join('\n'));
await browser.close();
