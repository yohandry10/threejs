import type { ProvinceAnchor } from '../../data/worldLayout';

export const enum Biome {
  Deep = 0,
  Sea = 1,
  Beach = 2,
  Grass = 3,
  Farm = 4,
  Forest = 5,
  Conifer = 6,
  Hills = 7,
  Rock = 8,
  Snow = 9,
  Dry = 10,
  Tundra = 11,
  Ash = 12,
  Marsh = 13,
}

export const enum NavT {
  Deep = 0,
  Shallow = 1,
  Plains = 2,
  Forest = 3,
  Hills = 4,
  Mountain = 5,
  Impassable = 6,
}

export type TerrainKind = 'plains' | 'forest' | 'hills' | 'mountain' | 'coast' | 'snow' | 'dry' | 'farmland';

export interface ProvinceGeo {
  id: number;
  name: string;
  region: string;
  landmass: number;
  anchor: ProvinceAnchor;
  x: number;
  z: number;
  cell: number;
  radius: number; // settlement footprint radius
  port: boolean;
  portCell: number;
  portX: number;
  portZ: number;
  coastAngle: number; // angle (radians, atan2(dz,dx)) from settlement to sea
  cells: number;
  neighbors: number[];
  cx: number;
  cz: number;
  terrain: TerrainKind;
  resources: string[];
  fertility: number;
  seaZone: number;
  elevation: number;
}

export interface RiverGeo {
  name: string;
  pts: Float32Array; // x,z pairs
  widths: Float32Array;
  levels: Float32Array; // water surface height
}

export interface RoadGeo {
  a: number;
  b: number;
  pts: Float32Array; // x,z pairs smoothed
  cells: number[];
}

export interface BridgeGeo {
  x: number;
  z: number;
  angle: number;
  length: number;
  y: number;
}

export interface WorldGeo {
  W: number;
  H: number;
  hmW: number;
  hmH: number;
  hmStep: number;
  height: Float32Array;
  biome: Uint8Array;
  moisture: Uint8Array;
  navW: number;
  navH: number;
  navStep: number;
  nav: Uint8Array;
  road: Uint8Array;
  river: Uint8Array;
  province: Int16Array;
  landmass: Uint8Array;
  seaZone: Uint8Array;
  coastDist: Int16Array; // + land distance to sea (cells), - water distance to land
  provinces: ProvinceGeo[];
  rivers: RiverGeo[];
  roads: RoadGeo[];
  bridges: BridgeGeo[];
}

export function heightAt(g: WorldGeo, x: number, z: number): number {
  const fx = Math.max(0, Math.min(g.hmW - 1.001, x / g.hmStep));
  const fz = Math.max(0, Math.min(g.hmH - 1.001, z / g.hmStep));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = g.height;
  const w = g.hmW;
  const a = h[iz * w + ix];
  const b = h[iz * w + ix + 1];
  const c = h[(iz + 1) * w + ix];
  const d = h[(iz + 1) * w + ix + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export function biomeAt(g: WorldGeo, x: number, z: number): number {
  const ix = Math.max(0, Math.min(g.hmW - 1, Math.round(x / g.hmStep)));
  const iz = Math.max(0, Math.min(g.hmH - 1, Math.round(z / g.hmStep)));
  return g.biome[iz * g.hmW + ix];
}

export const cellOf = (g: WorldGeo, x: number, z: number) => {
  const cx = Math.max(0, Math.min(g.navW - 1, Math.floor(x / g.navStep)));
  const cz = Math.max(0, Math.min(g.navH - 1, Math.floor(z / g.navStep)));
  return cz * g.navW + cx;
};
export const cellX = (g: WorldGeo, c: number) => ((c % g.navW) + 0.5) * g.navStep;
export const cellZ = (g: WorldGeo, c: number) => (Math.floor(c / g.navW) + 0.5) * g.navStep;
export const isWaterCell = (g: WorldGeo, c: number) => g.nav[c] <= NavT.Shallow;
export const isLandCell = (g: WorldGeo, c: number) => g.nav[c] >= NavT.Plains && g.nav[c] < NavT.Impassable;

export function neighbors8(g: WorldGeo, c: number, out: number[]): number[] {
  out.length = 0;
  const x = c % g.navW;
  const z = (c / g.navW) | 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= g.navW || nz >= g.navH) continue;
      out.push(nz * g.navW + nx);
    }
  return out;
}
