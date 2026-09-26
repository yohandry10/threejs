// Usage: npx tsx scripts/qa/rivermap.ts <river> <out.png> : top-down height map around a river's lower course
import { generateWorld } from '../../src/sim/world/worldGen';
import { heightAt } from '../../src/sim/world/geo';
import { writePNG } from '../png';
const [,, name = 'Wend', out = 'qa-out/rivermap.png'] = process.argv;
const g = generateWorld();
const r = g.rivers.find((x) => x.name === name)!;
const n = r.widths.length;
const m = r.mouth ?? n - 1;
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
for (let i = Math.max(0, m - 120); i < n; i++) {
  x0 = Math.min(x0, r.pts[i * 2]); x1 = Math.max(x1, r.pts[i * 2]);
  z0 = Math.min(z0, r.pts[i * 2 + 1]); z1 = Math.max(z1, r.pts[i * 2 + 1]);
}
x0 -= 300; x1 += 300; z0 -= 300; z1 += 300;
const S = 4;
const W = Math.ceil((x1 - x0) / S), H = Math.ceil((z1 - z0) / S);
const img = new Uint8Array(W * H * 4);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const h = heightAt(g, x0 + i * S, z0 + j * S);
    const c = h >= 0 ? [60 + Math.min(150, h * 3), 120 + Math.min(100, h * 2), 50] : [10, 40 + Math.max(0, 80 + h * 4), 120 + Math.max(0, 100 + h * 2)];
    img.set([...c.map(Math.round), 255], (j * W + i) * 4);
  }
for (let i = 0; i < n; i++) {
  const px = Math.round((r.pts[i * 2] - x0) / S), pz = Math.round((r.pts[i * 2 + 1] - z0) / S);
  if (px < 1 || pz < 1 || px >= W - 1 || pz >= H - 1) continue;
  const col = i < m ? [255, 40, 40] : [255, 240, 0];
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) img.set([...col, 255], ((pz + dz) * W + px + dx) * 4);
}
writePNG(out, W, H, img);
console.log('bbox', x0 | 0, x1 | 0, z0 | 0, z1 | 0, 'size', W, H, 'n', n, 'mouth', m);
