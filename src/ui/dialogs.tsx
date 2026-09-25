import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { App } from '../app/app';
import type { CampaignScene } from '../scenes/campaignScene';
import { factionDef } from '../data/factions';
import { shipDef, unitDef } from '../data/units';
import { Icons, Modal, Portrait, Shield, Tip, UnitIcon, fmt } from './common';
import { battleOdds, sideGeneral, sideUnits, type BattleSetup } from '../sim/battles';
import { resolveDecision } from '../sim/events';
import { age, fullName } from '../sim/characters';
import { troopCount } from '../sim/military';
import { SEASON_NAMES } from '../sim/types';
import { WEATHER_LABEL } from '../sim/weather';

const TERRAIN_LABEL: Record<string, string> = {
  plains: 'Open plains',
  grass: 'Grassland',
  forest: 'Woodland',
  hills: 'Hills',
  mountain: 'Mountain pass',
  marsh: 'Marshes',
  snow: 'Snowfields',
  desert: 'Dry steppe',
  beach: 'Shoreline',
  coast: 'Coast',
  sea: 'Open sea',
};

function SideSummary(props: { app: App; cs: CampaignScene; setup: BattleSetup; side: 'attacker' | 'defender'; power: number }) {
  const { cs, setup, side } = props;
  const sim = cs.sim;
  const s = setup[side];
  const fd = factionDef(s.faction);
  const gen = sideGeneral(sim, s);
  if (setup.kind === 'naval') {
    const ships = s.fleets.flatMap((id) => sim.s.fleets[id]?.ships ?? []);
    return (
      <div class="col" style={{ flex: 1 }}>
        <div class="row">
          <Shield faction={s.faction} size={34} />
          <div>
            <div class="serif gold">{fd.house}</div>
            <div class="small muted">{side === 'attacker' ? 'Attacking' : 'Defending'}</div>
          </div>
        </div>
        <div class="small">
          {ships.length} ships · {fmt(ships.reduce((a, x) => a + x.crew, 0))} crew
        </div>
        <div class="row wrap" style={{ gap: '4px' }}>
          {ships.slice(0, 14).map((sh) => (
            <Tip tip={`${shipDef(sh.type).name} — hull ${Math.round(sh.hull)}/${sh.maxHull}`}>
              <span class="chip">{shipDef(sh.type).name}</span>
            </Tip>
          ))}
        </div>
      </div>
    );
  }
  const units = sideUnits(sim, s);
  return (
    <div class="col" style={{ flex: 1 }}>
      <div class="row">
        <Shield faction={s.faction} size={34} />
        <div>
          <div class="serif gold">{fd.house}</div>
          <div class="small muted">
            {side === 'attacker' ? 'Attacking' : s.garrisonOf !== undefined ? 'Defending the walls' : 'Defending'}
          </div>
        </div>
      </div>
      {gen && (
        <div class="row small">
          <Portrait c={gen} age={age(sim, gen)} w={34} />
          <div>
            <div>{fullName(gen)}</div>
            <div class="muted tiny">Command {gen.skills.command}</div>
          </div>
        </div>
      )}
      <div class="small">
        {units.length} units · {fmt(troopCount(units.map((u) => u.unit)))} men
      </div>
      <div class="row wrap" style={{ gap: '3px' }}>
        {units.slice(0, 20).map(({ unit }) => {
          const d = unitDef(unit.type);
          return (
            <Tip tip={`${d.name} — ${unit.troops} men`}>
              <span class="chip row" style={{ gap: '3px', display: 'inline-flex' }}>
                <UnitIcon cat={d.category} size={12} />
                {unit.troops}
              </span>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}

export function PreBattle(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const pb = cs.pendingBattle;
  if (!pb) return null;
  const setup = pb.setup;
  const sim = cs.sim;
  const odds = battleOdds(sim, setup);
  const playerSide = setup.attacker.faction === sim.s.player ? 'attacker' : 'defender';
  const chance = playerSide === 'attacker' ? odds.chance : 1 - odds.chance;
  const verdict = chance > 0.8 ? 'Decisive advantage' : chance > 0.6 ? 'Favourable' : chance > 0.4 ? 'Evenly matched' : chance > 0.2 ? 'Unfavourable' : 'Hopeless';
  const vcls = chance > 0.6 ? 'good' : chance > 0.4 ? 'warnc' : 'bad';
  const title = setup.kind === 'naval' ? 'Battle at Sea' : setup.kind === 'siege' ? `Assault on ${sim.provName(setup.province)}` : `Battle near ${sim.provName(setup.province)}`;
  const canWithdraw = setup.kind !== 'siege' || playerSide === 'attacker';
  const tot = odds.attacker + odds.defender || 1;
  return (
    <Modal
      title={
        <span class="row">
          <Icons.swords size={20} /> {title}
        </span>
      }
      wide
      foot={
        <>
          <Tip tip="Withdraw from the field. Attackers call off the attack; defenders retreat with some losses.">
            <button class="btn" disabled={!canWithdraw} onClick={() => pb.resolve('withdraw')}>
              {playerSide === 'attacker' ? 'Call Off Attack' : 'Retreat'}
            </button>
          </Tip>
          <Tip tip="Resolve the battle instantly, based on strength, commanders, terrain and walls.">
            <button class="btn" onClick={() => pb.resolve('auto')}>
              Auto-Resolve
            </button>
          </Tip>
          <button class="btn primary" onClick={() => pb.resolve('manual')}>
            Take Command
          </button>
        </>
      }
    >
      <div class="row small muted" style={{ gap: '14px', marginBottom: '10px' }}>
        <span>{TERRAIN_LABEL[setup.terrain] ?? setup.terrain}</span>
        <span>{WEATHER_LABEL[setup.weather] ?? setup.weather}</span>
        <span>{SEASON_NAMES[setup.season]}</span>
        {setup.kind === 'siege' && <span>Walls level {setup.walls} · {setup.towers} towers</span>}
        {setup.river && <span>River crossing</span>}
      </div>
      <div class="row" style={{ alignItems: 'flex-start', gap: '20px' }}>
        <SideSummary app={app} cs={cs} setup={setup} side="attacker" power={odds.attacker} />
        <div class="col" style={{ alignItems: 'center', minWidth: '130px', paddingTop: '10px' }}>
          <div class="serif" style={{ fontSize: '1.8em', color: 'var(--gold)' }}>
            VS
          </div>
          <div class="forces-bar" style={{ width: '130px' }}>
            <div style={{ width: `${(odds.attacker / tot) * 100}%`, background: factionDef(setup.attacker.faction).color }} />
            <div style={{ flex: 1, background: factionDef(setup.defender.faction).color }} />
          </div>
          <div class={`serif ${vcls}`} style={{ marginTop: '6px' }}>
            {verdict}
          </div>
          <div class="tiny muted">{Math.round(chance * 100)}% estimated victory</div>
        </div>
        <SideSummary app={app} cs={cs} setup={setup} side="defender" power={odds.defender} />
      </div>
    </Modal>
  );
}

export function BattleResult(props: { app: App; cs: CampaignScene }) {
  const { cs } = props;
  const lb = cs.lastBattle;
  if (!lb) return null;
  const sim = cs.sim;
  const { setup, outcome } = lb;
  const winner = outcome.winner === 'attacker' ? setup.attacker.faction : setup.defender.faction;
  const playerWon = winner === sim.s.player;
  const playerInvolved = setup.attacker.faction === sim.s.player || setup.defender.faction === sim.s.player;
  const title = !playerInvolved ? 'Battle Report' : playerWon ? (outcome.heroic ? 'Heroic Victory' : 'Victory') : 'Defeat';
  const close = () => {
    cs.lastBattle = null;
    props.app.notify();
  };
  return (
    <Modal title={<span class={playerWon ? 'gold' : 'bad'}>{title}</span>} onClose={close} foot={<button class="btn primary" onClick={close}>Continue</button>}>
      <div class="row" style={{ gap: '16px', marginBottom: '10px' }}>
        <div class="col" style={{ alignItems: 'center', flex: 1 }}>
          <Shield faction={setup.attacker.faction} size={40} />
          <div class="serif">{factionDef(setup.attacker.faction).short}</div>
          <div class="small muted">Lost {fmt(outcome.killsD)}</div>
        </div>
        <div class="serif muted">{setup.kind === 'naval' ? 'at sea' : sim.provName(setup.province)}</div>
        <div class="col" style={{ alignItems: 'center', flex: 1 }}>
          <Shield faction={setup.defender.faction} size={40} />
          <div class="serif">{factionDef(setup.defender.faction).short}</div>
          <div class="small muted">Lost {fmt(outcome.killsA)}</div>
        </div>
      </div>
      {setup.kind === 'naval' && (
        <div class="small muted" style={{ textAlign: 'center' }}>
          {outcome.shipsSunk.length} ships sunk · {outcome.shipsCaptured.length} captured
        </div>
      )}
      <div class="parchment" style={{ marginTop: '10px' }}>
        {outcome.summary ? `${outcome.summary} ` : ''}
        {lb.text}
      </div>
      {(outcome.generalsKilled.length > 0 || outcome.generalsWounded.length > 0) && (
        <div class="small" style={{ marginTop: '8px' }}>
          {outcome.generalsKilled.map((id) => (
            <div class="bad">† {sim.char(id) ? fullName(sim.char(id)!) : 'A commander'} fell in the fighting.</div>
          ))}
          {outcome.generalsWounded.map((id) => (
            <div class="warnc">{sim.char(id) ? fullName(sim.char(id)!) : 'A commander'} was wounded.</div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function CaptureDialog(props: { app: App; cs: CampaignScene }) {
  const { cs } = props;
  const c = cs.pendingCapture;
  if (!c) return null;
  const p = cs.sim.s.provinces[c.province];
  if (!p) return null;
  const loot = Math.round(p.population * 0.06 + p.settlement.tier * 120);
  return (
    <Modal title={`${cs.sim.provName(c.province)} has fallen`}>
      <div class="parchment">
        The gates are ours. The people of {cs.sim.provName(c.province)} await the judgement of their new lord. Show mercy and they may come to accept your rule — or put the town to the sack, fill the war chest,
        and leave scorched streets and hatred behind.
      </div>
      <div class="row" style={{ gap: '10px', marginTop: '14px' }}>
        <Tip tip="Keep the population and buildings intact. Unrest is moderate and loyalty will grow in time.">
          <button class="btn primary" style={{ flex: 1 }} onClick={() => cs.resolveCapture('occupy')}>
            Occupy
            <div class="tiny muted">Rule with a steady hand</div>
          </button>
        </Tip>
        <Tip tip={`Plunder roughly ${fmt(loot)} gold. Population falls, buildings are damaged, unrest soars and your prestige with other houses suffers.`}>
          <button class="btn danger" style={{ flex: 1 }} onClick={() => cs.resolveCapture('sack')}>
            Sack
            <div class="tiny muted">≈ {fmt(loot)} gold, great unrest</div>
          </button>
        </Tip>
      </div>
    </Modal>
  );
}

export function DecisionDialog(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const d = sim.s.decisions.find((x) => x.faction === sim.s.player);
  if (!d || cs.busy) return null;
  return (
    <Modal title={d.title}>
      <div class="parchment" style={{ whiteSpace: 'pre-line' }}>
        {d.text}
      </div>
      <div class="col" style={{ marginTop: '12px', alignItems: 'stretch' }}>
        {d.options.map((o) => (
          <Tip tip={o.tooltip ?? ''}>
            <button
              class="btn"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => {
                const res = resolveDecision(sim, d.id, o.id);
                if (res) cs.showToast(res, 'info');
                app.audio.ui('click');
                app.notify();
              }}
            >
              {o.label}
            </button>
          </Tip>
        ))}
      </div>
    </Modal>
  );
}

export function Coronation(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const c = app.ui.coronation;
  if (!c) return null;
  const sim = cs.sim;
  const nr = sim.char(c.newRuler);
  const old = sim.char(c.oldRuler);
  const f = sim.s.factions[c.faction];
  const close = () => ((app.ui.coronation = null), app.notify());
  if (!nr) {
    app.ui.coronation = null;
    return null;
  }
  return (
    <Modal title="The King Is Dead — Long Live the King" onClose={close} foot={<button class="btn primary" onClick={close}>Long may they reign</button>}>
      <div class="row" style={{ gap: '16px', alignItems: 'flex-start' }}>
        {old && (
          <div class="col" style={{ alignItems: 'center', opacity: 0.7 }}>
            <Portrait c={old} age={age(sim, old)} w={80} />
            <div class="small muted">† {old.name}</div>
          </div>
        )}
        <div class="col" style={{ alignItems: 'center' }}>
          <Portrait c={nr} age={age(sim, nr)} w={110} />
          <div class="serif gold">{fullName(nr)}</div>
          <div class="small muted">Age {age(sim, nr)}</div>
        </div>
        <div class="col" style={{ flex: 1 }}>
          <div class="parchment">
            {old ? `${fullName(old)} has gone to the ancestors. ` : ''}
            The crown of {factionDef(c.faction).realm} passes to {fullName(nr)}. The great lords gather to swear fealty — though not all of them with an easy heart.
          </div>
          <div class="small" style={{ marginTop: '8px' }}>
            Legitimacy <b class={f.legitimacy >= 50 ? 'good' : 'bad'}>{Math.round(f.legitimacy)}</b>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function VictoryOverlay(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const v = cs.sim.s.victory;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (v) app.audio.setMood(v.faction === cs.sim.s.player ? 'victory' : 'defeat');
  }, [v?.faction, v?.kind]);
  if (!v || dismissed) return null;
  const won = v.faction === cs.sim.s.player;
  const kindText: Record<string, string> = {
    conquest: 'Every rival house has bent the knee or been swept from the map.',
    dynastic: 'Through blood and marriage, your dynasty now sits upon the great thrones of the realm.',
    imperial: 'The ancient capitals are yours, and the lords of the realm proclaim you emperor.',
    defeat: 'Your house has fallen. Its banners are torn down and its name passes into legend.',
  };
  return (
    <div class="modal-back" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <div class="col" style={{ alignItems: 'center', gap: '14px', maxWidth: '640px', textAlign: 'center' }}>
        <Shield faction={won ? cs.sim.s.player : v.faction === 'none' ? cs.sim.s.player : v.faction} size={110} />
        <div class="serif" style={{ fontSize: '3.2em', color: won ? 'var(--gold-bright)' : 'var(--danger)', letterSpacing: '0.08em' }}>
          {won ? 'VICTORY' : 'DEFEAT'}
        </div>
        <div class="serif" style={{ fontSize: '1.2em' }}>
          {won ? kindText[v.kind] ?? 'The realm is yours.' : v.kind === 'defeat' ? kindText.defeat : `${factionDef(v.faction).house} has claimed the realm. ${kindText[v.kind] ?? ''}`}
        </div>
        <div class="small muted">
          {cs.sim.s.stats.battles} battles fought · {cs.sim.s.stats.sieges} sieges · {cs.sim.s.stats.marriages} marriages · {cs.sim.s.stats.successions} successions
        </div>
        <div class="row" style={{ gap: '10px', marginTop: '10px' }}>
          {won && (
            <button class="btn" onClick={() => setDismissed(true)}>
              Continue Ruling
            </button>
          )}
          <button class="btn primary" onClick={() => app.toMainMenu()}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props: { app: App }) {
  const { app } = props;
  const c = app.ui.confirm;
  if (!c) return null;
  const close = () => ((app.ui.confirm = null), app.notify());
  return (
    <Modal
      title="Are you certain?"
      onClose={close}
      foot={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button
            class="btn primary"
            onClick={() => {
              app.ui.confirm = null;
              c.onYes();
              app.notify();
            }}
          >
            Confirm
          </button>
        </>
      }
    >
      <div>{c.text}</div>
    </Modal>
  );
}
