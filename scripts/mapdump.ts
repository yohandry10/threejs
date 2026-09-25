import { generateWorld } from '../src/sim/world/worldGen';
import { writePNG } from './png';
import { ANCHORS } from '../src/data/worldLayout';
import { factionDef } from '../src/data/factions';

const t0 = performance.now();
const g = generateWorld((p, l) => {});
console.log('world gen ms', (performance.now() - t0).toFixed(0));
const W = g.navW, H = g.navH;
const img = new Uint8Array(W * H * 4);
const biomeCol: Record<number, number[]> = {0:[20,40,90],1:[40,80,140],2:[220,200,150],3:[110,150,70],4:[180,170,80],5:[40,100,40],6:[30,70,50],7:[130,130,80],8:[120,110,100],9:[240,240,245],10:[180,160,90],11:[140,140,110],12:[70,60,55],13:[70,90,70]};
for (let c = 0; c < W * H; c++) {
  const x = c % W, z = Math.floor(c / W);
  const b = g.biome[(z * 2) * g.hmW + x * 2];
  let col = biomeCol[b] ?? [255, 0, 255];
  const pid = g.province[c];
  if (pid >= 0) {
    const f = factionDef(ANCHORS[pid].owner);
    const hex = parseInt(f.color.slice(1), 16);
    const fc = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    col = col.map((v, i) => v * 0.55 + fc[i] * 0.45);
    // border
    const r = g.province[c + 1], d = g.province[c + W];
    if ((r !== undefined && r !== pid && r >= 0) || (d !== undefined && d !== pid && d >= 0)) col = [20, 20, 20];
  }
  if (g.nav[c] === 6) col = col.map((v) => v * 0.5);
  if (g.river[c]) col = [60, 120, 220];
  if (g.road[c] === 1) col = [110, 70, 40];
  if (g.road[c] === 2) col = [255, 255, 0];
  img.set([...col.map(Math.round), 255], c * 4);
}
for (const p of g.provinces) {
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) img.set([255, 255, 255, 255], (p.cell + dz * W + dx) * 4);
  if (p.port) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) img.set([255, 0, 0, 255], (p.portCell + dz * W + dx) * 4);
}
writePNG('qa-out/map_nav.png', W, H, img);
// heightmap
const hi = new Uint8Array(g.hmW * g.hmH * 4);
for (let i = 0; i < g.hmW * g.hmH; i++) {
  const h = g.height[i];
  const v = h < 0 ? [0, 0, Math.max(40, 160 + h)] : [Math.min(255, h * 0.6), Math.min(255, 80 + h * 0.5), Math.min(255, h * 0.6)];
  hi.set([...v.map(Math.round), 255], i * 4);
}
writePNG('qa-out/map_height.png', g.hmW, g.hmH, hi);
console.log('provinces', g.provinces.length, 'roads', g.roads.length, 'bridges', g.bridges.length);
for (const p of g.provinces) console.log(p.id, p.name, 'lm', p.landmass, 'cells', p.cells, 'port', p.port, 'terrain', p.terrain, 'nbrs', p.neighbors.length, 'elev', p.elevation.toFixed(1));
