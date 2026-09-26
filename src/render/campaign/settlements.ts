import * as THREE from 'three';
import type { Sim } from '../../sim/context';
import { archUniforms, type SettlementVisual } from '../architecture/settlementBuilder';
import { buildTown } from '../architecture/townBuilder';
import { makeFlagMaterial } from '../ships/shipBuilder';
import { glowTexture } from '../textures';

interface Entry {
  vis: SettlementVisual;
  sig: string;
  owner: string;
}

/** Keeps the 3D settlements in sync with the simulation (tier, walls, buildings, owner). */
export class Settlements {
  group = new THREE.Group();
  entries = new Map<number, Entry>();
  lampPoints: THREE.Points;
  lampMat: THREE.PointsMaterial;
  private lampGeo = new THREE.BufferGeometry();
  /** Town ground mask for the terrain shader (R = packed earth, G = gardens), 4 m texels. */
  groundTex: THREE.DataTexture;
  private groundStep = 4;
  constructor(private sim: Sim) {
    const gw = Math.ceil(sim.geo.W / this.groundStep);
    const gh = Math.ceil(sim.geo.H / this.groundStep);
    this.groundTex = new THREE.DataTexture(new Uint8Array(gw * gh * 2), gw, gh, THREE.RGFormat, THREE.UnsignedByteType);
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.minFilter = THREE.LinearFilter;
    this.groundTex.needsUpdate = true;
    this.lampMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb35c, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.lampPoints = new THREE.Points(this.lampGeo, this.lampMat);
    this.lampPoints.frustumCulled = false;
    this.group.add(this.lampPoints);
    this.syncAll();
  }
  private signature(pid: number) {
    const p = this.sim.s.provinces[pid];
    const st = p.settlement;
    const b = st.buildings
      .map((x) => x.id)
      .filter((x) => ['market', 'harbor', 'trade_docks', 'shipyard', 'barracks', 'stables', 'farm', 'fishery'].includes(x))
      .sort()
      .join(',');
    return `${st.tier}|${st.walls}|${b}`;
  }
  syncAll() {
    let lampsChanged = false;
    for (const p of this.sim.s.provinces) {
      const sig = this.signature(p.id);
      const e = this.entries.get(p.id);
      if (!e || e.sig !== sig) {
        if (e) {
          this.group.remove(e.vis.group);
          e.vis.dispose();
        }
        const pg = this.sim.geo.provinces[p.id];
        const vis = buildTown({
          geo: this.sim.geo,
          pg,
          tier: p.settlement.tier,
          walls: p.settlement.walls,
          fortress: p.settlement.fortress,
          isCapital: pg.anchor.kind === 'capital',
          buildings: new Set(p.settlement.buildings.map((b) => b.id)),
          owner: p.owner,
        });
        this.group.add(vis.group);
        this.entries.set(p.id, { vis, sig, owner: p.owner });
        lampsChanged = true;
      } else if (e.owner !== p.owner) {
        const mat = makeFlagMaterial(p.owner);
        for (const f of e.vis.flags) f.material = mat;
        e.owner = p.owner;
      }
    }
    if (lampsChanged) {
      this.composeGround();
      const pts: number[] = [];
      for (const e of this.entries.values()) for (const l of e.vis.lamps) pts.push(l.x, l.y, l.z);
      this.lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.lampGeo.computeBoundingSphere();
    }
  }
  private composeGround() {
    const img = this.groundTex.image as { data: Uint8Array; width: number; height: number };
    const out = img.data;
    out.fill(0);
    const W = img.width;
    for (const e of this.entries.values()) {
      const g = e.vis.ground;
      if (!g) continue;
      const ox = Math.round(g.x0 / this.groundStep);
      const oz = Math.round(g.z0 / this.groundStep);
      for (let j = 0; j < g.h; j++) {
        const tj = oz + j;
        if (tj < 0 || tj >= img.height) continue;
        for (let i = 0; i < g.w; i++) {
          const ti = ox + i;
          if (ti < 0 || ti >= W) continue;
          const o = (tj * W + ti) * 2;
          const k = (j * g.w + i) * 2;
          out[o] = Math.max(out[o], g.data[k]);
          out[o + 1] = Math.max(out[o + 1], g.data[k + 1]);
        }
      }
    }
    this.groundTex.needsUpdate = true;
  }
  update(dt: number, lamp: number, wind: number) {
    archUniforms.uLamp.value = lamp;
    this.lampMat.opacity = lamp * 0.9;
    this.lampPoints.visible = lamp > 0.02;
    for (const e of this.entries.values()) for (const m of e.vis.mills) m.rotation.z += dt * 0.6 * wind;
  }
  dispose() {
    for (const e of this.entries.values()) e.vis.dispose();
    this.lampGeo.dispose();
    this.lampMat.dispose();
    this.groundTex.dispose();
  }
}
