import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import type { App } from '../app/app';
import type { Sim } from '../sim/context';
import type { BattleOutcome, BattleSetup } from '../sim/battles';
import { Environment } from '../render/env/environment';
import { Ocean } from '../render/env/ocean';
import { ShipActor, WakeTrail } from '../render/ships/shipActor';
import { syncShipLighting } from '../render/ships/shipBuilder';
import { StrategyCamera } from '../render/campaign/campaignCamera';
import { FigureBatch, ANIM, emblemIndex, emblemAtlas, figureUniforms } from '../render/figures/figures';
import { puffTexture, ringTexture } from '../render/textures';
import { factionDef } from '../data/factions';
import { deployNaval, navalOutcome, NavalSim, NavalAI, SEA_R, type NShip } from '../battle/naval';
import type { Side } from '../battle/sim';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { BattlePhase } from './battleScene';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();
const tmpV = new THREE.Vector3();

interface CrewFig {
  lx: number;
  lz: number;
  seed: number;
  idx: number;
}

/** Real-time naval battle scene. */
export class NavalBattleScene implements GameScene {
  readonly name = 'naval';
  scene = new THREE.Scene();
  env: Environment;
  ocean: Ocean;
  cam: StrategyCamera;
  ns: NavalSim;
  ais: NavalAI[];
  side: Side;
  phase: BattlePhase = 'deploy';
  speed = 1;
  paused = false;
  menuOpen = false;
  selected = new Set<NShip>();
  hovered: NShip | null = null;
  toast: { text: string; t: number } | null = null;
  boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private actors = new Map<number, ShipActor>();
  private crew = new Map<number, CrewFig[]>();
  private batch: FigureBatch;
  private rings: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private splash: THREE.Points;
  private splashData: { x: number; y: number; z: number; vy: number; life: number; size: number }[] = [];
  private time = 0;
  private overT = 0;
  private finished = false;
  private drag: { button: number; x: number; y: number; moved: boolean } | null = null;
  private pointer = { x: 0, y: 0 };
  private notifyT = 0;

  constructor(
    public sim: Sim,
    public setup: BattleSetup,
    public app: App,
    private done: (o: BattleOutcome) => void,
  ) {
    const d = deployNaval(sim, setup);
    this.ns = d.ns;
    this.ais = d.ais;
    this.side = d.playerSide ?? 0;
    this.env = new Environment(this.scene);
    this.env.t = new Rng(setup.seed).range(0.3, 0.66);
    this.env.paused = true;
    this.env.baseFogDensity = 0.00022;
    this.env.setWeather(setup.weather as never, setup.season, true);
    const sun = this.env.sun;
    sun.castShadow = app.settings.shadows > 0;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    this.ocean = new Ocean(this.env.uniforms, null, new THREE.Vector2(1, 1), app.settings.water);
    this.scene.add(this.ocean.mesh);
    this.ocean.enableReflection(this.scene);
    const bounds = new THREE.Box2(new THREE.Vector2(-SEA_R, -SEA_R), new THREE.Vector2(SEA_R, SEA_R));
    this.cam = new StrategyCamera(window.innerWidth / window.innerHeight, bounds, () => 0, app.settings.keys);
    this.cam.minDist = 30;
    this.cam.maxDist = 1400;
    this.cam.minPitch = 0.22;
    this.cam.sensitivity = app.settings.mouseSensitivity;
    emblemAtlas();
    this.batch = new FigureBatch('crew', 400, false);
    this.scene.add(this.batch.mesh);
    for (const s of this.ns.ships) {
      const a = new ShipActor(s.type, s.faction);
      a.x = s.x;
      a.z = s.z;
      a.heading = s.heading;
      a.addTo(this.scene);
      a.setLampVisible(this.env.lampFactor > 0.3);
      this.actors.set(s.id, a);
      const figs: CrewFig[] = [];
      const n = clamp(Math.round(s.crew / 9), 4, 18);
      const L = s.def.length;
      const B = a.model.params.beam;
      const def = factionDef(s.faction);
      const ca = new THREE.Color(def.color);
      const cb = new THREE.Color(def.color2);
      for (let k = 0; k < n; k++) {
        const idx = this.batch.count++;
        this.batch.ensure(this.batch.count);
        const seed = (s.id * 31 + k * 7.13) % 1;
        figs.push({ lx: ((k % 3) - 1) * B * 0.25, lz: (Math.floor(k / 3) / Math.ceil(n / 3) - 0.45) * L * 0.7, seed, idx });
        this.batch.set(idx, 0, -100, 0, 0, 0, 0, 1, seed, ca, cb, Math.floor(seed * 5.99), emblemIndex(s.faction), 1, 1 + (k % 3));
      }
      this.crew.set(s.id, figs);
    }
    this.batch.commit(true);
    const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false }), 64);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    this.arrows = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 3).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }), 3000);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    sg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(600), 1));
    this.splash = new THREE.Points(sg, new THREE.PointsMaterial({ map: puffTexture(), size: 6, transparent: true, depthWrite: false, color: 0xe8f0f4, sizeAttenuation: true }));
    this.splash.frustumCulled = false;
    this.scene.add(this.rings, this.arrows, this.splash);
    const mine = this.ns.ships.filter((s) => s.side === this.side);
    const cx = mine.reduce((a, s) => a + s.x, 0) / Math.max(1, mine.length);
    const cz = mine.reduce((a, s) => a + s.z, 0) / Math.max(1, mine.length);
    this.cam.yaw = this.cam.goalYaw = this.side === 0 ? 0 : Math.PI;
    this.cam.focus(cx, cz + (this.side === 0 ? -60 : 60), 380, true);
    this.bindInput();
    if (!this.playerShips().length) this.begin();
  }
  get camera() {
    return this.cam.camera;
  }

  playerShips() {
    return this.ns.ships.filter((s) => s.side === this.side && !s.ai);
  }
  strength(side: Side) {
    return this.ns.strength(side);
  }
  showToast(text: string) {
    this.toast = { text, t: performance.now() };
    this.app.notify();
  }
  begin() {
    if (this.phase !== 'deploy') return;
    this.phase = 'fight';
    this.ns.started = true;
    this.app.audio.battleSound('horn', 0, 1);
    this.showToast('Battle stations! Right-click an enemy ship to engage, Shift+right-click to board.');
  }
  setSpeed(s: number) {
    this.speed = s;
    this.paused = false;
    this.app.notify();
  }
  togglePause() {
    this.paused = !this.paused;
    this.app.notify();
  }
  withdraw() {
    if (this.phase === 'deploy') this.begin();
    this.ns.withdraw(this.side);
    this.showToast('The fleet breaks off and makes for open water.');
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.ns.winner === null) this.ns.finish(this.side === 0 ? 1 : 0, 'Battle abandoned.');
    this.done(navalOutcome(this.ns));
  }
  select(list: NShip[], add = false) {
    if (!add) this.selected.clear();
    for (const s of list) if (s.side === this.side && !s.ai && this.ns.canCommand(s)) this.selected.add(s);
    this.app.audio.ui('select');
    this.app.notify();
  }
  selectAll() {
    this.select(this.playerShips());
  }
  halt() {
    for (const s of this.selected) this.ns.orderHalt(s);
  }
  focusShip(s: NShip) {
    this.cam.focus(s.x, s.z, Math.min(this.cam.goalDistance, 260));
  }

  // ------------------------------------------------------------------ picking
  private project(x: number, y: number, z: number) {
    const v = tmpV.set(x, y, z).project(this.cam.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, ok: v.z < 1 };
  }
  pickShip(cx: number, cy: number): NShip | null {
    let best: NShip | null = null;
    let bd = Infinity;
    for (const s of this.ns.ships) {
      if (s.sunk || s.fled) continue;
      const p = this.project(s.x, 6, s.z);
      if (!p.ok) continue;
      const p2 = this.project(s.x + s.def.length * 0.5, 6, s.z);
      const r = Math.max(18, Math.hypot(p2.x - p.x, p2.y - p.y) * 0.9);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < r && d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }
  shipScreen(s: NShip) {
    return this.project(s.x, s.def.length * 0.9 + 8, s.z);
  }
  private seaPoint(cx: number, cy: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1), this.cam.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  // ------------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.app.battle !== this) return;
    this.cam.keys.add(e.code);
    if (e.code === 'Escape') {
      if (this.app.ui.settings) return;
      if (this.selected.size && !this.menuOpen) this.selected.clear();
      else this.menuOpen = !this.menuOpen;
      this.app.notify();
      return;
    }
    if (this.menuOpen) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.phase === 'deploy') this.begin();
      else this.togglePause();
    }
    if (e.ctrlKey && e.code === 'KeyA') {
      e.preventDefault();
      this.selectAll();
    }
    if (e.code === 'KeyH') this.halt();
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.setSpeed(Math.min(4, this.speed * 2));
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.setSpeed(Math.max(0.5, this.speed / 2));
    this.app.notify();
  };
  private onKeyUp = (e: KeyboardEvent) => this.cam.keys.delete(e.code);
  private onPointerDown = (e: PointerEvent) => {
    if (e.target !== this.app.canvas || this.menuOpen) return;
    this.app.audio.unlock();
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: false };
    if (e.button === 1) this.cam.onPointerDown(e);
  };
  private onPointerMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.cam.onPointerMove(e, window.innerWidth, window.innerHeight);
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) d.moved = true;
    if (d.moved && d.button === 0) {
      this.boxSel = { x0: d.x, y0: d.y, x1: e.clientX, y1: e.clientY };
      this.app.notify();
    } else if (d.moved && d.button === 2) {
      const scale = (this.cam.distance / window.innerHeight) * 1.6;
      const cs = Math.cos(this.cam.yaw);
      const sn = Math.sin(this.cam.yaw);
      this.cam.goal.x += -e.movementX * scale * cs + -e.movementY * scale * sn;
      this.cam.goal.z += e.movementX * scale * sn + -e.movementY * scale * cs;
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    this.cam.onPointerUp(e);
    if (!d || this.menuOpen) return;
    if (d.button === 0) {
      if (d.moved && this.boxSel) {
        const b = this.boxSel;
        const [x0, x1] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
        const [y0, y1] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
        this.select(
          this.playerShips().filter((s) => {
            const p = this.project(s.x, 4, s.z);
            return p.ok && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
          }),
          e.shiftKey,
        );
        this.boxSel = null;
        return;
      }
      if (e.target !== this.app.canvas) return;
      const s = this.pickShip(e.clientX, e.clientY);
      if (s && s.side === this.side) this.select([s], e.shiftKey);
      else if (!e.shiftKey) {
        this.selected.clear();
        this.app.notify();
      }
    } else if (d.button === 2 && !d.moved && e.target === this.app.canvas && this.selected.size) {
      const t = this.pickShip(e.clientX, e.clientY);
      if (t && t.side !== this.side && this.ns.active(t)) {
        for (const s of this.selected) this.ns.orderAttack(s, t, e.shiftKey);
        this.app.audio.ui('order');
        return;
      }
      const p = this.seaPoint(e.clientX, e.clientY);
      if (!p) return;
      const list = [...this.selected];
      list.forEach((s, i) => {
        const off = (i - (list.length - 1) / 2) * 60;
        this.ns.orderMove(s, p.x + off * Math.cos(this.cam.yaw), p.z - off * Math.sin(this.cam.yaw));
      });
      this.app.audio.ui('order');
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (e.target !== this.app.canvas) return;
    e.preventDefault();
    this.cam.onWheel(e, this.seaPoint(e.clientX, e.clientY));
  };
  private onContext = (e: Event) => e.preventDefault();
  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.canvas.addEventListener('contextmenu', this.onContext);
  }
  private unbindInput() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.canvas.removeEventListener('contextmenu', this.onContext);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    const ns = this.ns;
    if (this.phase !== 'deploy' && !this.paused && !this.menuOpen) {
      let left = dt * this.speed;
      while (left > 1e-4) {
        const st = Math.min(1 / 30, left);
        for (const a of this.ais) a.update(st);
        ns.update(st);
        left -= st;
      }
    }
    this.time += dt;
    this.cam.update(dt);
    const cam = this.cam.camera;
    this.env.update(dt, cam, this.cam.target, this.cam.distance);
    const sc = this.env.sun.shadow.camera as THREE.OrthographicCamera;
    const r = clamp(this.cam.distance * 0.6, 60, 400);
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 1;
    sc.far = r * 6 + 800;
    sc.updateProjectionMatrix();
    this.ocean.update(this.time, cam, this.env.waveScale, this.env.sun.color, this.env.sun.intensity, this.env.hemi.color, this.env.lightning);
    syncShipLighting(this.env, this.time);
    figureUniforms.uTime.value = this.time;
    WakeTrail.updateShared(this.time, 0.35 + Math.min(1, this.env.sun.intensity * 0.3));
    // ships and crews
    for (const s of ns.ships) {
      const a = this.actors.get(s.id)!;
      if (s.fled) {
        a.group.visible = false;
        a.wake.mesh.visible = false;
      }
      a.x = s.x;
      a.z = s.z;
      a.heading = s.heading;
      a.speed = s.speed;
      a.turnRate = s.turnRate;
      a.sinking = s.sinking;
      a.listSide = s.id % 2 ? 1 : -1;
      a.update(dt, this.ocean.sampler, ns.windDir, ns.wind);
      a.group.updateMatrixWorld();
      const figs = this.crew.get(s.id)!;
      const alive = Math.ceil((figs.length * s.crew) / Math.max(1, s.maxCrew));
      const deck = a.model.deckHeight;
      figs.forEach((f, k) => {
        if (k >= alive || s.sunk || s.fled || s.sinking > 0.5) {
          this.batch.setMotion(f.idx, 0, -200, 0, 0, 0, 0, 1);
          return;
        }
        let lx = f.lx;
        let lz = f.lz;
        let anim = s.capturedBy !== null ? ANIM.idle : s.fighting > 0 && this.time - s.lastFire < 2 ? ANIM.bowDraw : ANIM.idle;
        if (s.grappled) {
          anim = k % 2 ? ANIM.attack : ANIM.block;
          // crowd the rail nearest the enemy ship
          const o = s.grappled;
          const toO = Math.atan2(o.x - s.x, o.z - s.z) - s.heading;
          lx = Math.sin(toO) > 0 ? a.model.params.beam * 0.35 : -a.model.params.beam * 0.35;
        }
        if (this.ns.winner === s.side) anim = ANIM.cheer;
        tmpP.set(lx, deck, lz).applyMatrix4(a.group.matrixWorld);
        this.batch.setMotion(f.idx, tmpP.x, tmpP.y, tmpP.z, s.heading + (s.grappled ? 0 : f.seed), anim, 0, 1);
      });
    }
    this.batch.commit(false);
    // selection rings
    let n = 0;
    const col = this.rings.instanceColor!;
    const ring = (s: NShip, r: number, g: number, b: number) => {
      const size = s.def.length * 1.25;
      tmpM.compose(tmpP.set(s.x, 0.6, s.z), tmpQ.identity(), tmpS.set(size, 1, size));
      this.rings.setMatrixAt(n, tmpM);
      col.setXYZ(n, r, g, b);
      n++;
    };
    for (const s of this.selected) if (ns.active(s)) ring(s, 0.95, 0.85, 0.5);
    if (this.hovered && !this.selected.has(this.hovered) && ns.active(this.hovered)) ring(this.hovered, this.hovered.side === this.side ? 0.8 : 0.9, this.hovered.side === this.side ? 0.8 : 0.3, this.hovered.side === this.side ? 0.8 : 0.25);
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
    tmpS.set(1, 1, 1);
    // shots
    let na = 0;
    for (const p of ns.shots) {
      if (!p.alive || na >= 3000) continue;
      tmpV.set(p.vx, p.vy, p.vz).normalize();
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV);
      tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(p.kind === 'bolt' ? 2.5 : 1, p.kind === 'bolt' ? 2.5 : 1, p.kind === 'bolt' ? 1.8 : 1));
      this.arrows.setMatrixAt(na++, tmpM);
    }
    tmpS.set(1, 1, 1);
    this.arrows.count = na;
    this.arrows.instanceMatrix.needsUpdate = true;
    // events → effects, audio, toasts
    const campos = cam.position;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const audio = (kind: string, x: number, z: number, vol = 1) => {
      const dx = x - campos.x;
      const dz = z - campos.z;
      const dist = Math.hypot(dx, dz, campos.y);
      const v = clamp(1 - dist / 900, 0, 1) ** 1.5 * vol;
      if (v > 0.03) this.app.audio.battleSound(kind as never, clamp((dx * right.x + dz * right.z) / Math.max(40, dist), -1, 1), v);
    };
    for (const e of ns.events) {
      switch (e.kind) {
        case 'splash':
        case 'hit':
          for (let k = 0; k < (e.kind === 'splash' ? 6 : 3); k++) this.splashData.push({ x: e.x + (Math.random() - 0.5) * 4, y: 0.5, z: e.z + (Math.random() - 0.5) * 4, vy: 3 + Math.random() * 5, life: 1.2, size: 3 });
          audio(e.kind === 'hit' ? 'wood' : 'hit', e.x, e.z, 0.7);
          break;
        case 'ram':
          audio('impact', e.x, e.z, 1.5);
          audio('wood', e.x, e.z, 1.5);
          this.showToast('A ship has been rammed!');
          break;
        case 'grapple':
          audio('shout', e.x, e.z, 1.2);
          if (e.ship && (e.ship.side === this.side || e.ship.grappled?.side === this.side)) this.showToast('Grappling hooks fly — boarders away!');
          break;
        case 'clash':
          audio('clash', e.x, e.z);
          break;
        case 'volley':
          audio('arrow', e.x, e.z, 0.8);
          break;
        case 'bolt':
          audio('bow', e.x, e.z, 1);
          break;
        case 'sink':
          audio('impact', e.x, e.z, 1.4);
          if (e.ship) this.showToast(`${e.ship.name} is sinking!`);
          for (let k = 0; k < 30; k++) this.splashData.push({ x: e.x + (Math.random() - 0.5) * 20, y: 0.5, z: e.z + (Math.random() - 0.5) * 20, vy: 2 + Math.random() * 6, life: 2, size: 6 });
          break;
        case 'capture':
          audio('horn', e.x, e.z);
          if (e.ship) this.showToast(`${e.ship.name} has been captured!`);
          break;
        case 'horn':
          this.app.audio.battleSound('horn', 0, 1);
          break;
      }
    }
    ns.events.length = 0;
    this.updateSplash(dt);
    // hover
    if (!this.drag) this.hovered = this.pickShip(this.pointer.x, this.pointer.y);
    let fighting = 0;
    for (const s of ns.ships) if (s.fighting > 0) fighting++;
    this.app.audio.battleIntensity = clamp(fighting / 8, 0, 1);
    if (ns.winner !== null && this.phase !== 'over') {
      this.overT += dt;
      if (this.overT > 2.5) {
        this.phase = 'over';
        this.app.audio.setMood(ns.winner === this.side ? 'victory' : 'defeat');
        this.app.notify();
      }
    }
    if (this.toast && performance.now() - this.toast.t > 5000) this.toast = null;
    this.notifyT -= dt;
    if (this.notifyT <= 0) {
      this.notifyT = 0.25;
      this.app.notify();
    }
  }
  private updateSplash(dt: number) {
    const pos = this.splash.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.splashData = this.splashData.filter((p) => (p.life -= dt) > 0).slice(-600);
    this.splashData.forEach((p, i) => {
      p.vy -= 9.8 * dt;
      p.y = Math.max(0, p.y + p.vy * dt);
      pos.setXYZ(i, p.x, p.y, p.z);
    });
    this.splash.geometry.setDrawRange(0, this.splashData.length);
    pos.needsUpdate = true;
  }
  resize(w: number, h: number) {
    this.cam.resize(w / h);
  }
  dispose() {
    this.unbindInput();
    for (const a of this.actors.values()) {
      a.removeFrom(this.scene);
      a.dispose();
    }
    this.batch.dispose();
    this.ocean.dispose();
    this.env.dispose();
    this.rings.geometry.dispose();
    this.arrows.geometry.dispose();
    this.splash.geometry.dispose();
  }
}

export { NavalSim };
