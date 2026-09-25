import * as THREE from 'three';
import type { Sim } from '../../sim/context';
import { factionDef } from '../../data/factions';
import { unitDef, shipDef } from '../../data/units';
import { FigureBatch, ANIM, HANIM, emblemIndex, figureUniforms } from '../figures/figures';
import { ShipActor } from '../ships/shipActor';
import { makeFlagMaterial } from '../ships/shipBuilder';
import { heightAt, cellX, cellZ } from '../../sim/world/geo';
import { isVisible } from '../../sim/fog';
import { ringTexture } from '../textures';
import type { WaveSampler } from '../env/ocean';
import type { ArmyState, FleetState } from '../../sim/types';
import { hash01 } from '../../core/rng';

interface FigSlot {
  key: string;
  dx: number; // local offsets (right, forward)
  dz: number;
  mounted: boolean;
  barded: boolean;
  seed: number;
  general?: boolean;
}

interface ArmyVis {
  id: number;
  faction: string;
  x: number;
  z: number;
  heading: number;
  path: { x: number; z: number }[];
  moving: boolean;
  slots: FigSlot[];
  sig: string;
  flag: THREE.Mesh;
  pole: THREE.Mesh;
  ring: THREE.Mesh;
  tents?: THREE.Group;
  lastSeen: number;
}

interface FleetVis {
  id: number;
  faction: string;
  ships: ShipActor[];
  x: number;
  z: number;
  heading: number;
  path: { x: number; z: number }[];
  sig: string;
  ring: THREE.Mesh;
}

const tmpCol = new THREE.Color();

function slotsFor(a: ArmyState): FigSlot[] {
  const groups = new Map<string, number>();
  for (const u of a.units) groups.set(u.type, (groups.get(u.type) ?? 0) + u.troops);
  const total = [...groups.values()].reduce((s, v) => s + v, 0);
  const n = Math.max(3, Math.min(12, Math.round(3 + total / 180)));
  const list = [...groups.entries()].filter(([t]) => t !== 'bodyguard').sort((x, y) => y[1] - x[1]);
  const inf: string[] = [];
  const rng: string[] = [];
  const cav: string[] = [];
  const siege: string[] = [];
  for (const [t, c] of list) {
    const d = unitDef(t);
    const share = Math.max(1, Math.round((c / total) * n));
    const target = d.category === 'siege' ? siege : d.visual.mounted ? cav : d.range ? rng : inf;
    for (let i = 0; i < share; i++) target.push(t);
  }
  const slots: FigSlot[] = [];
  const row = (types: string[], dz: number, spacing: number, mounted: boolean) => {
    types.forEach((t, i) => {
      const dx = (i - (types.length - 1) / 2) * spacing;
      slots.push({ key: t, dx, dz, mounted, barded: !!unitDef(t).visual.barded, seed: hash01(a.id, i, dz * 10) });
    });
  };
  row(inf.slice(0, 5), 1.6, 2.2, false);
  row(rng.slice(0, 4), -1.2, 2.2, false);
  if (cav.length) {
    cav.slice(0, 4).forEach((t, i) => slots.push({ key: t, dx: (i % 2 ? 1 : -1) * (6 + Math.floor(i / 2) * 2.6), dz: 0.4, mounted: true, barded: !!unitDef(t).visual.barded, seed: hash01(a.id, 50 + i) }));
  }
  if (siege.length) slots.push({ key: 'crew', dx: 3, dz: -3.6, mounted: false, barded: false, seed: 0.3 });
  if (a.general !== undefined) slots.push({ key: 'bodyguard', dx: 0, dz: -3.8, mounted: true, barded: true, seed: hash01(a.id, 99), general: true });
  if (!slots.length) slots.push({ key: 'militia', dx: 0, dz: 0, mounted: false, barded: false, seed: 0.5 });
  return slots;
}

/** Armies and fleets on the campaign map, animated along their paths. */
export class Forces {
  group = new THREE.Group();
  batches = new Map<string, FigureBatch>();
  armies = new Map<number, ArmyVis>();
  fleets = new Map<number, FleetVis>();
  private poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 5);
  private flagGeo: THREE.PlaneGeometry;
  private ringGeo = new THREE.PlaneGeometry(1, 1);
  private ringMat: THREE.MeshBasicMaterial;
  private ringMatEnemy: THREE.MeshBasicMaterial;
  private ringMatAlly: THREE.MeshBasicMaterial;
  private poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  private tentGeo = new THREE.ConeGeometry(2.2, 3.2, 6);
  private tentMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.95 });
  selectedArmy: number | null = null;
  selectedFleet: number | null = null;
  hoverArmy: number | null = null;
  figScale = 2.6;
  plazaOf?: (pid: number) => THREE.Vector3 | null;
  time = 0;
  constructor(private sim: Sim) {
    this.flagGeo = new THREE.PlaneGeometry(1.6, 1.1, 6, 2);
    this.flagGeo.translate(0.8, 0, 0);
    this.ringGeo.rotateX(-Math.PI / 2);
    const mk = (c: number) => new THREE.MeshBasicMaterial({ map: ringTexture(), color: c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.ringMat = mk(0xf2d98a);
    this.ringMatEnemy = mk(0xd9463a);
    this.ringMatAlly = mk(0x7fc27a);
    for (const b of this.batches.values()) this.group.add(b.mesh);
  }
  private batch(key: string): FigureBatch {
    let b = this.batches.get(key);
    if (!b) {
      b = new FigureBatch(key, 32, true);
      this.batches.set(key, b);
      this.group.add(b.mesh);
    }
    return b;
  }
  /** Animate an army along the cells it just walked. */
  onArmyMoved(id: number, cells: number[]) {
    const v = this.armies.get(id);
    if (!v) return;
    const g = this.sim.geo;
    const pts = cells.map((c) => ({ x: cellX(g, c), z: cellZ(g, c) }));
    // retreat/landing jumps: animate straight
    v.path.push(...pts.slice(1));
    v.moving = v.path.length > 0;
  }
  onFleetMoved(id: number, cells: number[]) {
    const v = this.fleets.get(id);
    if (!v) return;
    const g = this.sim.geo;
    v.path.push(...cells.slice(1).map((c) => ({ x: cellX(g, c), z: cellZ(g, c) })));
  }
  sync() {
    const s = this.sim.s;
    const seen = new Set<number>();
    for (const a of Object.values(s.armies)) {
      if (a.embarked !== undefined) continue;
      const visible = a.faction === s.player || isVisible(this.sim, a.x, a.z);
      if (!visible) continue;
      seen.add(a.id);
      const sig = `${a.units.map((u) => u.type + Math.round(u.troops / 40)).join(',')}|${a.general ?? ''}|${a.faction}`;
      let v = this.armies.get(a.id);
      if (!v) {
        const flag = new THREE.Mesh(this.flagGeo, makeFlagMaterial(a.faction));
        const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
        ring.visible = false;
        ring.renderOrder = 5;
        this.group.add(flag, pole, ring);
        v = { id: a.id, faction: a.faction, x: a.x, z: a.z, heading: Math.PI, path: [], moving: false, slots: slotsFor(a), sig, flag, pole, ring, lastSeen: 0 };
        this.armies.set(a.id, v);
      } else if (v.sig !== sig) {
        v.slots = slotsFor(a);
        v.sig = sig;
        if (v.faction !== a.faction) {
          v.faction = a.faction;
          v.flag.material = makeFlagMaterial(a.faction);
        }
      }
      // armies garrisoned in a settlement stand in its square
      let tx = a.x;
      let tz = a.z;
      const pid = this.sim.geo.province[a.cell];
      if (pid >= 0 && this.plazaOf) {
        const pg = this.sim.geo.provinces[pid];
        if (Math.hypot(a.x - pg.x, a.z - pg.z) < pg.radius * 0.6) {
          const pl = this.plazaOf(pid);
          if (pl) {
            tx = pl.x;
            tz = pl.z;
          }
        }
      }
      // snap if far off (teleports: retreats, loads) and not animating
      if (!v.path.length && Math.hypot(v.x - tx, v.z - tz) > 1) v.path.push({ x: tx, z: tz });
      // siege camp
      const siege = a.siegeOf !== undefined;
      if (siege && !v.tents) {
        v.tents = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const t = new THREE.Mesh(this.tentGeo, this.tentMat);
          const ang = (i / 5) * Math.PI * 2;
          t.position.set(Math.cos(ang) * 14, 1.6, Math.sin(ang) * 14);
          t.castShadow = true;
          v.tents.add(t);
        }
        this.group.add(v.tents);
      } else if (!siege && v.tents) {
        this.group.remove(v.tents);
        v.tents = undefined;
      }
    }
    for (const [id, v] of this.armies) {
      if (!seen.has(id)) {
        this.group.remove(v.flag, v.pole, v.ring);
        if (v.tents) this.group.remove(v.tents);
        this.armies.delete(id);
      }
    }
    // fleets
    const fseen = new Set<number>();
    for (const f of Object.values(s.fleets)) {
      const visible = f.faction === s.player || isVisible(this.sim, f.x, f.z);
      if (!visible || !f.ships.length) continue;
      fseen.add(f.id);
      const types = [...f.ships].sort((a, b) => shipDef(b.type).hull - shipDef(a.type).hull).slice(0, 3).map((x) => x.type);
      const sig = types.join(',') + f.faction;
      let v = this.fleets.get(f.id);
      if (!v || v.sig !== sig) {
        if (v) for (const sh of v.ships) {
          sh.removeFrom(this.group);
          sh.dispose();
        }
        const ships = types.map((t) => {
          const a = new ShipActor(t, f.faction);
          a.addTo(this.group);
          return a;
        });
        const ring = v?.ring ?? new THREE.Mesh(this.ringGeo, this.ringMat);
        if (!v) {
          ring.visible = false;
          ring.renderOrder = 5;
          this.group.add(ring);
        }
        v = { id: f.id, faction: f.faction, ships, x: v?.x ?? f.x, z: v?.z ?? f.z, heading: v?.heading ?? 0, path: v?.path ?? [], sig, ring };
        this.fleets.set(f.id, v);
      }
      if (!v.path.length && Math.hypot(v.x - f.x, v.z - f.z) > 1) v.path.push({ x: f.x, z: f.z });
    }
    for (const [id, v] of this.fleets) {
      if (!fseen.has(id)) {
        for (const sh of v.ships) {
          sh.removeFrom(this.group);
          sh.dispose();
        }
        this.group.remove(v.ring);
        this.fleets.delete(id);
      }
    }
  }
  /** Current rendered position of an army (for UI markers / picking). */
  armyPos(id: number) {
    const v = this.armies.get(id);
    return v ? new THREE.Vector3(v.x, heightAt(this.sim.geo, v.x, v.z), v.z) : null;
  }
  fleetPos(id: number) {
    const v = this.fleets.get(id);
    return v ? new THREE.Vector3(v.x, 0, v.z) : null;
  }
  get animating() {
    for (const v of this.armies.values()) if (v.path.length) return true;
    for (const v of this.fleets.values()) if (v.path.length) return true;
    return false;
  }
  update(dt: number, camDist: number, waves: WaveSampler, windDir: number) {
    this.time += dt;
    figureUniforms.uTime.value = this.time;
    const g = this.sim.geo;
    const scale = this.figScale * Math.min(3.2, Math.max(1, camDist / 650));
    for (const b of this.batches.values()) b.count = 0;
    const player = this.sim.s.player;
    for (const v of this.armies.values()) {
      // advance along the path
      let moving = false;
      if (v.path.length) {
        const speed = 140 + v.path.length * 12;
        let step = speed * dt;
        while (step > 0 && v.path.length) {
          const t = v.path[0];
          const dx = t.x - v.x;
          const dz = t.z - v.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.01) {
            v.path.shift();
            continue;
          }
          if (d > 250) {
            v.x = t.x;
            v.z = t.z;
            v.path.shift();
            continue;
          }
          v.heading = Math.atan2(dx, dz);
          const mv = Math.min(d, step);
          v.x += (dx / d) * mv;
          v.z += (dz / d) * mv;
          step -= mv;
          if (mv >= d - 1e-4) v.path.shift();
          moving = true;
        }
      }
      v.moving = moving;
      const def = factionDef(v.faction);
      const ca = tmpCol.set(def.color).clone();
      const cb = new THREE.Color(def.color2);
      const emb = emblemIndex(v.faction);
      const ch = Math.cos(v.heading);
      const sh = Math.sin(v.heading);
      const s = scale / this.figScale;
      for (const sl of v.slots) {
        const lx = sl.dx * 1.5 * s;
        const lz = sl.dz * 1.5 * s;
        const wx = v.x + lx * ch + lz * sh;
        const wz = v.z - lx * sh + lz * ch;
        const gy = Math.max(0.3, heightAt(g, wx, wz));
        const state = moving ? (sl.mounted ? ANIM.ride : ANIM.walk) : sl.mounted ? ANIM.ride : sl.key === 'crew' ? ANIM.idle : ANIM.idle;
        const spd = moving ? (sl.mounted ? 1.9 : 1.6) : 1;
        const skin = Math.floor(sl.seed * 5.99);
        const variant = 1 + Math.floor(sl.seed * 2.99);
        if (sl.mounted) {
          const hb = this.batch(sl.barded ? 'horse_barded' : 'horse');
          hb.ensure(hb.count + 1);
          hb.set(hb.count++, wx, gy, wz, v.heading, moving ? HANIM.trot : HANIM.idle, 0, moving ? 1.9 : 1, sl.seed, ca, cb, 0, emb, scale, 1);
          const rb = this.batch(sl.key);
          rb.ensure(rb.count + 1);
          rb.set(rb.count++, wx, gy + 0.72 * scale, wz, v.heading, ANIM.ride, 0, moving ? 1.9 : 0.2, sl.seed, ca, cb, skin, emb, scale, variant);
        } else {
          const b = this.batch(sl.key);
          b.ensure(b.count + 1);
          b.set(b.count++, wx, gy, wz, v.heading, state, 0, spd, sl.seed, ca, cb, skin, emb, scale, variant);
        }
      }
      // standard
      const gy = Math.max(0.3, heightAt(g, v.x, v.z));
      const poleH = 5.5 * s * 1.6;
      v.pole.position.set(v.x - ch * 0.5, gy + poleH / 2, v.z + sh * 0.5 - 3.8 * s);
      v.pole.scale.set(s * 1.3, poleH, s * 1.3);
      v.flag.position.set(v.pole.position.x, gy + poleH - 0.7 * s * 2.2, v.pole.position.z);
      v.flag.scale.setScalar(s * 2.4);
      v.flag.rotation.y = v.heading - Math.PI / 2;
      // selection ring
      const sel = this.selectedArmy === v.id;
      const hov = this.hoverArmy === v.id;
      v.ring.visible = sel || hov;
      if (v.ring.visible) {
        v.ring.material = v.faction === player ? this.ringMat : this.ringMatEnemy;
        v.ring.position.set(v.x, gy + 0.6, v.z);
        const rs = 26 * s * (sel ? 1 + Math.sin(this.time * 4) * 0.04 : 0.9);
        v.ring.scale.set(rs, 1, rs);
      }
      if (v.tents) v.tents.position.set(v.x, gy, v.z);
    }
    for (const b of this.batches.values()) b.commit();
    // fleets
    const shipScale = Math.min(2.6, Math.max(1, camDist / 800));
    for (const v of this.fleets.values()) {
      let speed = 0;
      if (v.path.length) {
        let step = (110 + v.path.length * 10) * dt;
        while (step > 0 && v.path.length) {
          const t = v.path[0];
          const dx = t.x - v.x;
          const dz = t.z - v.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.01 || d > 400) {
            if (d > 400) {
              v.x = t.x;
              v.z = t.z;
            }
            v.path.shift();
            continue;
          }
          const target = Math.atan2(dx, dz);
          let dh = target - v.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          v.heading += dh * Math.min(1, dt * 4);
          const mv = Math.min(d, step);
          v.x += (dx / d) * mv;
          v.z += (dz / d) * mv;
          step -= mv;
          speed = 7;
          if (mv >= d - 1e-4) v.path.shift();
        }
      }
      const ch = Math.cos(v.heading);
      const sh2 = Math.sin(v.heading);
      v.ships.forEach((ship, i) => {
        const off = i === 0 ? [0, 0] : i === 1 ? [-22, -26] : [22, -30];
        const lx = off[0] * shipScale;
        const lz = off[1] * shipScale;
        const tx = v.x + lx * ch + lz * sh2;
        const tz = v.z - lx * sh2 + lz * ch;
        ship.x += (tx - ship.x) * Math.min(1, dt * 5);
        ship.z += (tz - ship.z) * Math.min(1, dt * 5);
        ship.heading = v.heading;
        ship.speed = speed || 0.4;
        ship.scale = shipScale;
        ship.update(dt, waves, windDir, 1);
        ship.setLampVisible(true);
      });
      const sel = this.selectedFleet === v.id;
      v.ring.visible = sel;
      if (sel) {
        v.ring.position.set(v.x, 1.2, v.z);
        const rs = 70 * shipScale;
        v.ring.scale.set(rs, 1, rs);
        v.ring.material = v.faction === player ? this.ringMat : this.ringMatEnemy;
      }
    }
  }
  dispose() {
    for (const b of this.batches.values()) b.dispose();
    for (const v of this.fleets.values()) for (const s of v.ships) s.dispose();
    this.poleGeo.dispose();
    this.flagGeo.dispose();
    this.ringGeo.dispose();
    this.tentGeo.dispose();
  }
}
export type { FleetState };
