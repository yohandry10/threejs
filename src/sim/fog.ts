import type { Sim } from './context';
import { isAllied } from './diplomacy';
import { sumEffect } from './economy';
import type { FactionId } from './types';

function getBits(sim: Sim, key: string): Uint8Array {
  let a = sim.cache.get(key) as Uint8Array | undefined;
  if (!a) {
    a = new Uint8Array(sim.geo.navW * sim.geo.navH);
    sim.cache.set(key, a);
  }
  return a;
}

export function exploredBits(sim: Sim): Uint8Array {
  return getBits(sim, 'explored');
}
export function visibleBits(sim: Sim): Uint8Array {
  return getBits(sim, 'visible');
}

function stamp(sim: Sim, arr: Uint8Array, x: number, z: number, radiusCells: number) {
  const g = sim.geo;
  const cx = Math.floor(x / g.navStep);
  const cz = Math.floor(z / g.navStep);
  const r = Math.ceil(radiusCells);
  const r2 = radiusCells * radiusCells;
  for (let dz = -r; dz <= r; dz++) {
    const zz = cz + dz;
    if (zz < 0 || zz >= g.navH) continue;
    for (let dx = -r; dx <= r; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= g.navW) continue;
      if (dx * dx + dz * dz <= r2) arr[zz * g.navW + xx] = 1;
    }
  }
}

/** Recompute the player's visibility and accumulate exploration. */
export function updateFog(sim: Sim, fid: FactionId = sim.s.player) {
  const g = sim.geo;
  const vis = visibleBits(sim);
  vis.fill(0);
  const sees = (owner: FactionId) => owner === fid || isAllied(sim, owner, fid) || (sim.fac(fid)?.intelOn[owner] ?? -1) > sim.s.turn;
  const ownedProv = new Uint8Array(sim.s.provinces.length);
  for (const p of sim.s.provinces) {
    if (p.owner === fid || isAllied(sim, p.owner, fid)) ownedProv[p.id] = 1;
    if (!sees(p.owner)) continue;
    const pg = g.provinces[p.id];
    stamp(sim, vis, pg.x, pg.z, 16 + p.settlement.tier * 3 + sumEffect(p, 'vision') * 2);
  }
  for (let c = 0; c < vis.length; c++) {
    const pid = g.province[c];
    if (pid >= 0 && ownedProv[pid]) vis[c] = 1;
  }
  for (const a of Object.values(sim.s.armies)) {
    if (!sees(a.faction)) continue;
    const scouts = a.units.some((u) => u.type === 'light_cavalry');
    stamp(sim, vis, a.x, a.z, scouts ? 15 : 11);
  }
  for (const f of Object.values(sim.s.fleets)) {
    if (!sees(f.faction)) continue;
    stamp(sim, vis, f.x, f.z, 13);
  }
  const exp = exploredBits(sim);
  for (let i = 0; i < vis.length; i++) if (vis[i]) exp[i] = 1;
  sim.cache.set('fogVersion', ((sim.cache.get('fogVersion') as number) ?? 0) + 1);
}

export function initFog(sim: Sim) {
  const fid = sim.s.player;
  const exp = exploredBits(sim);
  exp.fill(0);
  const g = sim.geo;
  const f = sim.fac(fid);
  if (f?.explored) {
    decodeExplored(sim, f.explored);
    updateFog(sim);
    return;
  }
  const homeLandmass = new Set(sim.provincesOf(fid).map((p) => g.provinces[p.id].landmass));
  for (let c = 0; c < exp.length; c++) if (homeLandmass.has(g.landmass[c])) exp[c] = 1;
  for (const p of sim.provincesOf(fid)) {
    const pg = g.provinces[p.id];
    stamp(sim, exp, pg.x, pg.z, 42);
  }
  // known great capitals and trade partners' ports
  for (const pg of g.provinces) {
    if (pg.anchor.greatCapital) stamp(sim, exp, pg.x, pg.z, 10);
  }
  updateFog(sim);
}

export function isVisible(sim: Sim, x: number, z: number): boolean {
  const g = sim.geo;
  const cx = Math.floor(x / g.navStep);
  const cz = Math.floor(z / g.navStep);
  if (cx < 0 || cz < 0 || cx >= g.navW || cz >= g.navH) return false;
  return visibleBits(sim)[cz * g.navW + cx] === 1;
}

export function isExplored(sim: Sim, x: number, z: number): boolean {
  const g = sim.geo;
  const cx = Math.floor(x / g.navStep);
  const cz = Math.floor(z / g.navStep);
  if (cx < 0 || cz < 0 || cx >= g.navW || cz >= g.navH) return false;
  return exploredBits(sim)[cz * g.navW + cx] === 1;
}

export function encodeExplored(sim: Sim): string {
  const exp = exploredBits(sim);
  const bytes = new Uint8Array(Math.ceil(exp.length / 8));
  for (let i = 0; i < exp.length; i++) if (exp[i]) bytes[i >> 3] |= 1 << (i & 7);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeExplored(sim: Sim, b64: string) {
  const exp = exploredBits(sim);
  const bin = atob(b64);
  for (let i = 0; i < exp.length; i++) exp[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
}
