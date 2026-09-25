import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { App } from '../app/app';
import type { BattleScene } from '../scenes/battleScene';
import type { NavalBattleScene } from '../scenes/navalBattleScene';
import type { BUnit } from '../battle/sim';
import type { NShip } from '../battle/naval';
import { factionDef } from '../data/factions';
import { Icons, Meter, Modal, Shield, Tip, UnitIcon, fmt } from './common';

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function unitStatus(b: BattleScene, u: BUnit): { text: string; cls: string } {
  if (u.state === 'dead') return { text: 'Destroyed', cls: 'bad' };
  if (u.state === 'fled') return { text: 'Fled', cls: 'bad' };
  if (u.state === 'routing') return { text: 'Routing', cls: 'bad' };
  if (u.state === 'wavering') return { text: 'Wavering', cls: 'warnc' };
  if (b.bsim.time - u.engagedT < 1.5) return { text: 'Engaged', cls: 'warnc' };
  if (u.def.range && u.def.category !== 'siege' && u.ammo <= 0) return { text: 'No ammo', cls: 'muted' };
  if (u.order === 'fire' || u.order === 'bombard') return { text: u.def.category === 'siege' ? 'Bombarding' : 'Firing', cls: 'good' };
  if (u.order === 'ram') return { text: 'Ramming gate', cls: 'good' };
  if (u.order === 'attack') return { text: u.running ? 'Charging' : 'Attacking', cls: 'good' };
  if (u.order === 'move') return { text: u.running ? 'Running' : 'Marching', cls: 'muted' };
  if (u.fatigue > 85) return { text: 'Exhausted', cls: 'warnc' };
  if (u.fatigue > 60) return { text: 'Tired', cls: 'muted' };
  return { text: 'Ready', cls: 'muted' };
}

// ------------------------------------------------------------------ banners over units (rAF-driven, no re-render)
function LandMarkers(props: { b: BattleScene }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = props.b;
    const root = ref.current!;
    const els = new Map<number, HTMLDivElement>();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const u of b.bsim.units) {
        let el = els.get(u.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'umark';
          const fd = factionDef(u.faction);
          el.style.setProperty('--fc', fd.color);
          el.innerHTML = `<div class="ubar"><div></div></div>`;
          el.onclick = (e) => {
            if (u.side === b.side && !u.ai) b.select([u], (e as MouseEvent).shiftKey);
          };
          el.ondblclick = () => b.focusUnit(u);
          root.appendChild(el);
          els.set(u.id, el);
        }
        const gone = u.state === 'dead' || u.state === 'fled';
        const p = gone ? null : b.project(u.cx, b.bsim.groundY(u.cx, u.cz) + (u.def.visual.mounted ? 7.5 : 6.2), u.cz);
        if (!p || !p.visible || b.view.cam.distance > 900) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
        const mine = u.side === b.side;
        const sel = b.selected.has(u);
        el.classList.toggle('enemy', !mine);
        el.classList.toggle('ally', mine && u.ai);
        el.classList.toggle('sel', sel);
        el.classList.toggle('rout', u.state === 'routing');
        el.classList.toggle('waver', u.state === 'wavering');
        const bar = el.querySelector('.ubar > div') as HTMLDivElement;
        bar.style.width = `${Math.max(0, Math.min(100, u.morale))}%`;
        const txt = `${u.isGeneral ? '♛ ' : ''}${u.state === 'routing' ? '⚑ ' : ''}${Math.round(u.alive * u.menPer)}`;
        if (el.dataset.t !== txt) {
          el.dataset.t = txt;
          let label = el.querySelector('.ulbl') as HTMLDivElement | null;
          if (!label) {
            label = document.createElement('div');
            label.className = 'ulbl';
            el.insertBefore(label, el.firstChild);
          }
          label.textContent = txt;
        }
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [props.b]);
  return <div ref={ref} class="umarks" />;
}

function NavalMarkers(props: { b: NavalBattleScene }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = props.b;
    const root = ref.current!;
    const els = new Map<number, HTMLDivElement>();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const s of b.ns.ships) {
        let el = els.get(s.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'umark';
          el.style.setProperty('--fc', factionDef(s.faction).color);
          el.innerHTML = `<div class="ulbl"></div><div class="ubar"><div></div></div><div class="ubar crew"><div></div></div>`;
          el.onclick = (e) => b.select([s], (e as MouseEvent).shiftKey);
          el.ondblclick = () => b.focusShip(s);
          root.appendChild(el);
          els.set(s.id, el);
        }
        const p = b.shipScreen(s);
        if (s.sunk || s.fled || !p.ok) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
        el.classList.toggle('enemy', s.side !== b.side);
        el.classList.toggle('sel', b.selected.has(s));
        el.classList.toggle('rout', s.fleeing || s.capturedBy !== null || s.sinking > 0);
        const bars = el.querySelectorAll('.ubar > div');
        (bars[0] as HTMLDivElement).style.width = `${(s.hull / s.maxHull) * 100}%`;
        (bars[1] as HTMLDivElement).style.width = `${(s.crew / s.maxCrew) * 100}%`;
        const txt = s.sinking > 0 ? `${s.name} — sinking` : s.capturedBy !== null ? `${s.name} — captured` : s.name;
        const l = el.firstElementChild as HTMLDivElement;
        if (l.textContent !== txt) l.textContent = txt;
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [props.b]);
  return <div ref={ref} class="umarks" />;
}

// ------------------------------------------------------------------ shared pieces
function TopStrip(props: { app: App; b: BattleScene | NavalBattleScene; left: string; right: string; time: number; extra?: h.JSX.Element | null }) {
  const { b } = props;
  const s0 = b.strength(0);
  const s1 = b.strength(1);
  const tot = s0 + s1 || 1;
  const speeds = [0.5, 1, 2, 4];
  return (
    <div class="panel bhud-top">
      <Shield faction={props.left} size={26} />
      <div class="col" style={{ gap: '3px', alignItems: 'center' }}>
        <div class="forces-bar">
          <div style={{ width: `${(s0 / tot) * 100}%`, background: factionDef(props.left).color }} />
          <div style={{ flex: 1, background: factionDef(props.right).color }} />
        </div>
        <div class="tiny muted">
          {b.side === 0 ? 'Attacking' : 'Defending'} · {fmtTime(props.time)}
          {props.extra}
        </div>
      </div>
      <Shield faction={props.right} size={26} />
      <div class="row" style={{ gap: '3px', marginLeft: '8px' }}>
        <Tip tip="Pause (Space)">
          <button class={`btn small ${b.paused ? 'active' : ''}`} onClick={() => b.togglePause()}>
            ❚❚
          </button>
        </Tip>
        {speeds.map((s) => (
          <Tip tip={`Speed ×${s} (+/−)`}>
            <button class={`btn small ${!b.paused && b.speed === s ? 'active' : ''}`} onClick={() => b.setSpeed(s)}>
              {s === 0.5 ? '½' : `${s}×`}
            </button>
          </Tip>
        ))}
        <Tip tip="Battle menu (Esc)">
          <button class="btn small" onClick={() => ((b.menuOpen = true), props.app.notify())}>
            <Icons.menu size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}

function BattleMenu(props: { app: App; b: BattleScene | NavalBattleScene }) {
  const { app, b } = props;
  if (!b.menuOpen || app.ui.settings) return null;
  const close = () => ((b.menuOpen = false), app.notify());
  return (
    <Modal title="Battle Paused" onClose={close}>
      <div class="col" style={{ alignItems: 'stretch' }}>
        <button class="btn primary" onClick={close}>
          Resume Battle
        </button>
        <button class="btn" onClick={() => ((app.ui.settings = true), app.notify())}>
          Settings
        </button>
        {b.phase !== 'over' && (
          <button
            class="btn danger"
            onClick={() => {
              app.ui.confirm = {
                text: 'Sound the retreat? Your forces will abandon the field and the battle will be lost.',
                onYes: () => {
                  b.menuOpen = false;
                  b.withdraw();
                },
              };
              app.notify();
            }}
          >
            Sound the Retreat
          </button>
        )}
      </div>
      <div class="section-title">Controls</div>
      <div class="small muted" style={{ lineHeight: 1.7 }}>
        <span class="kbd">Left click / drag</span> select · <span class="kbd">Right click</span> move / attack · <span class="kbd">Right drag</span> form a line · <span class="kbd">Double right click</span> run · <span class="kbd">WASD</span> pan ·{' '}
        <span class="kbd">Q/E</span> or <span class="kbd">middle drag</span> rotate · <span class="kbd">Wheel</span> zoom · <span class="kbd">Space</span> pause · <span class="kbd">Ctrl+1-9</span> groups · <span class="kbd">R</span> run ·{' '}
        <span class="kbd">F</span> fire at will · <span class="kbd">H</span> halt · <span class="kbd">L C O U</span> formations · <span class="kbd">Tab</span> cycle units
      </div>
    </Modal>
  );
}

function ResultOverlay(props: { app: App; b: BattleScene | NavalBattleScene; winner: number | null; reason: string; rows: [string, string, string][] }) {
  const { b } = props;
  if (b.phase !== 'over') return null;
  const won = props.winner === b.side;
  return (
    <div class="modal-back" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div class="panel modal" style={{ width: 'min(560px, 92vw)' }}>
        <div class="panel-head">
          <h2 class={won ? 'gold' : 'bad'}>{won ? 'Victory' : 'Defeat'}</h2>
        </div>
        <div class="panel-body">
          <div class="parchment">{props.reason}</div>
          <table class="small" style={{ width: '100%', marginTop: '12px', borderCollapse: 'collapse' }}>
            <tr class="muted">
              <td />
              <td style={{ textAlign: 'right' }}>Yours</td>
              <td style={{ textAlign: 'right' }}>Enemy</td>
            </tr>
            {props.rows.map(([k, a, c]) => (
              <tr>
                <td>{k}</td>
                <td style={{ textAlign: 'right' }}>{a}</td>
                <td style={{ textAlign: 'right' }}>{c}</td>
              </tr>
            ))}
          </table>
        </div>
        <div class="foot">
          <button class="btn primary" onClick={() => b.finish()}>
            Return to the Campaign
          </button>
        </div>
      </div>
    </div>
  );
}

function BoxSel(props: { r: { x0: number; y0: number; x1: number; y1: number } | null }) {
  const r = props.r;
  if (!r) return null;
  return <div class="selbox" style={{ left: `${Math.min(r.x0, r.x1)}px`, top: `${Math.min(r.y0, r.y1)}px`, width: `${Math.abs(r.x1 - r.x0)}px`, height: `${Math.abs(r.y1 - r.y0)}px` }} />;
}

// ------------------------------------------------------------------ land
function LandHUD(props: { app: App; b: BattleScene }) {
  const { app, b } = props;
  const bs = b.bsim;
  const units = b.playerUnits();
  const sel = [...b.selected];
  const f = b.dep.field.fort;
  const extra = f ? (
    <span>
      {' '}
      · Gate {f.gate.open ? <b class="bad">broken</b> : `${Math.round((f.gate.hp / f.gate.maxHp) * 100)}%`} · Breaches {f.segs.filter((s) => s.breached).length} · Square{' '}
      <b class={bs.capture > 0 ? 'warnc' : ''}>{Math.round(bs.capture * 100)}%</b>
    </span>
  ) : null;
  const anyRanged = sel.some((u) => u.def.range);
  const anyInf = sel.some((u) => !u.def.visual.mounted && u.def.category !== 'siege');
  const anyCav = sel.some((u) => u.def.visual.mounted);
  const rams = sel.some((u) => u.def.id === 'ram');
  const lost = (side: number) => bs.units.filter((u) => u.side === side).reduce((a, u) => a + (u.startTroops - bs.survivingMen(u)), 0);
  const start = (side: number) => bs.units.filter((u) => u.side === side).reduce((a, u) => a + u.startTroops, 0);
  const kills = (side: number) => bs.units.filter((u) => u.side === side).reduce((a, u) => a + u.killCount * u.menPer, 0);
  const my = b.side;
  const their = my === 0 ? 1 : 0;
  return (
    <div class="fullscreen" style={{ pointerEvents: 'none' }}>
      <LandMarkers b={b} />
      <TopStrip app={app} b={b} left={b.setup.attacker.faction} right={b.setup.defender.faction} time={bs.time} extra={extra} />
      {b.phase === 'deploy' && (
        <div class="panel deploy-banner pe">
          <div class="serif gold" style={{ fontSize: '1.2em' }}>
            Deployment
          </div>
          <div class="small muted">Position your troops within your deployment area: select units, then right-click or right-drag to place them.</div>
          <button class="btn primary" onClick={() => b.begin()}>
            Begin Battle
          </button>
        </div>
      )}
      {b.toast && <div class="toast">{b.toast.text}</div>}
      <BoxSel r={b.boxSel} />
      <div class="bhud-bottom">
        <div class="panel fmbtns">
          <Tip tip="Close line (L)">
            <button class="btn" disabled={!sel.length} onClick={() => b.setFormation('line')}>
              Line
            </button>
          </Tip>
          <Tip tip="Deep column: narrower, harder to break (C)">
            <button class="btn" disabled={!sel.length} onClick={() => b.setFormation('deep')}>
              Column
            </button>
          </Tip>
          <Tip tip="Loose order: fewer arrow casualties, weaker in melee (O)">
            <button class="btn" disabled={!sel.length} onClick={() => b.setFormation('loose')}>
              Loose
            </button>
          </Tip>
          <Tip tip={anyCav && !anyInf ? 'Wedge: cavalry charge formation (U)' : 'Square: all-round defence against cavalry (U)'}>
            <button
              class="btn"
              disabled={!sel.length}
              onClick={() => {
                for (const u of sel) b.bsim.setFormation(u, u.def.visual.mounted ? 'wedge' : 'square');
                app.notify();
              }}
            >
              {anyCav && !anyInf ? 'Wedge' : 'Square'}
            </button>
          </Tip>
          <Tip tip="Toggle running (R). Running tires troops but is needed to charge.">
            <button class={`btn ${sel.length && sel.every((u) => u.running) ? 'active' : ''}`} disabled={!sel.length} onClick={() => b.toggleRun()}>
              Run
            </button>
          </Tip>
          <Tip tip="Ranged units fire at the nearest enemy in range (F)">
            <button class={`btn ${anyRanged && sel.filter((u) => u.def.range).every((u) => u.fireAtWill) ? 'active' : ''}`} disabled={!anyRanged} onClick={() => b.toggleFireAtWill()}>
              Fire at Will
            </button>
          </Tip>
          <Tip tip="Stop and hold position (H)">
            <button class="btn" disabled={!sel.length} onClick={() => b.halt()}>
              Halt
            </button>
          </Tip>
          {rams && (
            <Tip tip="Send the ram against the gate">
              <button class="btn" onClick={() => b.orderRam()}>
                Ram Gate
              </button>
            </Tip>
          )}
          <Tip tip="Select all units (Ctrl+A)">
            <button class="btn" onClick={() => b.selectAll()}>
              All
            </button>
          </Tip>
        </div>
        <div class="panel bcards">
          {units.map((u) => {
            const st = unitStatus(b, u);
            const gone = u.state === 'dead' || u.state === 'fled';
            return (
              <Tip
                tip={() => (
                  <div>
                    <div class="serif gold">{u.generalName ?? u.def.name}</div>
                    <div class="small muted">{u.def.desc}</div>
                    <div class="small" style={{ marginTop: '4px' }}>
                      Men {fmt(u.alive * u.menPer)} / {fmt(u.startTroops)} · Morale {Math.round(u.morale)} · Fatigue {Math.round(u.fatigue)}
                      {u.def.range ? ` · Ammo ${Math.round((u.ammo / Math.max(1, u.maxAmmo)) * 100)}%` : ''}
                    </div>
                    <div class="small muted">
                      Attack {u.def.attack} · Defence {u.def.defense} · Armour {u.def.armor} · Charge {u.def.charge}
                    </div>
                  </div>
                )}
              >
                <div
                  class={`bunit ${b.selected.has(u) ? 'sel' : ''} ${gone ? 'gone' : ''} ${u.state === 'routing' ? 'rout' : ''}`}
                  onClick={(e) => {
                    if (!gone) b.select([u], (e as MouseEvent).shiftKey);
                  }}
                  onDblClick={() => b.focusUnit(u)}
                >
                  <div class="row" style={{ justifyContent: 'space-between' }}>
                    <UnitIcon cat={u.def.category} size={20} />
                    <span class="tiny">{fmt(u.alive * u.menPer)}</span>
                  </div>
                  <div class="tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.isGeneral ? 'General' : u.def.name}
                  </div>
                  <Meter v={u.morale} color={u.morale < 28 ? 'var(--danger)' : u.morale < 45 ? 'var(--warn)' : 'var(--good)'} />
                  <Meter v={100 - u.fatigue} color="#6a8fb3" />
                  {u.def.range ? <Meter v={u.ammo} max={Math.max(1, u.maxAmmo)} color="#c9a45c" /> : null}
                  <div class={`tiny ${st.cls}`}>{st.text}</div>
                </div>
              </Tip>
            );
          })}
        </div>
      </div>
      <BattleMenu app={app} b={b} />
      <ResultOverlay
        app={app}
        b={b}
        winner={bs.winner}
        reason={bs.endReason}
        rows={[
          ['Soldiers at the start', fmt(start(my)), fmt(start(their))],
          ['Fallen', fmt(lost(my)), fmt(lost(their))],
          ['Enemies slain', fmt(kills(my)), fmt(kills(their))],
          ['Units routed or destroyed', String(bs.units.filter((u) => u.side === my && u.state !== 'ok' && u.state !== 'wavering').length), String(bs.units.filter((u) => u.side === their && u.state !== 'ok' && u.state !== 'wavering').length)],
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ naval
function NavalHUD(props: { app: App; b: NavalBattleScene }) {
  const { app, b } = props;
  const ns = b.ns;
  const ships = b.playerShips();
  const my = b.side;
  const count = (side: number, pred: (s: NShip) => boolean) => String(ns.ships.filter((s) => s.side === side && pred(s)).length);
  const their = my === 0 ? 1 : 0;
  const windDeg = Math.round(((ns.windDir * 180) / Math.PI + 360) % 360);
  return (
    <div class="fullscreen" style={{ pointerEvents: 'none' }}>
      <NavalMarkers b={b} />
      <TopStrip
        app={app}
        b={b}
        left={b.setup.attacker.faction}
        right={b.setup.defender.faction}
        time={ns.time}
        extra={
          <span>
            {' '}
            · Wind <span style={{ display: 'inline-block', transform: `rotate(${windDeg}deg)` }}>↑</span>
          </span>
        }
      />
      {b.phase === 'deploy' && (
        <div class="panel deploy-banner pe">
          <div class="serif gold" style={{ fontSize: '1.2em' }}>
            The fleets close
          </div>
          <div class="small muted">Right-click an enemy ship to engage with archers and ballistae, Shift + right-click to grapple and board. Sailing ships are fastest with the wind behind them.</div>
          <button class="btn primary" onClick={() => b.begin()}>
            Begin Battle
          </button>
        </div>
      )}
      {b.toast && <div class="toast">{b.toast.text}</div>}
      <BoxSel r={b.boxSel} />
      <div class="bhud-bottom">
        <div class="panel fmbtns">
          <button class="btn" onClick={() => b.selectAll()}>
            All Ships
          </button>
          <button class="btn" disabled={!b.selected.size} onClick={() => b.halt()}>
            Heave To
          </button>
        </div>
        <div class="panel bcards">
          {ships.map((s) => {
            const gone = s.sunk || s.sinking > 0 || s.capturedBy !== null || s.fled;
            return (
              <Tip tip={`${s.name} (${s.def.name}) — hull ${Math.round(s.hull)}/${s.maxHull}, crew ${Math.round(s.crew)}/${s.maxCrew}`}>
                <div class={`bunit ${b.selected.has(s) ? 'sel' : ''} ${gone ? 'gone' : ''}`} onClick={(e) => !gone && b.select([s], (e as MouseEvent).shiftKey)} onDblClick={() => b.focusShip(s)}>
                  <div class="row" style={{ justifyContent: 'space-between' }}>
                    <Icons.ship size={18} />
                    <span class="tiny">{Math.round(s.crew)}</span>
                  </div>
                  <div class="tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.name}
                  </div>
                  <Meter v={s.hull} max={s.maxHull} color="#b08a52" />
                  <Meter v={s.crew} max={s.maxCrew} color="var(--good)" />
                  <div class="tiny muted">{s.sinking > 0 ? 'Sinking' : s.capturedBy !== null ? 'Captured' : s.fleeing ? 'Fleeing' : s.grappled ? 'Boarding' : s.order === 'attack' ? 'Engaging' : s.order === 'board' ? 'Closing to board' : s.order === 'move' ? 'Under sail' : 'Hove to'}</div>
                </div>
              </Tip>
            );
          })}
        </div>
      </div>
      <BattleMenu app={app} b={b} />
      <ResultOverlay
        app={app}
        b={b}
        winner={ns.winner}
        reason={ns.endReason}
        rows={[
          ['Ships', count(my, () => true), count(their, () => true)],
          ['Sunk', count(my, (s) => s.sunk || s.sinking > 0), count(their, (s) => s.sunk || s.sinking > 0)],
          ['Captured', count(my, (s) => s.capturedBy !== null), count(their, (s) => s.capturedBy !== null)],
          ['Crew lost', fmt(ns.ships.filter((s) => s.side === my).reduce((a, s) => a + s.startCrew - s.crew, 0)), fmt(ns.ships.filter((s) => s.side === their).reduce((a, s) => a + s.startCrew - s.crew, 0))],
        ]}
      />
    </div>
  );
}

export function BattleHUD(props: { app: App }) {
  const b = props.app.battle;
  if (!b) return null;
  if (b.name === 'naval') return <NavalHUD app={props.app} b={b as unknown as NavalBattleScene} />;
  return <LandHUD app={props.app} b={b as unknown as BattleScene} />;
}
