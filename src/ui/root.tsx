import { h, render, Component, type ComponentChildren } from 'preact';
import type { App } from '../app/app';
import { useApp, TooltipHost } from './common';
import { Loading, MainMenu, FactionSelect, SaveLoadModal, SettingsModal, GameMenu } from './menus';
import { TopBar, Rail, MapModeBar, EndTurn, Notifications, Toast, BusyOverlay, Markers, Minimap, Tutorial } from './hud';
import { SelectionPanel } from './selection';
import { FactionPanel, DiplomacyPanel, DynastyPanel, CouncilPanel, ObjectivesPanel, ChroniclePanel, HelpPanel } from './panels';
import { PreBattle, BattleResult, CaptureDialog, DecisionDialog, Coronation, VictoryOverlay, ConfirmDialog } from './dialogs';
import { BattleHUD } from './battleHud';
import type { CampaignScene } from '../scenes/campaignScene';

/** Keeps a single broken widget from taking the whole interface down. */
class Guard extends Component<{ name: string; children: ComponentChildren }, { err: string | null }> {
  state = { err: null as string | null };
  componentDidCatch(e: unknown) {
    console.error(`[ui:${this.props.name}]`, e);
    this.setState({ err: String((e as Error)?.message ?? e) });
  }
  render() {
    if (this.state.err) return null;
    return this.props.children as never;
  }
}

function CampaignUI(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const panel = app.ui.panel;
  const modalOpen = !!cs.pendingBattle || !!cs.pendingCapture || app.ui.anyModal();
  return (
    <div class="fullscreen" style={{ pointerEvents: 'none' }}>
      {cs.introT < 0 && (
        <>
          <Guard name="markers">
            <Markers cs={cs} />
          </Guard>
          <Guard name="topbar">
            <TopBar app={app} cs={cs} />
          </Guard>
          <Guard name="rail">
            <Rail app={app} cs={cs} />
          </Guard>
          <Guard name="mapmodes">
            <MapModeBar cs={cs} />
          </Guard>
          <Guard name="minimap">
            <Minimap app={app} cs={cs} />
          </Guard>
          <Guard name="notifs">
            <Notifications app={app} cs={cs} />
          </Guard>
          <Guard name="endturn">
            <EndTurn app={app} cs={cs} />
          </Guard>
          <Guard name="selection">
            <SelectionPanel app={app} cs={cs} />
          </Guard>
          <Guard name="panel">
            {panel === 'faction' && <FactionPanel app={app} cs={cs} />}
            {panel === 'diplomacy' && <DiplomacyPanel app={app} cs={cs} />}
            {panel === 'dynasty' && <DynastyPanel app={app} cs={cs} />}
            {panel === 'council' && <CouncilPanel app={app} cs={cs} />}
            {panel === 'objectives' && <ObjectivesPanel app={app} cs={cs} />}
            {panel === 'chronicle' && <ChroniclePanel app={app} cs={cs} />}
            {panel === 'help' && <HelpPanel app={app} />}
          </Guard>
          <Guard name="tutorial">{!modalOpen && <Tutorial app={app} cs={cs} />}</Guard>
          <Guard name="busy">
            <BusyOverlay cs={cs} />
          </Guard>
        </>
      )}
      {cs.introT >= 0 && (
        <div class="intro-skip pe" onClick={() => ((cs.introT = 999), app.notify())}>
          Click or press Space to skip
        </div>
      )}
      <Guard name="toast">
        <Toast cs={cs} />
      </Guard>
      <Guard name="dialogs">
        {cs.pendingBattle ? (
          <PreBattle app={app} cs={cs} />
        ) : cs.lastBattle ? (
          <BattleResult app={app} cs={cs} />
        ) : cs.pendingCapture ? (
          <CaptureDialog app={app} cs={cs} />
        ) : app.ui.coronation ? (
          <Coronation app={app} cs={cs} />
        ) : !app.ui.anyModal() && cs.introT < 0 ? (
          <DecisionDialog app={app} cs={cs} />
        ) : null}
        {!cs.pendingBattle && !cs.lastBattle && <VictoryOverlay app={app} cs={cs} />}
      </Guard>
    </div>
  );
}

function Root(props: { app: App }) {
  const app = useApp(props.app);
  const st = app.state;
  return (
    <div class="fullscreen" style={{ pointerEvents: 'none' }}>
      {st === 'menu' && <MainMenu app={app} />}
      {st === 'factionSelect' && <FactionSelect app={app} />}
      {st === 'campaign' && app.campaign && <CampaignUI app={app} cs={app.campaign} />}
      {st === 'battle' && app.battle && (
        <Guard name="battle">
          <BattleHUD app={app} />
        </Guard>
      )}
      {(st === 'boot' || st === 'loading') && <Loading app={app} />}
      {app.ui.menu && st === 'campaign' && <GameMenu app={app} />}
      {app.ui.settings && <SettingsModal app={app} />}
      {app.ui.saveLoad && <SaveLoadModal app={app} />}
      <ConfirmDialog app={app} />
      {app.error && <div class="toast warn">{app.error}</div>}
      <TooltipHost />
    </div>
  );
}

export function renderUI(app: App) {
  render(<Root app={app} />, app.uiRoot);
}
