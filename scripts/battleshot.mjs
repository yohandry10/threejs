// Usage: node scripts/battleshot.mjs <url> <outPrefix> <loadMs> <fightSec> [camJs]
import { chromium } from 'playwright';
const [,, url, out, loadMs = '50000', fightSec = '20', camJs = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(Number(loadMs));
await page.screenshot({ path: `${out}_0.png` });
await page.evaluate(`(() => { const b = window.__realm.battle; b.begin(); b.setSpeed(4); })()`);
// fast-forward the simulation directly (swiftshader renders slowly)
await page.evaluate(`(() => { const b = window.__realm.battle; const s = b.bsim || b.ns; const ais = b.dep ? b.dep.ais : b.ais; for (let t = 0; t < ${Number(fightSec)} ; t += 1/30) { for (const a of ais) a.update(1/30); s.update(1/30); s.events.length = 0; } })()`);
if (camJs) await page.evaluate(camJs);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}_1.png` });
const info = await page.evaluate(`(() => { const b = window.__realm.battle; const s = b.bsim || b.ns; return JSON.stringify({ season: b.setup.season, weather: b.setup.weather, terrain: b.setup.terrain, snowy: b.dep && b.dep.field.snowy, t: s.time, winner: s.winner, fps: window.__realm.fps, stats: window.__realm.host.stats }); })()`);
console.log(info);
console.log([...new Set(logs)].slice(0, 30).join('\n'));
await browser.close();
