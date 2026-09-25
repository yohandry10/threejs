import { RendererHost } from '../render/rendererHost';
import { loadSettings, saveSettings, type Settings } from '../persistence/settings';
import type { GameScene } from './scene';
import { MenuScene } from '../scenes/menuScene';
import { CampaignScene } from '../scenes/campaignScene';
import { loadWorld } from './worldLoader';
import type { WorldGeo } from '../sim/world/geo';
import { Sim } from '../sim/context';
import { newCampaign } from '../sim/setup';
import { serialize, migrate, SaveError } from '../sim/save';
import { readSave, writeSave, listSaves, type SaveMeta } from '../persistence/storage';
import { initFog } from '../sim/fog';
import { EventBus } from '../core/eventBus';
import { makeFieldBattle, makeNavalBattle, makeSettlementBattle, type BattleSetup, type BattleOutcome } from '../sim/battles';
import { UIState } from '../ui/uiState';
import { renderUI } from '../ui/root';
import { AudioManager } from '../audio/audio';
import { seasonOf } from '../sim/types';

export type AppState = 'boot' | 'menu' | 'factionSelect' | 'loading' | 'campaign' | 'battle';

export class App {
  settings: Settings;
  host: RendererHost;
  scene: GameScene | null = null;
  state: AppState = 'boot';
  geo: WorldGeo | null = null;
  menuScene: MenuScene | null = null;
  campaign: CampaignScene | null = null;
  battle: (GameScene & { finish?: () => void }) | null = null;
  ui = new UIState(this);
  audio: AudioManager;
  loading = { progress: 0, label: '' };
  saves: SaveMeta[] = [];
  error: string | null = null;
  private last = performance.now();
  private listeners = new Set<() => void>();
  version = 0;
  fps = 60;
  frameMs = 16;
  speed = 1;
  private notifyQueued = false;

  constructor(
    public canvas: HTMLCanvasElement,
    public uiRoot: HTMLElement,
  ) {
    this.settings = loadSettings();
    // QA override (?hq=1): force the high quality preset regardless of detected hardware
    if (new URLSearchParams(location.search).get('hq')) this.settings = { ...this.settings, shadows: 2, water: 1, vegetation: 1, particles: 1, postprocessing: true, bloom: true, antialias: true, resolutionScale: 1 };
    this.host = new RendererHost(canvas, this.settings);
    this.audio = new AudioManager(this.settings);
    window.addEventListener('resize', () => {
      this.host.resize();
      this.scene?.resize(window.innerWidth, window.innerHeight);
      this.notify();
    });
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.uiScale));
    this.host.onContextLost = () => {
      this.error = 'The graphics device was reset. Please wait a moment…';
      this.notify();
    };
    this.host.onContextRestored = () => {
      this.error = null;
      this.notify();
    };
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: false });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  /** Batched UI refresh (at most once per animation frame). */
  notify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    requestAnimationFrame(() => {
      this.notifyQueued = false;
      this.version++;
      for (const l of this.listeners) l();
    });
  }

  async start() {
    const fb = document.getElementById('boot-fallback');
    if (fb) fb.style.display = 'none';
    renderUI(this);
    this.state = 'boot';
    this.loading = { progress: 0, label: 'Preparing the realm' };
    this.notify();
    this.loop();
    const vparams = new URLSearchParams(location.search);
    if (vparams.get('viewer')) {
      const { ViewerScene } = await import('../scenes/viewerScene');
      this.setScene(new ViewerScene(vparams));
      this.state = 'menu';
      this.uiRoot.style.display = 'none';
      return;
    }
    this.menuScene = new MenuScene();
    this.setScene(this.menuScene);
    this.geo = await loadWorld((p, l) => {
      this.loading = { progress: p, label: l };
      this.notify();
    });
    this.saves = await listSaves().catch(() => []);
    this.state = 'menu';
    this.audio.setMood('menu');
    this.notify();
    const params = new URLSearchParams(location.search);
    if (params.get('quickstart')) {
      await this.newGame(params.get('quickstart') || 'aldmere', 7, false);
      const kind = params.get('battle');
      if (kind) this.debugBattle(kind);
    }
  }

  /** QA helper (?quickstart=faction&battle=field|siege|naval): jump straight into a tactical battle. */
  debugBattle(kind: string) {
    const cs = this.campaign;
    if (!cs) return;
    const sim = cs.sim;
    const me = sim.s.player;
    const mine = Object.values(sim.s.armies).filter((a) => a.faction === me).sort((a, b) => b.units.length - a.units.length)[0];
    let setup: BattleSetup | null = null;
    if (kind === 'naval') {
      const myF = Object.values(sim.s.fleets).find((f) => f.faction === me);
      const foe = Object.values(sim.s.fleets).find((f) => f.faction !== me);
      if (myF && foe) setup = makeNavalBattle(sim, myF, foe);
    } else if (kind === 'siege' && mine) {
      const p = Object.values(sim.s.provinces).filter((p) => p.owner !== me && p.settlement.walls > 0).sort((a, b) => b.settlement.walls - a.settlement.walls)[0];
      if (p) setup = makeSettlementBattle(sim, mine, p.id);
    } else if (mine) {
      const foe = Object.values(sim.s.armies).filter((a) => a.faction !== me && !a.isRebel).sort((a, b) => b.units.length - a.units.length)[0];
      if (foe) {
        setup = makeFieldBattle(sim, mine, foe);
        setup.kind = 'field';
        setup.defender.garrisonOf = undefined;
        setup.settlement = false;
        const t = new URLSearchParams(location.search).get('terrain');
        if (t) setup.terrain = t as never;
        if (new URLSearchParams(location.search).get('river')) setup.river = true;
      }
    }
    if (setup) {
      cs.startBattlePrompt(setup, true);
      cs.pendingBattle?.resolve('manual');
    }
  }

  setScene(s: GameScene) {
    this.scene = s;
    s.resize(window.innerWidth, window.innerHeight);
  }

  applySettings(s: Settings) {
    this.settings = s;
    saveSettings(s);
    this.host.applySettings(s);
    this.audio.applySettings(s);
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    if (this.campaign) {
      this.campaign.view.cam.sensitivity = s.mouseSensitivity;
      this.campaign.view.cam.edgeScroll = s.edgeScroll;
      this.campaign.view.env.dayLength = s.dayLength;
      this.campaign.view.env.paused = s.lockTime;
      this.campaign.view.settings = s;
      this.campaign.view.setupShadows();
    }
    this.notify();
  }

  private async withLoading(label: string, fn: (p: (v: number, l: string) => void) => Promise<void>) {
    this.state = 'loading';
    this.loading = { progress: 0, label };
    this.notify();
    await new Promise((r) => setTimeout(r, 50));
    await fn((v, l) => {
      this.loading = { progress: v, label: l };
      this.notify();
    });
  }

  private disposeCampaign() {
    if (this.campaign) {
      this.campaign.dispose();
      this.campaign = null;
    }
  }

  async newGame(faction: string, seed = Math.floor(Math.random() * 1e9), intro = true) {
    await this.withLoading('Summoning the great houses', async (p) => {
      const geo = this.geo ?? (await loadWorld(() => {}));
      p(0.2, 'Weaving the histories of the houses');
      await new Promise((r) => setTimeout(r, 20));
      const sim = newCampaign(geo, faction, seed, new EventBus());
      sim.s.tutorial.enabled = this.settings.tutorial;
      p(0.45, 'Raising cities and castles');
      await new Promise((r) => setTimeout(r, 20));
      this.enterCampaign(sim, intro);
      p(1, '');
    });
  }

  private enterCampaign(sim: Sim, intro: boolean) {
    this.disposeCampaign();
    if (this.menuScene) {
      this.menuScene.dispose();
      this.menuScene = null;
    }
    const cs = new CampaignScene(sim, this);
    this.campaign = cs;
    this.setScene(cs);
    this.state = 'campaign';
    this.ui.reset();
    this.audio.setMood('peace');
    if (intro) cs.startIntro();
    (window as unknown as { __cs: CampaignScene }).__cs = cs;
    this.notify();
  }

  async saveGame(slot: string, label?: string) {
    if (!this.campaign) return;
    const sim = this.campaign.sim;
    const s = sim.s;
    const lbl = label ?? `${sim.houseName(s.player)} — ${['Spring', 'Summer', 'Autumn', 'Winter'][seasonOf(s.turn)]} ${s.startYear + Math.floor(s.turn / 4)}`;
    try {
      await writeSave(slot, serialize(sim, lbl));
      this.saves = await listSaves();
      this.notify();
      return true;
    } catch (e) {
      console.error('[save]', e);
      this.campaign.showToast('Saving failed: storage unavailable or full.', 'warn');
      return false;
    }
  }

  async autosave() {
    if (this.campaign && !this.campaign.sim.s.victory) await this.saveGame('autosave', undefined);
  }

  async loadGame(slot: string): Promise<string | null> {
    try {
      const blob = await readSave(slot);
      if (!blob) return 'Save not found.';
      const state = migrate(blob);
      await this.withLoading('Restoring the realm', async (p) => {
        const geo = this.geo ?? (await loadWorld(() => {}));
        p(0.3, 'Restoring the realm');
        await new Promise((r) => setTimeout(r, 20));
        const sim = new Sim(state, geo, new EventBus());
        initFog(sim);
        this.enterCampaign(sim, false);
        this.campaign!.showToast('Game loaded.', 'info');
      });
      return null;
    } catch (e) {
      console.error('[load]', e);
      if (this.state === 'loading') {
        this.state = this.campaign ? 'campaign' : 'menu';
        this.notify();
      }
      return e instanceof SaveError ? e.message : 'The save could not be read (it may be corrupted).';
    }
  }

  async continueGame() {
    const s = this.saves[0];
    if (!s) return 'No saved campaign found.';
    return this.loadGame(s.slot);
  }

  toMainMenu() {
    this.disposeCampaign();
    this.menuScene = new MenuScene();
    this.setScene(this.menuScene);
    this.state = 'menu';
    this.ui.reset();
    this.audio.setMood('menu');
    listSaves()
      .then((s) => {
        this.saves = s;
        this.notify();
      })
      .catch(() => {});
    this.notify();
  }

  async startTacticalBattle(setup: BattleSetup, done: (o: BattleOutcome) => void) {
    const cs = this.campaign;
    if (!cs) return;
    cs.setActive(false);
    await this.withLoading(setup.kind === 'naval' ? 'The fleets close to battle' : setup.kind === 'siege' ? 'The siege lines are drawn' : 'The armies deploy', async (p) => {
      p(0.3, 'Deploying the troops');
      await new Promise((r) => setTimeout(r, 30));
      const finish = (o: BattleOutcome) => {
        const b = this.battle;
        this.battle = null;
        this.setScene(cs);
        cs.setActive(true);
        this.state = 'campaign';
        this.audio.setMood('peace');
        this.notify();
        if (b) setTimeout(() => b.dispose(), 0);
        done(o);
      };
      if (setup.kind === 'naval') {
        const { NavalBattleScene } = await import('../scenes/navalBattleScene');
        this.battle = new NavalBattleScene(cs.sim, setup, this, finish);
      } else {
        const { BattleScene } = await import('../scenes/battleScene');
        this.battle = new BattleScene(cs.sim, setup, this, finish);
      }
      this.setScene(this.battle!);
      this.state = 'battle';
      this.audio.setMood('battle');
      p(1, '');
    });
    this.notify();
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.frameMs = this.frameMs * 0.9 + (now - this.last) * 0.1;
    this.last = now;
    if (!this.scene) return;
    try {
      this.scene.update(realDt, realDt);
      this.host.render(this.scene.scene, this.scene.camera);
      this.audio.update(realDt, this);
    } catch (e) {
      console.error('[frame]', e);
    }
    this.fps = this.fps * 0.95 + (1 / Math.max(realDt, 0.001)) * 0.05;
  };
}
