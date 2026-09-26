import { generateWorld } from '../../src/sim/world/worldGen';
import { heightAt } from '../../src/sim/world/geo';
const g = generateWorld();
const r = g.rivers.find((r) => r.name === 'Wend')!;
const n = r.widths.length;
console.log('mouth pt', r.pts[r.mouth! * 2].toFixed(0), r.pts[r.mouth! * 2 + 1].toFixed(0), 'last', r.pts[(n - 1) * 2].toFixed(0), r.pts[(n - 1) * 2 + 1].toFixed(0));
for (const z of [2520, 2560, 2600, 2640, 2680]) {
  const row: string[] = [];
  for (let x = 480; x >= 0; x -= 40) row.push(heightAt(g, x, z).toFixed(1).padStart(6));
  console.log('z', z, row.join(''));
}
// roads near
for (const rd of g.roads) {
  const pts = rd.pts;
  for (let i = 0; i < pts.length / 2; i++) if (Math.abs(pts[i * 2 + 1] - 2600) < 60 && pts[i * 2] < 480) { console.log('road', rd.a, rd.b, 'passes', pts[i * 2].toFixed(0), pts[i * 2 + 1].toFixed(0)); break; }
}
for (const b of g.bridges) if (b.x < 600 && Math.abs(b.z - 2600) < 200) console.log('bridge', b);
console.log('nav types rows cz 155..170, cx 0..34 (D=deep S=shallow .=plains etc)');
for (let cz = 155; cz <= 170; cz++) {
  let row = '';
  for (let cx = 0; cx <= 34; cx++) {
    const c = cz * g.navW + cx;
    const t = g.nav[c];
    row += t === 0 ? 'D' : t === 1 ? 'S' : String(t);
  }
  let prow = '';
  for (let cx = 0; cx <= 34; cx++) { const p = g.province[cz * g.navW + cx]; prow += p < 0 ? '-' : String.fromCharCode(65 + (p % 26)); }
  console.log(cz, row, prow);
}
