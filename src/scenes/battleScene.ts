import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import type { App } from '../app/app';
import type { Sim } from '../sim/context';
import type { BattleOutcome, BattleSetup } from '../sim/battles';
import { deployBattle, outcomeFromBattle, resetSoldiers, type Deployment } from '../battle/deploy';
import { BattleView } from '../battle/view';
import type { BattleSim, BUnit, Formation, Side } from '../battle/sim';
import { PLAY } from '../battle/field';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';

export type BattlePhase = 'deploy' | 'fight' | 'over';

/** Real-time tactical land battle (field battles and sieges). */
export class BattleScene implements GameScene {
  readonly name = 'battle';
  scene: THREE.Scene;
  dep: Deployment;
  bsim: BattleSim;
  view: BattleView;
  phase: BattlePhase = 'deploy';
  speed = 1;
  paused = false;
  menuOpen = false;
  running = false;
  side: Side;
  groups = new Map<number, BUnit[]>();
  boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null;
  toast: { text: string; t: number } | null = null;
  overT = 0;
  private drag: { button: number; x: number; y: number; ground: THREE.Vector3 | null; moved: boolean; unit: BUnit | null } | null = null;
  private lastRight = 0;
  private hoverDirty = false;
  private pointer = { x: 0, y: 0 };
  private notifyT = 0;
  private finished = false;
  private announced = new Set<string>();

  constructor(
    public sim: Sim,
    public setup: BattleSetup,
    public app: App,
    private done: (o: BattleOutcome) => void,
  ) {
    const budget = app.settings.particles < 0.5 ? 2400 : 3600;
    this.dep = deployBattle(sim, setup, budget);
    this.bsim = this.dep.bsim;
    this.side = this.dep.playerSide ?? 0;
    // the player's own units are directly controlled; allies and enemies use the AI
    const tod = new Rng(setup.seed).range(0.3, 0.62);
    this.view = new BattleView(this.bsim, this.dep.field, app.settings, window.innerWidth / window.innerHeight, setup.weather, setup.season, tod, setup.defender.faction);
    this.view.playerSide = this.side;
    this.scene = this.view.scene;
    // camera behind our lines looking at the enemy
    const mine = this.playerUnits();
    const cx = mine.length ? mine.reduce((a, u) => a + u.cx, 0) / mine.length : 0;
    const cz = mine.length ? mine.reduce((a, u) => a + u.cz, 0) / mine.length : 0;
    const yaw = this.side === 0 ? 0 : Math.PI;
    this.view.cam.yaw = this.view.cam.goalYaw = yaw;
    this.view.cam.focus(cx, cz + (this.side === 0 ? -40 : 40), 230, true);
    this.bindInput();
    if (!mine.length) this.begin();
  }

  get camera() {
    return this.view.cam.camera;
  }

  // ------------------------------------------------------------------ queries for the HUD
  playerUnits(): BUnit[] {
    return this.bsim.units.filter((u) => u.side === this.side && !u.ai);
  }
  get selected() {
    return this.view.selected;
  }
  strength(side: Side) {
    return this.bsim.sideStrength(side);
  }
  showToast(text: string) {
    this.toast = { text, t: performance.now() };
    this.app.notify();
  }

  // ------------------------------------------------------------------ flow
  begin() {
    if (this.phase !== 'deploy') return;
    this.phase = 'fight';
    this.bsim.started = true;
    this.app.audio.battleSound('horn', 0, 1);
    this.showToast(this.setup.kind === 'siege' ? (this.side === 0 ? 'Storm the walls! Break the gate or scale the walls and seize the town square.' : 'Hold the walls! Do not let them take the town square.') : 'The battle begins!');
    this.app.notify();
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
    if (this.phase === 'over') return;
    if (this.phase === 'deploy') this.begin();
    this.bsim.withdraw(this.side);
    this.showToast('The army withdraws from the field.');
  }
  /** Leave the finished battle and return to the campaign with its outcome. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.bsim.winner === null) this.bsim.finish(this.side === 0 ? 1 : 0, 'Battle abandoned.');
    const o = outcomeFromBattle(this.dep, this.setup);
    this.done(o);
  }

  // ------------------------------------------------------------------ orders
  select(units: BUnit[], add = false) {
    if (!add) this.view.selected.clear();
    for (const u of units) if (!u.ai && u.side === this.side && u.state !== 'dead' && u.state !== 'fled') this.view.selected.add(u);
    this.app.audio.ui('select');
    this.app.notify();
  }
  selectAll() {
    this.select(this.playerUnits().filter((u) => u.state !== 'dead' && u.state !== 'fled'));
  }
  focusUnit(u: BUnit) {
    this.view.cam.focus(u.cx, u.cz, Math.min(this.view.cam.goalDistance, 160));
  }
  setFormation(f: Formation) {
    for (const u of this.view.selected) {
      this.bsim.setFormation(u, f);
      if (this.phase === 'deploy') resetSoldiers(this.bsim, u);
    }
    this.app.notify();
  }
  toggleRun() {
    const sel = [...this.view.selected];
    const any = sel.some((u) => !u.running);
    for (const u of sel) u.running = any;
    this.running = any;
    this.app.notify();
  }
  toggleFireAtWill() {
    const sel = [...this.view.selected].filter((u) => u.def.range);
    const any = sel.some((u) => !u.fireAtWill);
    for (const u of sel) {
      u.fireAtWill = any;
      if (!any && u.order === 'fire') {
        u.order = 'idle';
        u.target = null;
      }
    }
    this.app.notify();
  }
  halt() {
    for (const u of this.view.selected) this.bsim.orderHalt(u);
    this.app.notify();
  }
  orderRam() {
    for (const u of this.view.selected) if (u.def.id === 'ram') this.bsim.orderRam(u);
  }

  private issueAt(ground: THREE.Vector3 | null, target: BUnit | null, run: boolean, dragEnd?: THREE.Vector3 | null) {
    const sel = [...this.view.selected].filter((u) => this.bsim.canCommand(u));
    if (!sel.length) return;
    const b = this.bsim;
    if (this.phase === 'deploy') {
      if (!ground) return;
      const plan = dragEnd ? this.linePlan(sel, ground, dragEnd) : b.planGroupMove(sel, ground.x, ground.z, null);
      let bad = false;
      for (const p of plan) {
        if (!this.dep.zone(this.side, p.x, p.z)) {
          bad = true;
          continue;
        }
        p.u.x = p.x;
        p.u.z = p.z;
        p.u.facing = p.facing;
        if (p.cols) p.u.cols = p.cols;
        resetSoldiers(b, p.u);
      }
      if (bad) this.showToast('Units must deploy inside the highlighted deployment zone.');
      this.app.audio.ui('order');
      return;
    }
    if (target && target.side !== this.side) {
      for (const u of sel) b.orderAttack(u, target, run || u.running);
      this.app.audio.ui('order');
      this.app.audio.battleSound('shout', 0, 0.6);
      return;
    }
    if (!ground) return;
    // engines: bombard fortifications; rams: the gate
    const f = this.dep.field.fort;
    const engines = sel.filter((u) => u.def.category === 'siege' && u.def.range);
    const rams = sel.filter((u) => u.def.id === 'ram');
    let rest = sel;
    if (f && (engines.length || rams.length)) {
      const wz = this.dep.field.wallZ(clamp(ground.x, -f.halfW, f.halfW));
      const nearWall = Math.abs(ground.x) < f.halfW + 5 && Math.abs(ground.z - wz) < 14;
      const tower = f.towers.findIndex((t) => t.alive && Math.hypot(t.x - ground.x, t.z - ground.z) < 12);
      const gate = Math.abs(ground.x) < 14 && Math.abs(ground.z - this.dep.field.wallZ(0)) < 14;
      if (tower >= 0 || nearWall) {
        for (const u of engines) b.orderBombard(u, tower >= 0 ? { x: f.towers[tower].x, z: f.towers[tower].z, kind: 'tower', index: tower } : { x: ground.x, z: wz, kind: gate ? 'gate' : 'wall', index: 0 });
        if (gate) for (const u of rams) b.orderRam(u);
        rest = sel.filter((u) => !engines.includes(u) && !(gate && rams.includes(u)));
        if (engines.length) this.showToast(tower >= 0 ? 'Engines target the tower.' : gate ? 'Engines target the gate.' : 'Engines target the wall.');
        if (!rest.length) {
          this.app.audio.ui('order');
          return;
        }
      }
    }
    if (dragEnd) {
      for (const p of this.linePlan(rest, ground, dragEnd)) b.orderMove(p.u, p.x, p.z, p.facing, run || p.u.running, p.cols);
    } else b.orderGroupMove(rest, ground.x, ground.z, null, run || rest.every((u) => u.running));
    this.app.audio.ui('order');
  }

  /** Plan a formation line dragged from a to b; facing away from the camera side of the line. */
  private linePlan(units: BUnit[], a: THREE.Vector3, bpt: THREE.Vector3) {
    const dx = bpt.x - a.x;
    const dz = bpt.z - a.z;
    const len = Math.max(4, Math.hypot(dx, dz));
    const nx = dz / len;
    const nz = -dx / len;
    const cam = this.view.cam.camera.position;
    const midX = (a.x + bpt.x) / 2;
    const midZ = (a.z + bpt.z) / 2;
    const toCam = (cam.x - midX) * nx + (cam.z - midZ) * nz;
    const fx = toCam > 0 ? -nx : nx;
    const fz = toCam > 0 ? -nz : nz;
    const facing = Math.atan2(fx, fz);
    return this.bsim.planGroupMove(units, midX, midZ, facing, len);
  }

  private previewLine(a: THREE.Vector3, b: THREE.Vector3) {
    const sel = [...this.view.selected].filter((u) => this.bsim.canCommand(u));
    const pts: { x: number; z: number }[] = [];
    const tmp = { x: 0, z: 0, yaw: 0 };
    for (const p of this.linePlan(sel, a, b)) {
      const u = p.u;
      const oldCols = u.cols;
      if (p.cols) u.cols = p.cols;
      for (let k = 0; k < u.alive; k++) {
        this.bsim.slotPos(u, k, p.x, p.z, p.facing, tmp);
        pts.push({ x: tmp.x, z: tmp.z });
      }
      u.cols = oldCols;
    }
    this.view.ghostPts = pts;
  }

  // ------------------------------------------------------------------ picking
  pickUnit(clientX: number, clientY: number): BUnit | null {
    const cam = this.view.cam.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();
    let best: BUnit | null = null;
    let bd = 16;
    for (const s of this.bsim.soldiers) {
      if (!s.alive || s.fled) continue;
      v.set(s.x, s.y + 1, s.z).project(cam);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bd) {
        bd = d;
        best = s.u;
      }
    }
    return best;
  }
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.view.cam.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible: v.z < 1 && v.z > -1 };
  }
  private ground(e: { clientX: number; clientY: number }) {
    return this.view.pickGround((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  // ------------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (this.app.battle !== this) return;
    this.view.cam.keys.add(e.code);
    if (e.code === 'Escape') {
      if (this.app.ui.settings) return;
      if (this.view.selected.size && !this.menuOpen) {
        this.view.selected.clear();
      } else {
        this.menuOpen = !this.menuOpen;
      }
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
    if (e.code >= 'Digit1' && e.code <= 'Digit9') {
      const n = Number(e.code.slice(5));
      if (e.ctrlKey) {
        e.preventDefault();
        this.groups.set(n, [...this.view.selected]);
        this.showToast(`Group ${n} assigned.`);
      } else if (this.groups.has(n)) {
        this.select(this.groups.get(n)!.filter((u) => u.state !== 'dead' && u.state !== 'fled'));
        if (e.altKey && this.view.selected.size) this.focusUnit([...this.view.selected][0]);
      }
    }
    if (e.code === 'KeyR') this.toggleRun();
    if (e.code === 'KeyF') this.toggleFireAtWill();
    if (e.code === 'KeyH' || e.code === 'Backspace') this.halt();
    if (e.code === 'KeyL') this.setFormation('line');
    if (e.code === 'KeyC') this.setFormation('deep');
    if (e.code === 'KeyO') this.setFormation('loose');
    if (e.code === 'KeyU') {
      for (const u of this.view.selected) this.bsim.setFormation(u, u.def.visual.mounted ? 'wedge' : 'square');
      this.app.notify();
    }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.setSpeed(Math.min(4, this.speed * 2));
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.setSpeed(Math.max(0.5, this.speed / 2));
    if (e.code === 'Tab') {
      e.preventDefault();
      const list = this.playerUnits().filter((u) => this.bsim.canCommand(u));
      if (list.length) {
        const cur = [...this.view.selected][0];
        const next = list[(list.indexOf(cur as BUnit) + 1) % list.length];
        this.select([next]);
        this.focusUnit(next);
      }
    }
    this.app.notify();
  };
  private onKeyUp = (e: KeyboardEvent) => this.view.cam.keys.delete(e.code);
  private onPointerDown = (e: PointerEvent) => {
    if (e.target !== this.app.canvas || this.menuOpen) return;
    this.app.audio.unlock();
    const g = e.button === 2 || e.button === 0 ? this.ground(e) : null;
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, ground: g, moved: false, unit: null };
    if (e.button === 1) this.view.cam.onPointerDown(e);
  };
  private onPointerMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.view.cam.onPointerMove(e, window.innerWidth, window.innerHeight);
    this.hoverDirty = true;
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) d.moved = true;
    if (!d.moved) return;
    if (d.button === 0) {
      this.boxSel = { x0: d.x, y0: d.y, x1: e.clientX, y1: e.clientY };
      this.app.notify();
    } else if (d.button === 2) {
      if (this.view.selected.size && d.ground) {
        const g = this.ground(e);
        if (g) this.previewLine(d.ground, g);
      } else {
        // no selection: right-drag pans the camera
        const cam = this.view.cam;
        const scale = (cam.distance / window.innerHeight) * 1.6;
        const cs = Math.cos(cam.yaw);
        const sn = Math.sin(cam.yaw);
        const mx = -e.movementX * scale;
        const mz = -e.movementY * scale;
        cam.goal.x += mx * cs + mz * sn;
        cam.goal.z += -mx * sn + mz * cs;
      }
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    this.view.cam.onPointerUp(e);
    if (!d || this.menuOpen) return;
    if (d.button === 0) {
      if (d.moved && this.boxSel) {
        const b = this.boxSel;
        const x0 = Math.min(b.x0, b.x1);
        const x1 = Math.max(b.x0, b.x1);
        const y0 = Math.min(b.y0, b.y1);
        const y1 = Math.max(b.y0, b.y1);
        const hits = this.playerUnits().filter((u) => {
          if (u.state === 'dead' || u.state === 'fled') return false;
          const p = this.project(u.cx, this.bsim.groundY(u.cx, u.cz) + 1, u.cz);
          return p.visible && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
        });
        this.select(hits, e.shiftKey);
        this.boxSel = null;
        this.app.notify();
        return;
      }
      if (e.target !== this.app.canvas) return;
      const u = this.pickUnit(e.clientX, e.clientY);
      if (u && u.side === this.side && !u.ai) {
        if (e.shiftKey && this.view.selected.has(u)) {
          this.view.selected.delete(u);
          this.app.notify();
        } else this.select([u], e.shiftKey);
      } else if (!e.shiftKey) {
        this.view.selected.clear();
        this.app.notify();
      }
    } else if (d.button === 2) {
      const ghost = this.view.ghostPts.length > 0;
      this.view.ghostPts = [];
      if (!this.view.selected.size) return;
      const now = performance.now();
      const dbl = now - this.lastRight < 350;
      this.lastRight = now;
      if (d.moved && ghost && d.ground) {
        const g = this.ground(e);
        this.issueAt(d.ground, null, dbl, g);
        return;
      }
      if (e.target !== this.app.canvas) return;
      const u = this.pickUnit(e.clientX, e.clientY);
      this.issueAt(d.ground ?? this.ground(e), u && u.side !== this.side ? u : null, dbl);
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (e.target !== this.app.canvas) return;
    e.preventDefault();
    this.view.cam.onWheel(e, this.ground(e));
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
    const b = this.bsim;
    let simDt = 0;
    if (this.phase !== 'deploy' && !this.paused && !this.menuOpen) {
      simDt = dt * this.speed;
      let left = simDt;
      while (left > 1e-4) {
        const step = Math.min(1 / 30, left);
        for (const ai of this.dep.ais) ai.update(step);
        b.update(step);
        left -= step;
      }
    }
    if (this.hoverDirty && !this.drag) {
      this.hoverDirty = false;
      this.view.hovered = this.pickUnit(this.pointer.x, this.pointer.y);
    }
    const cam = this.view.cam.camera.position;
    const right = new THREE.Vector3().setFromMatrixColumn(this.view.cam.camera.matrixWorld, 0);
    const audio = (kind: string, x: number, z: number, vol = 1) => {
      const dx = x - cam.x;
      const dz = z - cam.z;
      const dist = Math.hypot(dx, dz, cam.y - b.groundY(x, z));
      const v = clamp(1 - dist / 520, 0, 1) ** 1.5 * vol;
      if (v < 0.03) return;
      const pan = clamp((dx * right.x + dz * right.z) / Math.max(30, dist), -1, 1);
      this.app.audio.battleSound(kind as never, pan, v);
    };
    this.view.update(dt, simDt, this.app.settings.sfxVolume > 0 ? audio : null);
    this.announce();
    b.events.length = 0;
    // battle music intensity
    let fighting = 0;
    for (const u of b.units) if (b.time - u.engagedT < 1.5) fighting += u.alive;
    this.app.audio.battleIntensity = clamp(fighting / 600, 0, 1);
    if (b.winner !== null && this.phase !== 'over') {
      this.overT += dt;
      if (this.overT > 2.5) {
        this.phase = 'over';
        this.app.audio.setMood(b.winner === this.side ? 'victory' : 'defeat');
        this.app.notify();
      }
    }
    if (this.toast && performance.now() - this.toast.t > 5000) {
      this.toast = null;
      this.app.notify();
    }
    this.notifyT -= dt;
    if (this.notifyT <= 0) {
      this.notifyT = 0.25;
      this.app.notify();
    }
  }

  private announce() {
    const b = this.bsim;
    for (const e of b.events) {
      if (e.kind === 'gateOpen' && !this.announced.has('gate')) {
        this.announced.add('gate');
        this.showToast('The gate has been broken!');
      } else if (e.kind === 'breach') this.showToast('The wall has been breached!');
      else if (e.kind === 'towerFall') this.showToast('A tower has collapsed.');
      else if (e.kind === 'generalDied' && e.unit) {
        const mine = e.unit.side === this.side;
        const txt = e.unit.generalDead ? `${mine ? 'Our' : 'The enemy'} general has fallen!` : `${mine ? 'Our' : 'The enemy'} general is wounded and carried from the field.`;
        this.showToast(txt);
      } else if (e.kind === 'rout' && e.unit && e.unit.side === this.side && !e.unit.ai) this.showToast(`${e.unit.def.name} are routing!`);
    }
  }

  resize(w: number, h: number) {
    this.view.cam.resize(w / h);
  }
  dispose() {
    this.unbindInput();
    this.view.dispose();
  }
}

export { PLAY };
