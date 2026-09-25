import type { App } from '../app/app';

export type PanelName = 'faction' | 'diplomacy' | 'dynasty' | 'council' | 'objectives' | 'chronicle' | 'help' | null;

/** UI-only state (open panels and dialogs). Game state lives in the simulation. */
export class UIState {
  panel: PanelName = null;
  menu = false;
  settings = false;
  saveLoad: 'save' | 'load' | null = null;
  diploTarget: string | null = null;
  charFocus: number | null = null;
  confirm: { text: string; onYes: () => void } | null = null;
  coronation: { faction: string; oldRuler: number; newRuler: number } | null = null;
  battleResult = false;
  factionPick = 'aldmere';
  selectedUnits = new Set<number>();
  tab = 0;
  constructor(private app: App) {}
  reset() {
    this.panel = null;
    this.menu = false;
    this.settings = false;
    this.saveLoad = null;
    this.confirm = null;
    this.coronation = null;
    this.battleResult = false;
    this.selectedUnits.clear();
  }
  openPanel(p: PanelName) {
    this.panel = this.panel === p ? null : p;
    this.app.audio.ui('open');
    this.app.notify();
  }
  toggleMenu() {
    if (this.settings || this.saveLoad) {
      this.settings = false;
      this.saveLoad = null;
    } else if (this.panel) this.panel = null;
    else this.menu = !this.menu;
    this.app.notify();
  }
  anyModal() {
    return this.menu || this.settings || !!this.saveLoad || !!this.confirm || !!this.coronation;
  }
}
