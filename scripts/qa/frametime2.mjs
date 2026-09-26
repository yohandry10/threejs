// Usage: node scripts/qa/frametime2.mjs "<url>" ; measures frame time at several campaign zooms
import { chromium } from 'playwright';
const [,, url] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(40000);
const measure = `new Promise((res) => { const r = window.__realm.host.renderer; const ts = []; const f = (t) => { ts.push(performance.now()); if (ts.length === 2) r.info.reset(); if (ts.length < 4) requestAnimationFrame(f); else res({ frames: ts.slice(1).map((v, i) => Math.round(v - ts[i])), calls: r.info.render.calls, tris: r.info.render.triangles }); }; requestAnimationFrame(f); })`;
for (const [name, dist] of [['wide', 3200], ['mid', 1100], ['close', 320], ['street', 110]]) {
  await page.evaluate(`(() => { const cs = window.__realm.campaign; const g = cs.sim.geo; const cap = g.provinces[cs.sim.fac(cs.sim.s.player).capital]; cs.view.cam.focus(cap.x, cap.z, ${dist}, true); })()`);
  const t0 = Date.now();
  const r = await page.evaluate(measure);
  console.log(name, JSON.stringify(r), 'wall', Date.now() - t0);
}
await browser.close();
