import * as THREE from 'three';
import type { GameScene } from '../app/scene';
import type { App } from '../app/app';
import type { Sim } from '../sim/context';
import { CampaignView } from '../render/campaign/campaignView';
import { computeModeColors, computeOwnerColors, writeFogTexture, type MapMode } from '../render/campaign/mapModes';
import { seasonOf, type ArmyState, type FleetState } from '../sim/types';
import { armyCellCost, armyRange, fleetCellCost, fleetRange, findArmyPath, findFleetPath } from '../sim/movement';
import { issueArmyOrder, issueFleetOrder, type OrderResult, type OrderTarget, captureWith, assaultSettlement } from '../sim/commands';
import { atWar } from '../sim/diplomacy';
import { updateFog, isVisible } from '../sim/fog';
import { cellOf, cellX, cellZ, heightAt, isWaterCell } from '../sim/world/geo';
import { endTurn } from '../sim/turn';
import { applyBattleOutcome, autoResolve, type BattleOutcome, type BattleSetup } from '../sim/battles';
import { ringTexture } from '../render/textures';
import type { GameEvent } from '../core/eventBus';

export type Selection = { kind: 'army'; id: number } | { kind: 'fleet'; id: number } | { kind: 'settlement'; id: number } | null;

export interface PendingBattle {
  setup: BattleSetup;
  attackerIsPlayer: boolean;
  resolve: (o: 'auto' | 'manual' | 'withdraw') => void;
}

export interface CaptureChoice {
  province: number;
  army: number;
}

export class CampaignScene implements GameScene {
  readonly name = 'campaign';
  view: CampaignView;
  mapMode: MapMode = 'political';
  selection: Selection = null;
  hover: Selection = null;
  hoverCell = -1;
  busy = false;
  turnLabel = '';
  turnProgress = 0;
  pendingBattle: PendingBattle | null = null;
  pendingCapture: CaptureChoice | null = null;
  toast: { text: string; t: number; kind: string } | null = null;
  private modeT = 1;
  private pathMesh: THREE.Mesh;
  private pathGeo = new THREE.BufferGeometry();
  private destRing: THREE.Mesh;
  private lastPathKey = '';
  private pointer = new THREE.Vector2();
  private downAt: { x: number; y: number; button: number } | null = null;
  private unsub: (() => void)[] = [];
  private fogDirty = true;
  private forcesDirty = true;
  active = true;
  introT = -1;
  private introPath: { p: THREE.Vector3; d: number; yaw: number }[] = [];

  constructor(
    public sim: Sim,
    public app: App,
  ) {
    this.view = new CampaignView(sim, app.settings, window.innerWidth / window.innerHeight);
    this.view.cam.sensitivity = app.settings.mouseSensitivity;
    this.view.cam.edgeScroll = app.settings.edgeScroll;
    this.view.env.dayLength = app.settings.dayLength;
    this.view.env.paused = app.settings.lockTime;
    const cap = sim.geo.provinces[sim.fac(sim.s.player).capital] ?? sim.geo.provinces[0];
    this.view.cam.focus(cap.x, cap.z + 120, 900, true);
    const pm = new THREE.MeshBasicMaterial({ color: 0xf4d27a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, side: THREE.DoubleSide, vertexColors: true });
    this.pathMesh = new THREE.Mesh(this.pathGeo, pm);
    this.pathMesh.frustumCulled = false;
    this.pathMesh.renderOrder = 6;
    this.view.scene.add(this.pathMesh);
    this.destRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xf4d27a, transparent: true, depthWrite: false }));
    this.destRing.visible = false;
    this.destRing.renderOrder = 6;
    this.view.scene.add(this.destRing);
    this.refreshOwners();
    this.setMapMode('political', true);
    updateFog(sim);
    this.refreshFog();
    this.applySeason();
    this.bindEvents();
    this.bindInput();
  }
  get scene() {
    return this.view.scene;
  }
  get camera() {
    return this.view.cam.camera;
  }

  // --------------------------------------------------------------- sync with simulation
  private bindEvents() {
    const bus = this.sim.bus;
    const on = (t: Parameters<typeof bus.on>[0], fn: (e: GameEvent) => void) => this.unsub.push(bus.on(t, fn));
    on('ARMY_MOVED', (e) => {
      this.forcesDirty = true;
      this.fogDirty = true;
      this.view.forces.sync();
      this.view.forces.onArmyMoved(e.army as number, e.cells as number[]);
    });
    on('FLEET_MOVED', (e) => {
      this.forcesDirty = true;
      this.fogDirty = true;
      this.view.forces.sync();
      this.view.forces.onFleetMoved(e.fleet as number, e.cells as number[]);
    });
    for (const t of ['ARMY_CREATED', 'ARMY_DESTROYED', 'FLEET_DESTROYED', 'UNIT_RECRUITED', 'BATTLE_RESOLVED', 'SIEGE_STARTED'] as const)
      on(t, () => {
        this.forcesDirty = true;
        this.fogDirty = true;
      });
    on('OWNERSHIP_CHANGED', () => {
      this.refreshOwners();
      this.setMapMode(this.mapMode, true);
      this.view.settlements.syncAll();
      this.fogDirty = true;
    });
    on('BUILDING_COMPLETED', () => this.view.settlements.syncAll());
    on('TURN_STARTED', () => {
      this.applySeason();
      this.setMapMode(this.mapMode, true);
      this.fogDirty = true;
    });
    for (const t of ['WAR_DECLARED', 'PEACE_SIGNED', 'ALLIANCE_FORMED', 'TREATY_SIGNED'] as const) on(t, () => this.setMapMode(this.mapMode, true));
    on('SUCCESSION_OCCURRED', (e) => {
      if (e.faction === this.sim.s.player) {
        this.app.ui.coronation = { faction: e.faction as string, oldRuler: e.oldRuler as number, newRuler: e.newRuler as number };
        this.app.audio?.event('coronation');
      }
    });
    on('*', () => this.app.notify());
  }

  refreshOwners() {
    computeOwnerColors(this.sim, this.view.tex.provOwner.image.data as Uint8Array);
    this.view.tex.provOwner.needsUpdate = true;
  }
  setMapMode(m: MapMode, instant = false) {
    const t = this.view.tex;
    if (!instant || m !== this.mapMode) {
      (t.provColorPrev.image.data as Uint8Array).set(t.provColor.image.data as Uint8Array);
      t.provColorPrev.needsUpdate = true;
    }
    computeModeColors(this.sim, m, t.provColor.image.data as Uint8Array);
    t.provColor.needsUpdate = true;
    const changed = m !== this.mapMode;
    this.mapMode = m;
    this.modeT = changed ? 0 : 1;
    this.view.terrainU.uModeMix.value = this.modeT;
    this.app.notify();
  }
  refreshFog() {
    this.sim.cache.set('visible', this.sim.cache.get('visible'));
    writeFogTexture(this.sim, this.view.tex.fog.image.data as Uint8Array);
    this.view.tex.fog.needsUpdate = true;
  }
  applySeason() {
    const s = seasonOf(this.sim.s.turn);
    const u = this.view.terrainU;
    u.uWinter.value = s === 3 ? 1 : 0;
    u.uAutumn.value = s === 2 ? 1 : 0;
    u.uSpring.value = s === 0 ? 1 : 0;
    this.updateWeatherForCamera(true);
  }
  private weatherRegion = '';
  updateWeatherForCamera(instant = false) {
    const c = this.view.cam.target;
    const pid = this.sim.geo.province[cellOf(this.sim.geo, c.x, c.z)];
    const region = pid >= 0 ? this.sim.geo.provinces[pid].region : 'sea';
    if (region !== this.weatherRegion || instant) {
      this.weatherRegion = region;
      this.view.env.setWeather(this.sim.s.weather.regions[region] ?? 'clear', seasonOf(this.sim.s.turn), instant);
    }
  }

  // --------------------------------------------------------------- selection & orders
  select(sel: Selection, focus = false) {
    this.selection = sel;
    this.view.forces.selectedArmy = sel?.kind === 'army' ? sel.id : null;
    this.view.forces.selectedFleet = sel?.kind === 'fleet' ? sel.id : null;
    this.view.terrainU.uSelProv.value = sel?.kind === 'settlement' ? sel.id + 1 : 0;
    this.updateRange();
    this.clearPath();
    if (focus && sel) {
      const p = this.selectionPos(sel);
      if (p) this.view.cam.focus(p.x, p.z, Math.min(this.view.cam.goalDistance, 700));
    }
    this.app.audio?.ui('select');
    this.app.notify();
  }
  selectionPos(sel: Selection) {
    if (!sel) return null;
    if (sel.kind === 'army') {
      const a = this.sim.s.armies[sel.id];
      return a ? new THREE.Vector3(a.x, 0, a.z) : null;
    }
    if (sel.kind === 'fleet') {
      const f = this.sim.s.fleets[sel.id];
      return f ? new THREE.Vector3(f.x, 0, f.z) : null;
    }
    const pg = this.sim.geo.provinces[sel.id];
    return new THREE.Vector3(pg.x, 0, pg.z);
  }
  get selectedArmy(): ArmyState | undefined {
    return this.selection?.kind === 'army' ? this.sim.s.armies[this.selection.id] : undefined;
  }
  get selectedFleet(): FleetState | undefined {
    return this.selection?.kind === 'fleet' ? this.sim.s.fleets[this.selection.id] : undefined;
  }
  updateRange() {
    const data = this.view.tex.range.image.data as Uint8Array;
    data.fill(0);
    const a = this.selectedArmy;
    const f = this.selectedFleet;
    let range: Map<number, number> | null = null;
    if (a && a.faction === this.sim.s.player && a.embarked === undefined) range = armyRange(this.sim, a);
    else if (f && f.faction === this.sim.s.player) range = fleetRange(this.sim, f);
    if (range) for (const c of range.keys()) data[c] = 255;
    this.view.tex.range.needsUpdate = true;
    this.view.terrainU.uRangeAlpha.value = range ? 1 : 0;
  }
  private clearPath() {
    this.pathMesh.visible = false;
    this.destRing.visible = false;
    this.lastPathKey = '';
  }
  /** Draw the planned route for the selected army/fleet toward the hovered target. */
  private previewPath(cell: number) {
    const a = this.selectedArmy;
    const f = this.selectedFleet;
    const key = `${this.selection?.kind}${this.selection && 'id' in this.selection ? this.selection.id : ''}:${cell}`;
    if (key === this.lastPathKey) return;
    this.lastPathKey = key;
    let path: number[] = [];
    let cost: number[] = [];
    let mp = 0;
    const g = this.sim.geo;
    if (a && a.faction === this.sim.s.player && a.embarked === undefined) {
      if (isWaterCell(g, cell)) return this.clearPathOnly();
      const pr = findArmyPath(this.sim, a, cell);
      path = pr.path;
      cost = pr.cost;
      mp = a.movePoints;
    } else if (f && f.faction === this.sim.s.player) {
      let goal = cell;
      if (!isWaterCell(g, cell)) {
        if (!f.carrying.length) return this.clearPathOnly();
        // path to the shore next to the landing site
        let best = -1;
        let bd = 1e9;
        const x0 = cell % g.navW;
        const z0 = Math.floor(cell / g.navW);
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const c = (z0 + dz) * g.navW + x0 + dx;
            if (c >= 0 && c < g.nav.length && isWaterCell(g, c)) {
              const d = Math.hypot(dx, dz);
              if (d < bd) {
                bd = d;
                best = c;
              }
            }
          }
        if (best < 0) return this.clearPathOnly();
        goal = best;
      }
      const pr = findFleetPath(this.sim, f, goal);
      path = pr.path;
      cost = pr.cost;
      mp = f.movePoints;
    }
    if (path.length < 2) return this.clearPathOnly();
    // ribbon along the path, gold within this season's reach, grey beyond
    const w = Math.max(2.2, this.view.cam.distance * 0.006);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const pts = path.map((c) => new THREE.Vector3(cellX(g, c), 0, cellZ(g, c)));
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const r = pts[Math.max(0, i - 1)];
      let tx = q.x - r.x;
      let tz = q.z - r.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const y = Math.max(0.8, heightAt(g, p.x, p.z)) + 1.2;
      pos.push(p.x - tz * w, y, p.z + tx * w, p.x + tz * w, y, p.z - tx * w);
      const within = cost[i] <= mp + 0.01;
      const c = within ? [1, 0.84, 0.45] : [0.62, 0.62, 0.62];
      col.push(...c, ...c);
      if (i < pts.length - 1) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    this.pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.pathGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.pathGeo.setIndex(idx);
    this.pathGeo.computeBoundingSphere();
    this.pathMesh.visible = true;
    const end = pts[pts.length - 1];
    this.destRing.position.set(end.x, Math.max(0.8, heightAt(g, end.x, end.z)) + 1.3, end.z);
    const rs = Math.max(14, this.view.cam.distance * 0.03);
    this.destRing.scale.set(rs, 1, rs);
    this.destRing.visible = true;
  }
  private clearPathOnly() {
    this.pathMesh.visible = false;
    this.destRing.visible = false;
  }

  /** Resolve what's under the cursor with screen-space priority: armies > fleets > settlements > ground. */
  pick(clientX: number, clientY: number): { sel: Selection; cell: number; ground: THREE.Vector3 | null } {
    const cam = this.view.cam.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(cam);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, behind: p.z > 1 };
    };
    let best: Selection = null;
    let bestD = 1e9;
    const figR = Math.max(26, 900 / Math.max(80, this.view.cam.distance) * 10);
    for (const [id, v] of this.view.forces.armies) {
      const s = toScreen(new THREE.Vector3(v.x, heightAt(this.sim.geo, v.x, v.z) + 4, v.z));
      if (s.behind) continue;
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < Math.min(60, figR) && d < bestD) {
        bestD = d;
        best = { kind: 'army', id };
      }
    }
    if (!best)
      for (const [id, v] of this.view.forces.fleets) {
        const s = toScreen(new THREE.Vector3(v.x, 6, v.z));
        if (s.behind) continue;
        const d = Math.hypot(s.x - clientX, s.y - clientY);
        if (d < Math.min(70, figR * 1.4) && d < bestD) {
          bestD = d;
          best = { kind: 'fleet', id };
        }
      }
    const ground = this.view.pickGround((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    const cell = ground ? cellOf(this.sim.geo, ground.x, ground.z) : -1;
    if (!best) {
      for (const pg of this.sim.geo.provinces) {
        const s = toScreen(new THREE.Vector3(pg.x, pg.elevation + 10, pg.z));
        if (s.behind) continue;
        const d = Math.hypot(s.x - clientX, s.y - clientY);
        const gd = ground ? Math.hypot(ground.x - pg.x, ground.z - pg.z) : 1e9;
        if ((d < 34 || gd < pg.radius * 0.9) && d < bestD) {
          bestD = d;
          best = { kind: 'settlement', id: pg.id };
        }
      }
    }
    return { sel: best, cell, ground };
  }

  handleOrderResult(r: OrderResult) {
    if (r.message) this.showToast(r.message, r.ok ? 'info' : 'warn');
    if (r.embarked !== undefined) {
      this.showToast('The army boards the ships. Select the fleet to sail it.', 'info');
      this.select({ kind: 'fleet', id: r.embarked });
    }
    if (r.disembarked) this.showToast('The army lands on the shore.', 'info');
    if (r.siege !== undefined) this.showToast(`Siege laid to ${this.sim.provName(r.siege)}. Siege equipment will be ready next season.`, 'info');
    if (r.capture) this.pendingCapture = r.capture;
    if (r.battle) this.startBattlePrompt(r.battle, true);
    this.updateRange();
    this.clearPath();
    updateFog(this.sim);
    this.fogDirty = true;
    this.app.notify();
  }

  issueOrder(target: OrderTarget) {
    if (this.busy) return;
    const a = this.selectedArmy;
    const f = this.selectedFleet;
    if (a && a.faction === this.sim.s.player) {
      if (a.movePoints <= 0 && !(target.kind === 'army' && this.sim.s.armies[target.id]?.faction === a.faction)) {
        this.showToast('This army has no movement left this season.', 'warn');
        return;
      }
      this.handleOrderResult(issueArmyOrder(this.sim, a, target));
      this.app.audio?.ui('order');
    } else if (f && f.faction === this.sim.s.player) {
      this.handleOrderResult(issueFleetOrder(this.sim, f, target));
      this.app.audio?.ui('order');
    }
  }

  assault() {
    const a = this.selectedArmy;
    if (!a) return;
    this.handleOrderResult(assaultSettlement(this.sim, a));
  }

  resolveCapture(mode: 'occupy' | 'sack') {
    const c = this.pendingCapture;
    if (!c) return;
    this.pendingCapture = null;
    const a = this.sim.s.armies[c.army];
    if (a) {
      const text = captureWith(this.sim, a, c.province, mode);
      this.showToast(text, 'info');
    }
    this.app.audio?.event(mode === 'sack' ? 'sack' : 'capture');
    updateFog(this.sim);
    this.fogDirty = true;
    this.app.notify();
  }

  // --------------------------------------------------------------- battles
  private battleWaiters: ((v: void) => void)[] = [];
  startBattlePrompt(setup: BattleSetup, attackerIsPlayer: boolean): Promise<void> {
    return new Promise((done) => {
      this.pendingBattle = {
        setup,
        attackerIsPlayer,
        resolve: async (choice) => {
          this.pendingBattle = null;
          if (choice === 'withdraw') {
            this.withdraw(setup, attackerIsPlayer);
            done();
            this.app.notify();
            return;
          }
          if (choice === 'auto') {
            const o = autoResolve(this.sim, setup);
            this.finishBattle(setup, o);
            done();
          } else {
            this.app.startTacticalBattle(setup, (o) => {
              this.finishBattle(setup, o);
              done();
            });
          }
        },
      };
      this.app.audio?.event('battle');
      this.app.notify();
    });
  }
  private withdraw(setup: BattleSetup, attackerIsPlayer: boolean) {
    if (attackerIsPlayer) {
      this.showToast('Your commander thinks better of the attack.', 'info');
      return;
    }
    // defender withdraws: small losses, forced back
    for (const id of setup.defender.armies) {
      const a = this.sim.s.armies[id];
      if (!a || a.faction !== this.sim.s.player) continue;
      for (const u of a.units) u.troops = Math.max(1, Math.floor(u.troops * 0.9));
      a.morale = Math.max(10, a.morale - 15);
    }
    const o = autoResolve(this.sim, setup);
    o.winner = 'attacker';
    o.losses = o.losses.map((l) => ({ ...l, lost: Math.floor(l.lost * 0.25) }));
    o.generalsKilled = [];
    o.settlementTaken = setup.defender.garrisonOf !== undefined && false;
    this.finishBattle(setup, o);
  }
  finishBattle(setup: BattleSetup, o: BattleOutcome) {
    const res = applyBattleOutcome(this.sim, setup, o);
    this.lastBattle = { setup, outcome: o, text: res.text };
    if (res.captureDecision) this.pendingCapture = res.captureDecision;
    const playerWon = (o.winner === 'attacker' ? setup.attacker.faction : setup.defender.faction) === this.sim.s.player;
    this.app.audio?.event(playerWon ? 'victory' : 'defeat');
    updateFog(this.sim);
    this.fogDirty = true;
    this.forcesDirty = true;
    this.updateRange();
    this.app.notify();
  }
  lastBattle: { setup: BattleSetup; outcome: BattleOutcome; text: string } | null = null;

  // --------------------------------------------------------------- turns
  async endTurn() {
    if (this.busy || this.sim.s.victory) return;
    this.busy = true;
    this.select(null);
    // unresolved decisions from previous turns lapse
    this.turnLabel = 'Ending the season';
    this.app.notify();
    await this.wait(250);
    try {
      await endTurn(this.sim, {
        yieldFrame: () => this.wait(16),
        playerBattle: (setup) => this.startBattlePrompt(setup, setup.attacker.faction === this.sim.s.player),
        progress: (label, frac) => {
          this.turnLabel = label;
          this.turnProgress = frac;
          this.app.notify();
        },
      });
    } catch (e) {
      console.error('[end turn]', e);
      this.showToast('An error occurred while ending the turn.', 'warn');
    }
    this.busy = false;
    this.turnLabel = '';
    this.forcesDirty = true;
    this.fogDirty = true;
    this.view.settlements.syncAll();
    await this.app.autosave();
    this.app.notify();
  }
  private wait(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  showToast(text: string, kind = 'info') {
    this.toast = { text, t: performance.now(), kind };
    this.app.notify();
  }

  // --------------------------------------------------------------- input
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (!this.active) return;
    this.view.cam.keys.add(e.code);
    const k = this.app.settings.keys;
    if (e.code === 'Escape') {
      if (this.selection) this.select(null);
      else this.app.ui.toggleMenu();
    }
    if (e.code === k.endTurn && !this.app.ui.anyModal()) this.endTurn();
    if (e.code === k.mapMode) {
      const modes: MapMode[] = ['terrain', 'political', 'diplomatic', 'economic', 'military'];
      this.setMapMode(modes[(modes.indexOf(this.mapMode) + 1) % modes.length]);
    }
    if (e.code >= 'Digit1' && e.code <= 'Digit5' && !e.ctrlKey) {
      const modes: MapMode[] = ['terrain', 'political', 'diplomatic', 'economic', 'military'];
      this.setMapMode(modes[Number(e.code.slice(5)) - 1]);
    }
    if (e.code === k.diplomacy) this.app.ui.openPanel('diplomacy');
    if (e.code === k.family) this.app.ui.openPanel('dynasty');
    if (e.code === 'Home' || e.code === 'KeyH') {
      const cap = this.sim.geo.provinces[this.sim.fac(this.sim.s.player).capital];
      if (cap) this.view.cam.focus(cap.x, cap.z, 800);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.view.cam.keys.delete(e.code);
  private onPointerDown = (e: PointerEvent) => {
    if (!this.active || e.target !== this.app.canvas) return;
    this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
    this.view.cam.onPointerDown(e);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    this.pointer.set(e.clientX, e.clientY);
    this.view.cam.onPointerMove(e, window.innerWidth, window.innerHeight);
    this.moveDirty = true;
  };
  private moveDirty = false;
  private onPointerUp = (e: PointerEvent) => {
    if (!this.active) return;
    const dragged = this.view.cam.onPointerUp(e);
    const d = this.downAt;
    this.downAt = null;
    if (dragged || !d || e.target !== this.app.canvas) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    if (this.introT >= 0) {
      this.introT = -1;
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    if (e.button === 0) {
      this.select(hit.sel);
    } else if (e.button === 2) {
      if (!this.selection || this.selection.kind === 'settlement') return;
      if (hit.sel?.kind === 'army' && hit.sel.id !== this.selection.id) this.issueOrder({ kind: 'army', id: hit.sel.id });
      else if (hit.sel?.kind === 'fleet' && hit.sel.id !== this.selection.id) this.issueOrder({ kind: 'fleet', id: hit.sel.id });
      else if (hit.sel?.kind === 'settlement') {
        // settlements: attack/enter if the click lands on the town
        this.issueOrder({ kind: 'settlement', pid: hit.sel.id });
      } else if (hit.cell >= 0) this.issueOrder({ kind: 'cell', cell: hit.cell });
    }
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.active || e.target !== this.app.canvas) return;
    const gp = this.view.pickGround((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.view.cam.onWheel(e, gp);
    e.preventDefault();
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
  setActive(a: boolean) {
    this.active = a;
    this.view.cam.keys.clear();
    this.view.cam.enabled = a;
  }

  // --------------------------------------------------------------- intro flight
  startIntro() {
    const g = this.sim.geo;
    const cap = g.provinces[this.sim.fac(this.sim.s.player).capital];
    const fleet = Object.values(this.sim.s.fleets).find((f) => f.faction === this.sim.s.player) ?? Object.values(this.sim.s.fleets)[0];
    const island = g.provinces.find((p) => p.anchor.kind === 'capital' && p.landmass !== cap.landmass && Math.hypot(p.x - cap.x, p.z - cap.z) < 2500) ?? g.provinces[26];
    const start = fleet ? new THREE.Vector3(fleet.x, 0, fleet.z) : new THREE.Vector3(cap.x - 600, 0, cap.z);
    this.introPath = [
      { p: start.clone().add(new THREE.Vector3(-60, 0, 90)), d: 140, yaw: 2.4 },
      { p: start.clone(), d: 260, yaw: 2.0 },
      { p: new THREE.Vector3(island.x, 0, island.z), d: 700, yaw: 1.2 },
      { p: new THREE.Vector3((island.x + cap.x) / 2, 0, (island.z + cap.z) / 2), d: 1800, yaw: 0.6 },
      { p: new THREE.Vector3(cap.x, 0, cap.z + 100), d: 820, yaw: 0 },
    ];
    this.introT = 0;
    this.view.env.t = 0.7;
  }
  private updateIntro(dt: number) {
    if (this.introT < 0) return;
    this.introT += dt / 4.2;
    const n = this.introPath.length - 1;
    if (this.introT >= n) {
      this.introT = -1;
      const last = this.introPath[n];
      this.view.cam.focus(last.p.x, last.p.z, last.d, true);
      this.view.cam.goalYaw = this.view.cam.yaw = 0;
      return;
    }
    const i = Math.floor(this.introT);
    const t = this.introT - i;
    const e = t * t * (3 - 2 * t);
    const a = this.introPath[i];
    const b = this.introPath[i + 1];
    const cam = this.view.cam;
    cam.goal.lerpVectors(a.p, b.p, e);
    cam.target.copy(cam.goal);
    cam.distance = cam.goalDistance = a.d + (b.d - a.d) * e;
    cam.yaw = cam.goalYaw = a.yaw + (b.yaw - a.yaw) * e;
  }

  // --------------------------------------------------------------- frame
  private hoverTimer = 0;
  update(dt: number) {
    if (this.modeT < 1) {
      this.modeT = Math.min(1, this.modeT + dt * 2.5);
      this.view.terrainU.uModeMix.value = this.modeT;
    }
    this.updateIntro(dt);
    if (this.forcesDirty) {
      this.view.forces.sync();
      this.forcesDirty = false;
    }
    if (this.fogDirty) {
      updateFog(this.sim);
      this.refreshFog();
      this.fogDirty = false;
    }
    this.hoverTimer -= dt;
    if (this.moveDirty && this.hoverTimer <= 0 && this.active && !this.busy) {
      this.moveDirty = false;
      this.hoverTimer = 0.06;
      const hit = this.pick(this.pointer.x, this.pointer.y);
      const prevHover = JSON.stringify(this.hover);
      this.hover = hit.sel;
      this.hoverCell = hit.cell;
      this.view.forces.hoverArmy = hit.sel?.kind === 'army' ? hit.sel.id : null;
      this.view.terrainU.uHoverProv.value = hit.sel?.kind === 'settlement' ? hit.sel.id + 1 : 0;
      if ((this.selectedArmy?.faction === this.sim.s.player || this.selectedFleet?.faction === this.sim.s.player) && hit.cell >= 0) {
        const target = hit.sel?.kind === 'settlement' ? this.sim.geo.provinces[hit.sel.id].cell : hit.sel?.kind === 'army' ? this.sim.s.armies[hit.sel.id]?.cell ?? hit.cell : hit.sel?.kind === 'fleet' ? this.sim.s.fleets[hit.sel.id]?.cell ?? hit.cell : hit.cell;
        this.previewPath(target);
      }
      if (JSON.stringify(this.hover) !== prevHover) this.app.notify();
    }
    this.updateWeatherForCamera();
    this.view.update(dt);
    if (this.toast && performance.now() - this.toast.t > 4500) {
      this.toast = null;
      this.app.notify();
    }
  }
  /** Screen position of a world point (for DOM markers). */
  project(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y, z).project(this.view.cam.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight, visible: p.z < 1 && p.z > -1 };
  }
  isVisibleToPlayer(x: number, z: number) {
    return isVisible(this.sim, x, z);
  }
  resize(w: number, h: number) {
    this.view.cam.resize(w / h);
  }
  dispose() {
    this.unbindInput();
    for (const u of this.unsub) u();
    this.pathGeo.dispose();
    this.view.dispose();
  }
}
export { atWar, armyCellCost, fleetCellCost };
