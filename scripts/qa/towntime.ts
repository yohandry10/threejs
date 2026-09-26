import './canvasStub';
import * as THREE from 'three';
import { generateWorld } from '../../src/sim/world/worldGen';
import { newCampaign } from '../../src/sim/setup';
import { buildTown } from '../../src/render/architecture/townBuilder';
const geo = generateWorld();
const sim = newCampaign(geo, 'aldmere', 12345);
let total = 0;
let tris = 0;
const only = process.argv[2];
for (const p of sim.s.provinces) {
  const pg = geo.provinces[p.id];
  if (only && pg.name !== only && String(p.id) !== only) continue;
  const t0 = performance.now();
  const vis = buildTown({ geo, pg, tier: p.settlement.tier, walls: p.settlement.walls, fortress: p.settlement.fortress, isCapital: pg.anchor.kind === 'capital', buildings: new Set(p.settlement.buildings.map((b) => b.id)), owner: p.owner });
  const dt = performance.now() - t0;
  total += dt;
  let t = 0;
  let tLo = 0;
  const lod = vis.group.children[0] as THREE.LOD;
  lod.levels[0].object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) t += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; });
  lod.levels[1].object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tLo += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; });
  tris += t;
  console.log(pg.id, pg.name.padEnd(14), 'tier', p.settlement.tier, 'walls', p.settlement.walls, 'R', pg.radius.toFixed(0), 'ms', dt.toFixed(0), 'tris', t, 'lo', tLo);
}
console.log('total ms', total.toFixed(0), 'tris', tris);
