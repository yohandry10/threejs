// Usage: node scripts/qa/frametime.mjs "<url>" [waitMs]
import { chromium } from 'playwright';
const [,, url, wait = '40000'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[perf]')) console.log(`[${m.type()}] ${m.text()}`); });
const t0 = Date.now();
await page.goto(url);
await page.waitForTimeout(Number(wait));
const r = await page.evaluate(`new Promise((res) => { const ts = []; const f = (t) => { ts.push(performance.now()); if (ts.length < 4) requestAnimationFrame(f); else res({ state: window.__realm?.state, frames: ts.slice(1).map((v, i) => Math.round(v - ts[i])), info: (() => { const r = window.__realm?.host?.renderer; return r ? { calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures } : null; })() }); }; requestAnimationFrame(f); })`);
console.log(JSON.stringify(r), 'elapsed', Date.now() - t0);
await browser.close();
