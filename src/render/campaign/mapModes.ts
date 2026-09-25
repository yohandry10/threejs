import * as THREE from 'three';
import type { Sim } from '../../sim/context';
import { factionDef, ALL_FACTION_DEFS } from '../../data/factions';
import { atWar, isAllied, opinion, overlordOf } from '../../sim/diplomacy';
import { exploredBits, visibleBits } from '../../sim/fog';
import { armyPower } from '../../sim/military';

export type MapMode = 'terrain' | 'political' | 'diplomatic' | 'economic' | 'military';
export const MAP_MODES: { id: MapMode; label: string; key: string }[] = [
  { id: 'terrain', label: 'Terrain', key: '1' },
  { id: 'political', label: 'Political', key: '2' },
  { id: 'diplomatic', label: 'Diplomatic', key: '3' },
  { id: 'economic', label: 'Economic', key: '4' },
  { id: 'military', label: 'Military', key: '5' },
];

const col = (hex: string) => new THREE.Color(hex);

export function computeModeColors(sim: Sim, mode: MapMode, out: Uint8Array) {
  out.fill(0);
  const player = sim.s.player;
  let maxIncome = 1;
  for (const p of sim.s.provinces) maxIncome = Math.max(maxIncome, p.income);
  const threat = new Float32Array(sim.s.provinces.length);
  if (mode === 'military') {
    for (const a of Object.values(sim.s.armies)) {
      if (!atWar(sim, a.faction, player)) continue;
      const vis = sim.cache.get('visible') as Uint8Array | undefined;
      if (vis && !vis[a.cell]) continue;
      for (const p of sim.s.provinces) {
        if (p.owner !== player) continue;
        const pg = sim.geo.provinces[p.id];
        const d = Math.hypot(pg.x - a.x, pg.z - a.z);
        if (d < 900) threat[p.id] += armyPower(sim, a) / (1 + d / 200);
      }
    }
  }
  for (const p of sim.s.provinces) {
    const i = (p.id + 1) * 4;
    const def = factionDef(p.owner);
    let c = col(def.color);
    let a = 0;
    switch (mode) {
      case 'terrain':
        a = 0.1;
        break;
      case 'political':
        a = 0.5;
        break;
      case 'diplomatic': {
        if (p.owner === player) c = col('#d4af37');
        else if (overlordOf(sim, p.owner) === player) c = col('#7fb2a0');
        else if (isAllied(sim, p.owner, player)) c = col('#3f9a4a');
        else if (atWar(sim, p.owner, player)) c = col('#b3261e');
        else {
          const op = opinion(sim, player, p.owner);
          c = op > 20 ? col('#8fb86a') : op < -20 ? col('#b86a4a') : col('#8c8c84');
        }
        a = 0.55;
        break;
      }
      case 'economic': {
        const t = Math.min(1, p.income / maxIncome);
        c = new THREE.Color().setHSL(0.02 + t * 0.12, 0.7, 0.25 + t * 0.35);
        if (p.settlement.isPort && p.settlement.buildings.some((b) => b.id === 'trade_docks' || b.id === 'harbor')) c.lerp(col('#e6c25a'), 0.35);
        a = 0.6;
        break;
      }
      case 'military': {
        if (p.owner === player) {
          const t = Math.min(1, threat[p.id] / 40);
          c = new THREE.Color('#3d6a8c').lerp(col('#c0392b'), t);
          a = 0.35 + t * 0.35;
        } else if (atWar(sim, p.owner, player)) {
          c = col('#7a1f18');
          a = 0.45;
        } else {
          c = col('#555555');
          a = 0.3;
        }
        break;
      }
    }
    out[i] = Math.round(c.r * 255);
    out[i + 1] = Math.round(c.g * 255);
    out[i + 2] = Math.round(c.b * 255);
    out[i + 3] = Math.round(a * 255);
  }
}

export function computeOwnerColors(sim: Sim, out: Uint8Array) {
  out.fill(0);
  for (const p of sim.s.provinces) {
    const i = (p.id + 1) * 4;
    const def = factionDef(p.owner);
    const c = col(def.color).lerp(col(def.color2), 0.25);
    out[i] = Math.round(c.r * 255);
    out[i + 1] = Math.round(c.g * 255);
    out[i + 2] = Math.round(c.b * 255);
    out[i + 3] = ALL_FACTION_DEFS.findIndex((f) => f.id === p.owner) + 1;
  }
}

export function writeFogTexture(sim: Sim, data: Uint8Array) {
  const exp = exploredBits(sim);
  const vis = visibleBits(sim);
  for (let i = 0; i < exp.length; i++) {
    data[i * 4] = exp[i] ? 255 : 0;
    data[i * 4 + 1] = vis[i] ? 255 : 0;
  }
}
