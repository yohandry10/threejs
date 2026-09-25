import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { App } from '../app/app';
import { FACTIONS, factionDef } from '../data/factions';
import { ANCHORS, REGION_NAMES } from '../data/worldLayout';
import { Modal, Shield } from './common';
import { DEFAULT_KEYS, DEFAULT_SETTINGS, detectSettings, type Settings } from '../persistence/settings';
import { deleteSave, listSaves, type SaveMeta } from '../persistence/storage';
import { SEASON_NAMES } from '../sim/types';

export function Loading(props: { app: App }) {
  const { progress, label } = props.app.loading;
  return (
    <div class="loading">
      <div class="title">CROWN &amp; TIDE</div>
      <div class="sub">{label || 'A realm of dynasties, fleets and war'}</div>
      <div class="progress">
        <div style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

export function MainMenu(props: { app: App }) {
  const app = props.app;
  const [msg, setMsg] = useState<string | null>(null);
  const hasSave = app.saves.length > 0;
  return (
    <div class="mainmenu">
      <div class="left">
        <div class="logo">
          CROWN
          <br />
          <span class="amp">&amp;</span> TIDE
        </div>
        <div class="tag">Eight houses. Five isles. One crown worth the war.</div>
        <button class="mbtn" onClick={() => ((app.state = 'factionSelect'), app.audio.ui('open'), app.notify())}>
          New Campaign<span class="hint">Choose a dynasty and claim the realm</span>
        </button>
        <button class="mbtn" disabled={!hasSave} onClick={async () => setMsg(await app.continueGame())}>
          Continue<span class="hint">{hasSave ? `${app.saves[0].label}` : 'No campaign in progress'}</span>
        </button>
        <button class="mbtn" disabled={!hasSave} onClick={() => ((app.ui.saveLoad = 'load'), app.notify())}>
          Load Game<span class="hint">{app.saves.length} saved campaign{app.saves.length === 1 ? '' : 's'}</span>
        </button>
        <button class="mbtn" onClick={() => ((app.ui.settings = true), app.notify())}>
          Settings<span class="hint">Graphics, audio and controls</span>
        </button>
        {msg && <div class="bad" style={{ marginTop: '10px' }}>{msg}</div>}
        <div class="foot">An original realm. All art, music and sound are generated procedurally.</div>
      </div>
    </div>
  );
}

export function FactionSelect(props: { app: App }) {
  const app = props.app;
  const pick = app.ui.factionPick;
  const d = factionDef(pick);
  const provinces = ANCHORS.filter((a) => a.owner === pick);
  const capital = provinces.find((a) => a.kind === 'capital');
  const [tutorial, setTutorial] = useState(app.settings.tutorial);
  return (
    <div class="fselect">
      <div class="head">
        <h1>Choose Your House</h1>
        <span class="muted serif">The same living realm awaits every house — only your seat of power changes.</span>
        <span class="spacer" />
        <button class="btn" onClick={() => ((app.state = 'menu'), app.notify())}>
          Back
        </button>
      </div>
      <div class="fgrid">
        {FACTIONS.map((f) => (
          <div class={`fcard ${f.id === pick ? 'on' : ''}`} onClick={() => ((app.ui.factionPick = f.id), app.audio.ui('select'), app.notify())}>
            <Shield faction={f.id} size={40} />
            <div>
              <div class="fname">{f.house}</div>
              <div class="small muted">{f.realm}</div>
            </div>
          </div>
        ))}
      </div>
      <div class="fdetail">
        <div class="panel col">
          <div class="panel-head">
            <Shield faction={pick} size={54} />
            <div>
              <h2>{d.house}</h2>
              <div class="muted serif">
                {d.realm} · <i>“{d.motto}”</i>
              </div>
            </div>
          </div>
          <div class="panel-body scroll">
            <div class="grid2">
              <div>
                <div class="section-title">Capital</div>
                <div>
                  {capital?.name} — {REGION_NAMES[capital?.region ?? ''] ?? ''}
                </div>
                <div class="section-title">Starting Lands</div>
                <div class="small">{provinces.map((p) => p.name).join(', ')}</div>
                <div class="section-title">Situation</div>
                <div class="small">{d.situation}</div>
              </div>
              <div>
                <div class="section-title">Strengths</div>
                <ul class="small" style={{ margin: 0, paddingLeft: '16px' }}>
                  {d.strengths.map((s) => (
                    <li>{s}</li>
                  ))}
                </ul>
                <div class="section-title">Military</div>
                <div class="small">{d.militaryTendency}</div>
                <div class="section-title">Economy</div>
                <div class="small">{d.economicTendency}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="panel col">
          <div class="panel-head">
            <h3>Begin the Campaign</h3>
          </div>
          <div class="panel-body">
            <p class="small muted">
              Spring, 1142. The Salt Coast has known twenty years of uneasy peace. Old claims fester, heirs come of age, and war fleets gather in the northern harbours.
            </p>
            <p class="small">
              <b class="gold">Victory</b> may be won by conquest (60% of the realm), by dynastic supremacy (overwhelming prestige and bonds with four great houses), or by imperial dominion (the three great mainland capitals and four of the five isles).
            </p>
            <label class="row small" style={{ margin: '10px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial((e.target as HTMLInputElement).checked)} /> Show guidance for new rulers
            </label>
            <button
              class="btn primary"
              style={{ fontSize: '1.3em', padding: '10px 26px' }}
              onClick={() => {
                app.applySettings({ ...app.settings, tutorial });
                app.newGame(pick);
              }}
            >
              Take the Throne
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SaveLoadModal(props: { app: App }) {
  const app = props.app;
  const mode = app.ui.saveLoad!;
  const [saves, setSaves] = useState<SaveMeta[]>(app.saves);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => listSaves().then((s) => ((app.saves = s), setSaves(s)));
  useEffect(() => {
    refresh();
  }, []);
  const close = () => ((app.ui.saveLoad = null), app.notify());
  return (
    <Modal title={mode === 'save' ? 'Save Campaign' : 'Load Campaign'} onClose={close} wide>
      {mode === 'save' && (
        <div class="row" style={{ marginBottom: '12px' }}>
          <input
            class="pe"
            style={{ flex: 1, background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px', fontFamily: 'var(--serif)' }}
            placeholder="Name this save…"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button
            class="btn primary"
            onClick={async () => {
              const slot = `save-${Date.now()}`;
              const ok = await app.saveGame(slot, name || undefined);
              setMsg(ok ? 'Saved.' : 'Save failed.');
              refresh();
            }}
          >
            Save New
          </button>
        </div>
      )}
      {msg && <div class="gold small" style={{ marginBottom: '8px' }}>{msg}</div>}
      <div class="list">
        {saves.length === 0 && <div class="muted">No saved campaigns.</div>}
        {saves.map((s) => (
          <div class="bcard">
            <Shield faction={s.faction} size={26} />
            <div style={{ flex: 1 }}>
              <div class="serif gold">{s.label}</div>
              <div class="tiny muted">
                {s.slot === 'autosave' ? 'Autosave · ' : ''}
                {SEASON_NAMES[s.season]} {s.year} · turn {s.turn + 1} · saved {new Date(s.savedAt).toLocaleString()}
              </div>
            </div>
            {mode === 'save' ? (
              <button
                class="btn small"
                onClick={async () => {
                  await app.saveGame(s.slot, name || undefined);
                  setMsg('Overwritten.');
                  refresh();
                }}
              >
                Overwrite
              </button>
            ) : (
              <button
                class="btn small primary"
                onClick={async () => {
                  const err = await app.loadGame(s.slot);
                  if (err) setMsg(err);
                  else close();
                }}
              >
                Load
              </button>
            )}
            <button
              class="btn small danger"
              onClick={async () => {
                await deleteSave(s.slot);
                refresh();
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function SettingsModal(props: { app: App }) {
  const app = props.app;
  const [s, setS] = useState<Settings>({ ...app.settings, keys: { ...app.settings.keys } });
  const [rebinding, setRebinding] = useState<string | null>(null);
  useEffect(() => {
    if (!rebinding) return;
    const fn = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setS((cur) => ({ ...cur, keys: { ...cur.keys, [rebinding]: e.code } }));
      setRebinding(null);
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [rebinding]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const slider = (label: string, k: keyof Settings, min: number, max: number, step: number) => (
    <label class="row small" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span class="row">
        <input class="pe" type="range" min={min} max={max} step={step} value={s[k] as number} onInput={(e) => set(k, Number((e.target as HTMLInputElement).value) as never)} />
        <span style={{ width: '38px', textAlign: 'right' }}>{Math.round((s[k] as number) * 100) / 100}</span>
      </span>
    </label>
  );
  const toggle = (label: string, k: keyof Settings) => (
    <label class="row small" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
      <span>{label}</span>
      <input class="pe" type="checkbox" checked={!!s[k]} onChange={(e) => set(k, (e.target as HTMLInputElement).checked as never)} />
    </label>
  );
  const select = (label: string, k: keyof Settings, opts: [number, string][]) => (
    <label class="row small" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <select class="pe" value={String(s[k])} onChange={(e) => set(k, Number((e.target as HTMLSelectElement).value) as never)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
        {opts.map(([v, l]) => (
          <option value={String(v)}>{l}</option>
        ))}
      </select>
    </label>
  );
  const close = () => ((app.ui.settings = false), app.notify());
  const keyNames: Record<string, string> = { panUp: 'Pan north', panDown: 'Pan south', panLeft: 'Pan west', panRight: 'Pan east', rotateLeft: 'Rotate left', rotateRight: 'Rotate right', endTurn: 'End turn', pause: 'Pause battle', mapMode: 'Cycle map mode', diplomacy: 'Diplomacy', family: 'Dynasty' };
  return (
    <Modal
      title="Settings"
      onClose={close}
      wide
      foot={
        <>
          <button class="btn" onClick={() => setS(detectSettings())}>
            Auto-detect
          </button>
          <button class="btn" onClick={() => setS({ ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } })}>
            Defaults
          </button>
          <span class="spacer" />
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button
            class="btn primary"
            onClick={() => {
              app.applySettings(s);
              close();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <div class="grid2" style={{ gap: '4px 30px' }}>
        <div class="col">
          <div class="section-title">Graphics</div>
          {slider('Resolution scale', 'resolutionScale', 0.5, 1.5, 0.05)}
          {select('Shadows', 'shadows', [
            [0, 'Off'],
            [1, 'Low'],
            [2, 'High'],
          ])}
          {slider('Vegetation density (next map load)', 'vegetation', 0.2, 1.5, 0.05)}
          {select('Water quality (next map load)', 'water', [
            [0, 'Low'],
            [1, 'High'],
          ])}
          {slider('Particles', 'particles', 0, 1, 0.05)}
          {toggle('Post-processing', 'postprocessing')}
          {toggle('Bloom', 'bloom')}
          {toggle('Anti-aliasing (MSAA)', 'antialias')}
          <div class="section-title">World</div>
          {slider('Length of a visual day (seconds)', 'dayLength', 120, 1800, 30)}
          {toggle('Freeze time of day', 'lockTime')}
        </div>
        <div class="col">
          <div class="section-title">Audio</div>
          {slider('Master', 'masterVolume', 0, 1, 0.05)}
          {slider('Music', 'musicVolume', 0, 1, 0.05)}
          {slider('Effects', 'sfxVolume', 0, 1, 0.05)}
          {slider('Ambience', 'ambientVolume', 0, 1, 0.05)}
          <div class="section-title">Interface &amp; Controls</div>
          {slider('Interface scale', 'uiScale', 0.8, 1.5, 0.05)}
          {slider('Mouse sensitivity', 'mouseSensitivity', 0.3, 2.5, 0.05)}
          {toggle('Edge scrolling', 'edgeScroll')}
          {toggle('Guidance for new rulers', 'tutorial')}
          <div class="section-title">Key Bindings</div>
          {Object.keys(DEFAULT_KEYS).map((k) => (
            <div class="row small" style={{ justifyContent: 'space-between' }}>
              <span>{keyNames[k] ?? k}</span>
              <button class="btn small" onClick={() => setRebinding(k)}>
                {rebinding === k ? 'Press a key…' : s.keys[k]?.replace('Key', '').replace('Digit', '')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function GameMenu(props: { app: App }) {
  const app = props.app;
  const close = () => ((app.ui.menu = false), app.notify());
  return (
    <Modal title="Realm Menu" onClose={close}>
      <div class="col" style={{ alignItems: 'stretch' }}>
        <button class="btn" onClick={close}>
          Resume
        </button>
        <button class="btn" onClick={() => ((app.ui.menu = false), (app.ui.saveLoad = 'save'), app.notify())}>
          Save Campaign
        </button>
        <button class="btn" onClick={() => ((app.ui.menu = false), (app.ui.saveLoad = 'load'), app.notify())}>
          Load Campaign
        </button>
        <button class="btn" onClick={() => ((app.ui.menu = false), (app.ui.settings = true), app.notify())}>
          Settings
        </button>
        <button class="btn" onClick={() => ((app.ui.menu = false), app.ui.openPanel('help'))}>
          How to Play
        </button>
        <button
          class="btn danger"
          onClick={async () => {
            await app.autosave();
            app.toMainMenu();
          }}
        >
          Save &amp; Exit to Main Menu
        </button>
      </div>
    </Modal>
  );
}
