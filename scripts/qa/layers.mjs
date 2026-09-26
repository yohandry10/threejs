// Usage: node scripts/qa/layers.mjs outPrefix "<js returning [x,z,dist,yaw]>" ; renders the view with layers toggled
import { chromium } from 'playwright';
const [,, out, where, extra = '&weather=clear&tod=0.4'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:4173/?quickstart=aldmere&hq=1${extra}`);
await page.waitForTimeout(40000);
await page.evaluate(`(() => { const cs = window.__realm.campaign; const r = (${where})(cs); const c = cs.view.cam; c.yaw = c.goalYaw = r[3] ?? 0; c.focus(r[0], r[1], r[2], true); document.getElementById('ui').style.opacity = '0'; })()`);
const variants = [
  ['noriver', 'v.water.group.children[1].visible=false'],
  ['noocean', 'v.water.group.children[1].visible=true; v.ocean.mesh.visible=false'],
];
for (const [name, js] of variants) {
  await page.evaluate(`(() => { const v = window.__realm.campaign.view; ${js}; })()`);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}_${name}.png`, timeout: 120000 });
}
await browser.close();
