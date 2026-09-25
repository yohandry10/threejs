import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { App } from '../app/app';
import type { CampaignScene } from '../scenes/campaignScene';
import { FACTIONS, factionDef, isMajor } from '../data/factions';
import { Icons, Meter, Portrait, Shield, Tip, TipRows, fmt, fmtSigned } from './common';
import { age, canMarry, fullName, lineOfSuccession, skillOf, siblingsOf, ADULT_AGE } from '../sim/characters';
import {
  alliesOf,
  atWar,
  canDeclareWar,
  declareWar,
  enemiesOf,
  evaluateProposal,
  hasTreaty,
  militaryStrength,
  opinion,
  opinionBreakdown,
  overlordOf,
  propose,
  relationLabel,
  vassalsOf,
  warBetween,
  type Proposal,
  type ProposalKind,
} from '../sim/diplomacy';
import { factionEconomy, TAX_NAMES } from '../sim/economy';
import { councilCandidates, assignCouncil, SEAT_INFO, INTRIGUE_KINDS, intrigueChance, startIntrigue } from '../sim/intrigue';
import { victoryStatus } from '../sim/objectives';
import { COUNCIL_SEATS, SEASON_NAMES, type Character, type IntrigueOp } from '../sim/types';
import { traitDef } from '../data/traits';
import { troopCount } from '../sim/military';

function SidePanel(props: { app: App; title: string; children: h.JSX.Element | h.JSX.Element[]; right?: h.JSX.Element }) {
  return (
    <div class="panel sidepanel pe">
      <div class="panel-head">
        <h2>{props.title}</h2>
        <span class="spacer" />
        {props.right}
        <button class="close-x" onClick={() => props.app.ui.openPanel(null)}>
          ×
        </button>
      </div>
      <div class="panel-body scroll">{props.children}</div>
    </div>
  );
}

export function Traits(props: { c: Character }) {
  return (
    <span>
      {props.c.traits.map((t) => {
        const d = traitDef(t);
        return (
          <Tip tip={<div><div class="tt-title">{d?.name ?? t}</div>{d?.desc}</div>}>
            <span class={`trait ${d && !d.good ? 'badt' : ''}`}>{d?.name ?? t}</span>
          </Tip>
        );
      })}
    </span>
  );
}

function roleName(sim: CampaignScene['sim'], c: Character) {
  if (!c.alive) return `Died ${c.deathTurn !== undefined ? sim.s.startYear + Math.floor(c.deathTurn / 4) : ''}${c.deathCause ? ` (${c.deathCause})` : ''}`;
  const f = c.faction ? sim.fac(c.faction) : undefined;
  if (f?.ruler === c.id) return c.gender === 'm' ? 'King' : 'Queen';
  if (f?.heir === c.id) return 'Heir';
  if (c.role === 'consort') return c.gender === 'm' ? 'Prince consort' : 'Queen consort';
  if (c.council) return SEAT_INFO[c.council].name;
  if (c.role === 'general') return 'General';
  if (c.role === 'admiral') return 'Admiral';
  if (c.isKnight) return 'Knight';
  if (c.role === 'courtier') return c.title ?? 'Courtier';
  return c.gender === 'm' ? 'Prince' : 'Princess';
}

export function CharacterCard(props: { app: App; cs: CampaignScene; c: Character; compact?: boolean }) {
  const { cs, c } = props;
  const sim = cs.sim;
  const a = age(sim, c);
  const sp = sim.char(c.spouse);
  return (
    <div class="charcard">
      <Portrait c={c} age={a} w={props.compact ? 54 : 76} />
      <div class="col" style={{ gap: '3px', flex: 1 }}>
        <div class="serif gold" style={{ fontSize: '1.15em' }}>
          {fullName(c)}
        </div>
        <div class="small muted">
          {roleName(sim, c)} · {c.alive ? `age ${a}` : `lived ${Math.floor(((c.deathTurn ?? sim.s.turn) - c.birthTurn) / 4)} years`} · {c.faction ? factionDef(c.faction).short : 'landless'}
        </div>
        <div class="row small" style={{ gap: '10px' }}>
          <Tip tip="Command: leading armies and fleets.">
            <span>⚔ {skillOf(c, 'command')}</span>
          </Tip>
          <Tip tip="Diplomacy: relations and negotiations.">
            <span>✦ {skillOf(c, 'diplomacy')}</span>
          </Tip>
          <Tip tip="Stewardship: taxes, trade and building.">
            <span>⚖ {skillOf(c, 'stewardship')}</span>
          </Tip>
          <Tip tip="Intrigue: plots and counter-plots.">
            <span>☍ {skillOf(c, 'intrigue')}</span>
          </Tip>
          {c.alive && (
            <Tip tip="Loyalty to the crown. Disloyal lords may rebel or press claims.">
              <span class={c.loyalty < 35 ? 'bad' : ''}>♥ {Math.round(c.loyalty)}</span>
            </Tip>
          )}
          <Tip tip="Personal prestige.">
            <span class="gold">♛ {Math.round(c.prestige)}</span>
          </Tip>
        </div>
        <Traits c={c} />
        {!props.compact && (
          <div class="small">
            {sp && (
              <div>
                Spouse: <span class="gold">{fullName(sp)}</span> {sp.faction && sp.faction !== c.faction ? `(${factionDef(sp.faction).short})` : ''}
              </div>
            )}
            {c.claims.length > 0 && (
              <div>
                Claims:{' '}
                {c.claims.map((cl) => (
                  <span class="chip">{cl.kind === 'throne' ? `throne of ${factionDef(cl.target as string).short}` : sim.provName(cl.target as number)} ({cl.source})</span>
                ))}
              </div>
            )}
            {c.armyId !== undefined && <div>Commands: {sim.s.armies[c.armyId]?.name}</div>}
            {c.wounded && <div class="bad">Recovering from wounds</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ faction overview
export function FactionPanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const f = sim.fac(sim.s.player);
  const eco = factionEconomy(sim, f.id);
  const ruler = sim.char(f.ruler)!;
  const heir = sim.char(f.heir);
  const provs = sim.provincesOf(f.id);
  const armies = sim.armiesOf(f.id);
  const fleets = sim.fleetsOf(f.id);
  return (
    <SidePanel app={app} title={factionDef(f.id).realm} right={<Shield faction={f.id} size={30} />}>
      <div class="grid2">
        <div>
          <div class="section-title">Ruler</div>
          <CharacterCard app={app} cs={cs} c={ruler} />
          <div class="section-title">Heir</div>
          {heir ? <CharacterCard app={app} cs={cs} c={heir} compact /> : <div class="bad">No heir! Should the ruler die, the dynasty may end.</div>}
        </div>
        <div>
          <div class="section-title">The Realm</div>
          <div class="grid2 small">
            <span class="muted">Prestige</span>
            <span class="gold">{fmt(f.prestige)}</span>
            <span class="muted">Legitimacy</span>
            <span>
              {Math.round(f.legitimacy)} <Meter v={f.legitimacy} />
            </span>
            <span class="muted">Treasury</span>
            <span>
              {fmt(f.treasury)} ({fmtSigned(eco.net)}/season)
            </span>
            <span class="muted">Provinces</span>
            <span>{provs.length}</span>
            <span class="muted">Population</span>
            <span>{fmt(provs.reduce((s, p) => s + p.population, 0))}</span>
            <span class="muted">Armies</span>
            <span>
              {armies.length} ({fmt(armies.reduce((s, a) => s + troopCount(a.units), 0))} men)
            </span>
            <span class="muted">Fleets</span>
            <span>
              {fleets.length} ({fleets.reduce((s, x) => s + x.ships.length, 0)} ships)
            </span>
            <span class="muted">Reputation</span>
            <span>{Math.round(sim.s.diplomacy.reputation[f.id] ?? 60)}</span>
            <span class="muted">War weariness</span>
            <span>{Math.round(f.warWeariness)}</span>
          </div>
          <div class="section-title">Taxation</div>
          <div class="row">
            {TAX_NAMES.map((n, i) => (
              <Tip tip={['Low taxes: +10 public order, less gold.', 'Normal taxes.', 'High taxes: more gold, -12 public order.', 'Extortionate: much more gold, -28 public order. Risk of revolt.'][i]}>
                <button class={`btn small ${f.taxLevel === i ? 'active' : ''}`} onClick={() => ((f.taxLevel = i as 0), app.notify())}>
                  {n}
                </button>
              </Tip>
            ))}
          </div>
          <div class="section-title">Diplomatic Situation</div>
          <div class="small">
            {enemiesOf(sim, f.id).length ? (
              <div>
                At war with:{' '}
                {enemiesOf(sim, f.id).map((e) => (
                  <span class="chip war">{factionDef(e).short}</span>
                ))}
              </div>
            ) : (
              <div class="muted">At peace with all houses.</div>
            )}
            {alliesOf(sim, f.id).length > 0 && (
              <div>
                Allies:{' '}
                {alliesOf(sim, f.id).map((e) => (
                  <span class="chip ally">{factionDef(e).short}</span>
                ))}
              </div>
            )}
            {vassalsOf(sim, f.id).length > 0 && <div>Vassals: {vassalsOf(sim, f.id).map((e) => factionDef(e).short).join(', ')}</div>}
            {overlordOf(sim, f.id) && <div class="warnc">Vassal of {factionDef(overlordOf(sim, f.id)!).house}</div>}
          </div>
        </div>
      </div>
      <div class="section-title">Provinces</div>
      <div class="list">
        {provs.map((p) => (
          <div class="bcard can" onClick={() => cs.select({ kind: 'settlement', id: p.id }, true)}>
            <span class="serif gold">{p.settlement.name}</span>
            <span class="tiny muted">{sim.fac(f.id).capital === p.id ? 'capital' : ''}</span>
            <span class="spacer" />
            <span class="small">pop {fmt(p.population)}</span>
            <span class={`small ${p.publicOrder < 0 ? 'bad' : 'good'}`}>order {fmtSigned(p.publicOrder)}</span>
            <span class="small gold">+{fmt(p.income)}g</span>
            {p.siege && <span class="bad small">besieged</span>}
          </div>
        ))}
      </div>
      <div class="section-title">Armies &amp; Fleets</div>
      <div class="list">
        {armies.map((a) => (
          <div class="bcard can" onClick={() => cs.select({ kind: 'army', id: a.id }, true)}>
            <Icons.sword />
            <span>{a.name}</span>
            <span class="spacer" />
            <span class="small">{fmt(troopCount(a.units))} men</span>
            <span class="small muted">{a.embarked !== undefined ? 'at sea' : a.siegeOf !== undefined ? 'besieging' : ''}</span>
          </div>
        ))}
        {fleets.map((fl) => (
          <div class="bcard can" onClick={() => cs.select({ kind: 'fleet', id: fl.id }, true)}>
            <Icons.ship />
            <span>{fl.name}</span>
            <span class="spacer" />
            <span class="small">{fl.ships.length} ships</span>
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ diplomacy
export function DiplomacyPanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const me = sim.s.player;
  const others = [...FACTIONS.map((f) => f.id), 'free'].filter((x) => x !== me);
  const target = app.ui.diploTarget && app.ui.diploTarget !== me ? app.ui.diploTarget : others.find((x) => sim.fac(x)?.alive) ?? others[0];
  const tf = sim.fac(target);
  const [result, setResult] = useState<string | null>(null);
  const [amount, setAmount] = useState(100);
  const [prov, setProv] = useState<number | undefined>(undefined);
  const [myChar, setMyChar] = useState<number | undefined>(undefined);
  const [theirChar, setTheirChar] = useState<number | undefined>(undefined);
  const [peaceTerms, setPeaceTerms] = useState<'white' | 'cede' | 'tribute' | 'receive'>('white');
  const alive = tf?.alive;
  const war = warBetween(sim, me, target);
  const ruler = sim.char(tf?.ruler);
  const op = opinion(sim, target, me);
  const myOp = opinion(sim, me, target);
  const doPropose = (p: Proposal) => {
    const r = propose(sim, p);
    setResult(r.text);
    app.audio.ui(r.accepted ? 'coin' : 'error');
    if (r.accepted && p.kind === 'marriage') app.audio.event('marriage');
    cs.setMapMode(cs.mapMode, true);
    app.notify();
  };
  const preview = (p: Proposal) => {
    const ev = evaluateProposal(sim, p);
    if (ev.impossible) return <div class="bad">{ev.impossible}</div>;
    return (
      <div>
        <div class="tt-title">{ev.accept ? 'They would likely agree' : 'They would likely refuse'}</div>
        {ev.reasons.map((r) => (
          <div class="tt-row">
            <span class="muted">{r.label}</span>
            <span class={r.value >= 0 ? 'good' : 'bad'}>{fmtSigned(r.value)}</span>
          </div>
        ))}
      </div>
    );
  };
  const Action = (p: { label: string; prop: Proposal; danger?: boolean }) => {
    const ev = evaluateProposal(sim, p.prop);
    const dis = !!ev.impossible;
    return (
      <Tip tip={() => preview(p.prop)}>
        <button class={`btn small ${p.danger ? 'danger' : ''}`} disabled={dis || !alive} onClick={() => doPropose(p.prop)}>
          {p.label} {!dis && <span class={ev.accept ? 'good' : 'bad'}>{ev.accept ? '●' : '○'}</span>}
        </button>
      </Tip>
    );
  };
  const P = (kind: ProposalKind, extra: Partial<Proposal> = {}): Proposal => ({ kind, from: me, to: target, ...extra });
  const myFamily = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === me && c.spouse === undefined && age(sim, c) >= ADULT_AGE && c.role !== 'consort');
  const theirFamily = Object.values(sim.s.characters).filter((c) => c.alive && c.faction === target && c.spouse === undefined && age(sim, c) >= ADULT_AGE);
  const cb = canDeclareWar(sim, me, target);
  return (
    <SidePanel app={app} title="Diplomacy">
      <div class="row" style={{ alignItems: 'flex-start', gap: '14px' }}>
        <div class="faclist" style={{ width: '220px', flexShrink: 0 }}>
          {others.map((id) => {
            const fs = sim.fac(id);
            const o = opinion(sim, id, me);
            return (
              <div class={`facrow ${id === target ? 'on' : ''}`} style={{ opacity: fs?.alive ? 1 : 0.45 }} onClick={() => ((app.ui.diploTarget = id), setResult(null), app.notify())}>
                <Shield faction={id} size={22} />
                <div style={{ flex: 1 }}>
                  <div class="serif small">{factionDef(id).short}</div>
                  <div class="tiny muted">{fs?.alive ? relationLabel(o) : 'fallen'}</div>
                </div>
                {atWar(sim, me, id) && <span class="chip war">war</span>}
                {hasTreaty(sim, me, id, 'alliance') && <span class="chip ally">ally</span>}
                {sim.s.decisions.some((d) => d.kind === 'proposal' && (d.data?.proposal as Proposal)?.from === id) && <span class="badge" style={{ position: 'static' }}>!</span>}
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="row">
            <Shield faction={target} size={44} />
            <div>
              <h3 class="gold">{factionDef(target).house}</h3>
              <div class="small muted">
                {factionDef(target).realm} · {tf?.personality}
              </div>
            </div>
          </div>
          {!alive && <div class="bad" style={{ marginTop: '8px' }}>This house has lost all its lands. Its heirs live in exile.</div>}
          {alive && (
            <div class="grid2" style={{ marginTop: '8px' }}>
              <div>
                {ruler && <CharacterCard app={app} cs={cs} c={ruler} compact />}
              </div>
              <div class="small">
                <Tip tip={() => <TipRows title="Their opinion of you" rows={opinionBreakdown(sim, target, me).map((p) => [p.label, p.value, p.value >= 0 ? 'good' : 'bad'])} />}>
                  <div>
                    Their opinion of you: <b class={op >= 0 ? 'good' : 'bad'}>{fmtSigned(op)}</b> ({relationLabel(op)})
                  </div>
                </Tip>
                <Tip tip={() => <TipRows title="Your opinion of them" rows={opinionBreakdown(sim, me, target).map((p) => [p.label, p.value, p.value >= 0 ? 'good' : 'bad'])} />}>
                  <div class="muted">Your court's view of them: {fmtSigned(myOp)}</div>
                </Tip>
                <div>Prestige {fmt(tf.prestige)} · Legitimacy {Math.round(tf.legitimacy)}</div>
                <div>Military strength ≈ {fmt(militaryStrength(sim, target))} (yours {fmt(militaryStrength(sim, me))})</div>
                <div>Provinces: {sim.provincesOf(target).length}</div>
                <div>
                  Treaties:{' '}
                  {sim.s.diplomacy.treaties
                    .filter((t) => (t.a === target || t.b === target) && (t.a === me || t.b === me))
                    .map((t) => (
                      <span class="chip">{t.type}</span>
                    ))}
                  {!sim.s.diplomacy.treaties.some((t) => (t.a === target || t.b === target) && (t.a === me || t.b === me)) && <span class="muted">none</span>}
                </div>
                <div>
                  Their wars:{' '}
                  {enemiesOf(sim, target).map((e) => (
                    <span class="chip war">{factionDef(e).short}</span>
                  ))}
                  {!enemiesOf(sim, target).length && <span class="muted">none</span>}
                </div>
                <div>
                  Their allies:{' '}
                  {alliesOf(sim, target).map((e) => (
                    <span class="chip ally">{factionDef(e).short}</span>
                  ))}
                  {!alliesOf(sim, target).length && <span class="muted">none</span>}
                </div>
              </div>
            </div>
          )}
          {result && (
            <div class="parchment" style={{ margin: '10px 0', fontSize: '1em', padding: '8px 12px' }}>
              {result}
            </div>
          )}
          {alive && (
            <>
              <div class="section-title">Envoys &amp; Treaties</div>
              <div class="row wrap">
                {[100, 300, 600].map((g) => (
                  <Action label={`Gift ${g} gold`} prop={P('gift', { amount: g })} />
                ))}
                <Action label="Alliance" prop={P('alliance')} />
                <Action label="Defensive pact" prop={P('defensive')} />
                <Action label="Non-aggression" prop={P('nonaggression')} />
                <Action label="Trade agreement" prop={P('trade')} />
                <Action label="Request military access" prop={P('request_access')} />
                <Action label="Grant military access" prop={P('grant_access')} />
                {(hasTreaty(sim, me, target, 'alliance') || hasTreaty(sim, me, target, 'defensive')) && <Action label="Break alliance" prop={P('break_alliance')} danger />}
              </div>
              <div class="section-title">Royal Marriage</div>
              <div class="row wrap small">
                <select class="pe" value={String(myChar ?? '')} onChange={(e) => setMyChar(Number((e.target as HTMLSelectElement).value) || undefined)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                  <option value="">Your kin…</option>
                  {myFamily.map((c) => (
                    <option value={String(c.id)}>
                      {fullName(c)} ({c.gender === 'm' ? '♂' : '♀'} {age(sim, c)})
                    </option>
                  ))}
                </select>
                <span class="muted">to wed</span>
                <select class="pe" value={String(theirChar ?? '')} onChange={(e) => setTheirChar(Number((e.target as HTMLSelectElement).value) || undefined)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                  <option value="">Their kin…</option>
                  {theirFamily.map((c) => (
                    <option value={String(c.id)}>
                      {fullName(c)} ({c.gender === 'm' ? '♂' : '♀'} {age(sim, c)}){tf.heir === c.id ? ' — heir' : tf.ruler === c.id ? ' — ruler' : ''}
                    </option>
                  ))}
                </select>
                <Action label="Propose marriage" prop={P('marriage', { charA: myChar, charB: theirChar })} />
              </div>
              {myChar !== undefined && theirChar !== undefined && sim.char(myChar) && sim.char(theirChar) && canMarry(sim, sim.char(myChar)!, sim.char(theirChar)!) && <div class="bad small">{canMarry(sim, sim.char(myChar)!, sim.char(theirChar)!)}</div>}
              <div class="tiny muted" style={{ marginTop: '3px' }}>Children of a marriage into a ruling family may inherit claims — or the throne itself if their line fails.</div>
              <div class="section-title">Demands &amp; Offers</div>
              <div class="row wrap small">
                <select class="pe" value={String(amount)} onChange={(e) => setAmount(Number((e.target as HTMLSelectElement).value))} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                  {[50, 100, 200].map((v) => (
                    <option value={String(v)}>{v} gold / season</option>
                  ))}
                </select>
                <Action label="Demand tribute" prop={P('demand_tribute', { amount })} />
                <Action label="Offer tribute" prop={P('offer_tribute', { amount })} />
              </div>
              <div class="row wrap small" style={{ marginTop: '5px' }}>
                <select class="pe" value={String(prov ?? '')} onChange={(e) => setProv(Number((e.target as HTMLSelectElement).value))} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                  <option value="">Province…</option>
                  <optgroup label={`${factionDef(target).short} lands`}>
                    {sim.provincesOf(target).map((p) => (
                      <option value={String(p.id)}>{p.settlement.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Your lands">
                    {sim.provincesOf(me).map((p) => (
                      <option value={String(p.id)}>{p.settlement.name}</option>
                    ))}
                  </optgroup>
                </select>
                <Action label="Demand province" prop={P('demand_territory', { province: prov })} />
                <Action label="Offer province" prop={P('offer_territory', { province: prov })} />
              </div>
              <div class="row wrap small" style={{ marginTop: '5px' }}>
                <Action label="Demand vassalage" prop={P('demand_vassal')} />
                <Action label="Swear fealty" prop={P('offer_vassal')} />
                {overlordOf(sim, target) === me && <Action label="Release vassal" prop={P('release_vassal')} />}
              </div>
              <div class="section-title">War &amp; Peace</div>
              {war ? (
                <div>
                  <div class="small">
                    <b class="bad">{war.name}</b> — war score {fmtSigned(war.attackers.includes(me) ? war.score : -war.score)} · {war.battles} battles · since {SEASON_NAMES[(war.startTurn % 4 + 4) % 4]} {sim.s.startYear + Math.floor(war.startTurn / 4)}
                  </div>
                  <div class="row wrap small" style={{ marginTop: '5px' }}>
                    <select class="pe" value={peaceTerms} onChange={(e) => setPeaceTerms((e.target as HTMLSelectElement).value as never)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                      <option value="white">White peace</option>
                      <option value="cede">They cede a province…</option>
                      <option value="receive">They pay tribute</option>
                      <option value="tribute">We pay tribute</option>
                    </select>
                    {peaceTerms === 'cede' && (
                      <select class="pe" value={String(prov ?? '')} onChange={(e) => setProv(Number((e.target as HTMLSelectElement).value))} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                        <option value="">Province…</option>
                        {sim.provincesOf(target).map((p) => (
                          <option value={String(p.id)}>{p.settlement.name}</option>
                        ))}
                      </select>
                    )}
                    <Action label="Propose peace" prop={P('peace', { peaceTerms, province: peaceTerms === 'cede' ? prov : undefined })} />
                  </div>
                </div>
              ) : (
                <div class="row">
                  <Tip tip={<div>{cb.ok ? <><div class="tt-title">{cb.casusBelli ? 'Casus belli' : 'No casus belli'}</div><div>{cb.cbLabel}</div><div class="muted small">Their allies will be called to defend them.</div></> : cb.reason}</div>}>
                    <button
                      class="btn danger"
                      disabled={!cb.ok}
                      onClick={() =>
                        (app.ui.confirm = {
                          text: `Declare war on ${factionDef(target).house}? ${cb.casusBelli ? '' : 'Without a just cause your reputation and legitimacy will suffer.'} Their allies (${alliesOf(sim, target).map((x) => factionDef(x).short).join(', ') || 'none'}) may join them.`,
                          onYes: () => {
                            declareWar(sim, me, target);
                            app.audio.event('war');
                            setResult(`War is declared upon ${factionDef(target).house}.`);
                            cs.setMapMode(cs.mapMode, true);
                          },
                        }) && app.notify()
                      }
                    >
                      Declare War
                    </button>
                  </Tip>
                  {!cb.ok && <span class="small muted">{cb.reason}</span>}
                  {cb.ok && <span class="small muted">{cb.cbLabel}</span>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ dynasty
export function DynastyPanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const [house, setHouse] = useState(sim.s.player);
  const f = sim.fac(house);
  const focus = sim.char(app.ui.charFocus ?? undefined) ?? sim.char(f.ruler)!;
  // build tree: start at the earliest past ruler of the house
  const rootC = sim.char(f.pastRulers[0]) ?? sim.char(f.ruler)!;
  type Node = { c: Character; x: number; y: number; spouse?: Character };
  const nodes: Node[] = [];
  const edges: [number, number, number, number][] = [];
  const W = 150;
  const H = 128;
  const visit = (c: Character, depth: number, x0: number): number => {
    const kids = c.children.map((id) => sim.char(id)!).filter((k) => k && (k.dynasty === c.dynasty || depth < 1 || k.faction === house));
    kids.sort((a, b) => a.birthTurn - b.birthTurn);
    let width = 0;
    const childXs: number[] = [];
    let cx = x0;
    for (const k of kids.slice(0, 7)) {
      const w = visit(k, depth + 1, cx);
      childXs.push(cx + w / 2);
      cx += w;
      width += w;
    }
    const self = Math.max(width, W * (c.spouse !== undefined ? 1.6 : 1));
    const x = x0 + self / 2;
    const sp = sim.char(c.spouse);
    nodes.push({ c, x, y: depth * H, spouse: sp });
    for (const kx of childXs) edges.push([x, depth * H + 96, kx, (depth + 1) * H]);
    return self;
  };
  const totalW = rootC ? visit(rootC, 0, 0) : 0;
  const maxDepth = Math.max(0, ...nodes.map((n) => n.y / H));
  const line = lineOfSuccession(sim, house, 6);
  return (
    <SidePanel
      app={app}
      title={`${factionDef(house).house} — Family Tree`}
      right={
        <select class="pe" value={house} onChange={(e) => ((app.ui.charFocus = null), setHouse((e.target as HTMLSelectElement).value))} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          {FACTIONS.map((x) => (
            <option value={x.id}>{x.house}</option>
          ))}
        </select>
      }
    >
      <div class="row" style={{ alignItems: 'flex-start', gap: '12px' }}>
        <div class="tree scroll" style={{ height: '52vh', flex: 1, border: '1px solid var(--line)', background: 'rgba(0,0,0,0.25)' }}>
          <div style={{ position: 'relative', width: `${totalW + 40}px`, height: `${(maxDepth + 1) * H + 20}px`, margin: '10px' }}>
            <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width={totalW} height={(maxDepth + 1) * H}>
              {edges.map(([x1, y1, x2, y2]) => (
                <path d={`M${x1} ${y1} V${(y1 + y2) / 2 + 6} H${x2} V${y2}`} stroke="rgba(201,164,92,0.5)" fill="none" />
              ))}
            </svg>
            {nodes.map((n) => {
              const c = n.c;
              const sp = n.spouse;
              return (
                <>
                  <div class={`tnode ${!c.alive ? 'dead' : ''} ${focus.id === c.id ? 'sel' : ''}`} style={{ left: `${n.x - 66 - (sp ? 34 : 0)}px`, top: `${n.y}px` }} onClick={() => ((app.ui.charFocus = c.id), app.notify())}>
                    <Portrait c={c} age={age(sim, c)} w={58} h={70} />
                    <div class="serif" style={{ lineHeight: 1.1 }}>{c.name}</div>
                    <div class="role">{f.ruler === c.id ? '♛ Ruler' : f.heir === c.id ? 'Heir' : !c.alive ? '†' : age(sim, c) < ADULT_AGE ? `child, ${age(sim, c)}` : age(sim, c)}</div>
                  </div>
                  {sp && (
                    <div class={`tnode ${!sp.alive ? 'dead' : ''} ${focus.id === sp.id ? 'sel' : ''}`} style={{ left: `${n.x - 66 + 42}px`, top: `${n.y + 8}px`, transform: 'scale(0.82)' }} onClick={() => ((app.ui.charFocus = sp.id), app.notify())}>
                      <Portrait c={sp} age={age(sim, sp)} w={58} h={70} />
                      <div class="serif" style={{ lineHeight: 1.1 }}>⚭ {sp.name}</div>
                      <div class="tiny muted">{sp.dynasty !== c.dynasty && sim.s.factions[sp.dynasty] ? factionDef(sp.dynasty).short : ''}</div>
                    </div>
                  )}
                </>
              );
            })}
          </div>
        </div>
        <div style={{ width: '290px', flexShrink: 0 }}>
          <CharacterCard app={app} cs={cs} c={focus} />
          <div class="small" style={{ marginTop: '6px' }}>
            {focus.father !== undefined && sim.char(focus.father) && (
              <div>
                Father:{' '}
                <span class="linkish" onClick={() => ((app.ui.charFocus = focus.father!), app.notify())}>
                  {fullName(sim.char(focus.father)!)}
                </span>
              </div>
            )}
            {focus.mother !== undefined && sim.char(focus.mother) && (
              <div>
                Mother:{' '}
                <span class="linkish" onClick={() => ((app.ui.charFocus = focus.mother!), app.notify())}>
                  {fullName(sim.char(focus.mother)!)}
                </span>
              </div>
            )}
            {siblingsOf(sim, focus).length > 0 && <div>Siblings: {siblingsOf(sim, focus).map((s) => s.name).join(', ')}</div>}
            {focus.children.length > 0 && <div>Children: {focus.children.map((k) => sim.char(k)?.name).join(', ')}</div>}
          </div>
          {focus.alive && focus.faction === sim.s.player && focus.spouse === undefined && age(sim, focus) >= ADULT_AGE && focus.role !== 'consort' && (
            <button class="btn small" style={{ marginTop: '8px' }} onClick={() => ((app.ui.panel = 'diplomacy'), app.notify())}>
              Seek a marriage for {focus.name}
            </button>
          )}
          <div class="section-title">Line of Succession</div>
          <div class="small muted">{f.succession === 'agnatic' ? 'Agnatic primogeniture (sons only)' : f.succession === 'elective' ? 'Elective (the most capable of the blood)' : 'Male-preference primogeniture'}</div>
          <ol class="small" style={{ paddingLeft: '18px', margin: '4px 0' }}>
            {line.map((c) => (
              <li>
                <span class="linkish" onClick={() => ((app.ui.charFocus = c.id), app.notify())}>
                  {fullName(c)}
                </span>{' '}
                <span class="muted">({age(sim, c)})</span>
                {c.faction !== house && c.faction && <span class="warnc"> — {factionDef(c.faction).short}</span>}
              </li>
            ))}
          </ol>
          {!line.length && <div class="bad small">No heir of the blood!</div>}
        </div>
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ council & intrigue
export function CouncilPanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const me = sim.s.player;
  const f = sim.fac(me);
  const cands = councilCandidates(sim, me);
  const [kind, setKind] = useState<IntrigueOp['kind']>('intel');
  const [target, setTarget] = useState(FACTIONS.find((x) => x.id !== me)!.id);
  const [third, setThird] = useState<string | undefined>(undefined);
  const [prov, setProv] = useState<number | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const odds = intrigueChance(sim, me, kind, target);
  return (
    <SidePanel app={app} title="Small Council &amp; Intrigue">
      <div class="list">
        {COUNCIL_SEATS.map((seat) => {
          const c = sim.char(f.council[seat]);
          const info = SEAT_INFO[seat];
          return (
            <div class="bcard" style={{ alignItems: 'flex-start' }}>
              {c ? <Portrait c={c} age={age(sim, c)} w={42} /> : <div class="portrait" style={{ width: '42px', height: '50px' }} />}
              <div style={{ flex: 1 }}>
                <div class="serif gold">{info.name}</div>
                <div class="small">{c ? `${fullName(c)} — ${info.skill} ${skillOf(c, info.skill)}` : <span class="muted">Vacant</span>}</div>
                <div class="tiny muted">{info.effect}</div>
              </div>
              <select
                class="pe"
                value={String(c?.id ?? '')}
                onChange={(e) => {
                  const v = Number((e.target as HTMLSelectElement).value);
                  assignCouncil(sim, me, seat, v || undefined);
                  app.notify();
                }}
                style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)', maxWidth: '220px' }}
              >
                <option value="">— vacant —</option>
                {cands.map((x) => (
                  <option value={String(x.id)}>
                    {fullName(x)} ({info.skill.slice(0, 3)} {skillOf(x, info.skill)})
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div class="section-title">Intrigue</div>
      <div class="small muted">Your spymaster may run two operations at a time. Every plot risks discovery, which angers the victim and tarnishes your reputation.</div>
      <div class="row wrap small" style={{ marginTop: '6px' }}>
        <select class="pe" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as never)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          {Object.entries(INTRIGUE_KINDS).map(([k, v]) => (
            <option value={k}>
              {v.name} ({v.cost}g)
            </option>
          ))}
        </select>
        <span class="muted">against</span>
        <select class="pe" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          {FACTIONS.filter((x) => x.id !== me && sim.fac(x.id).alive).map((x) => (
            <option value={x.id}>{x.house}</option>
          ))}
        </select>
        {kind === 'sabotage' && (
          <select class="pe" value={third ?? ''} onChange={(e) => setThird((e.target as HTMLSelectElement).value)} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
            <option value="">…and whom?</option>
            {FACTIONS.filter((x) => x.id !== me && x.id !== target && sim.fac(x.id).alive).map((x) => (
              <option value={x.id}>{x.house}</option>
            ))}
          </select>
        )}
        {kind === 'fabricate' && (
          <select class="pe" value={String(prov ?? '')} onChange={(e) => setProv(Number((e.target as HTMLSelectElement).value))} style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)' }}>
            <option value="">Province…</option>
            {sim.provincesOf(target).map((p) => (
              <option value={String(p.id)}>{p.settlement.name}</option>
            ))}
          </select>
        )}
        <button
          class="btn small primary"
          onClick={() => {
            const err = startIntrigue(sim, me, kind, target, { third, province: prov });
            setMsg(err ?? `${INTRIGUE_KINDS[kind].name} begins. Results in ${INTRIGUE_KINDS[kind].turns} season(s).`);
            app.notify();
          }}
        >
          Begin
        </button>
      </div>
      <div class="tiny muted" style={{ marginTop: '4px' }}>
        {INTRIGUE_KINDS[kind].desc} Success {Math.round(odds.chance * 100)}% · discovery {Math.round(odds.detect * 100)}%
      </div>
      {msg && <div class="gold small" style={{ marginTop: '4px' }}>{msg}</div>}
      <div class="list" style={{ marginTop: '8px' }}>
        {sim.s.intrigue
          .filter((o) => o.faction === me)
          .map((o) => (
            <div class="bcard small">
              <span>{INTRIGUE_KINDS[o.kind].name}</span>
              <span class="muted">vs {factionDef(o.target).short}</span>
              <span class="spacer" />
              <span class="muted">
                {o.turnsLeft} season{o.turnsLeft > 1 ? 's' : ''} left
              </span>
            </div>
          ))}
      </div>
      {Object.entries(f.intelOn).filter(([, t]) => t > sim.s.turn).length > 0 && (
        <div class="small" style={{ marginTop: '6px' }}>
          Spies report on: {Object.entries(f.intelOn).filter(([, t]) => t > sim.s.turn).map(([k]) => factionDef(k).short).join(', ')}
        </div>
      )}
    </SidePanel>
  );
}

// ------------------------------------------------------------------ objectives & victory
export function ObjectivesPanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const f = sim.fac(sim.s.player);
  const v = victoryStatus(sim, f.id);
  return (
    <SidePanel app={app} title="Ambitions &amp; Victory">
      <div class="section-title">Paths to Victory</div>
      <div class="list">
        <div class="bcard" style={{ display: 'block' }}>
          <div class="serif gold">Conquest</div>
          <div class="small">
            Rule {v.conquest.need} of {sim.s.provinces.length} provinces (vassals count): {v.conquest.have} held
          </div>
          <Meter v={v.conquest.have} max={v.conquest.need} />
        </div>
        <div class="bcard" style={{ display: 'block' }}>
          <div class="serif gold">Dynastic Supremacy</div>
          <div class="small">
            Prestige {fmt(v.dynastic.prestige)} / {fmt(v.dynastic.need)}, at least double any rival (highest rival {fmt(v.dynastic.rival)}), and {v.dynastic.needBonds} great houses bound to you by alliance, vassalage or marriage ({v.dynastic.bonds} now).
          </div>
          <Meter v={v.dynastic.prestige} max={v.dynastic.need} />
        </div>
        <div class="bcard" style={{ display: 'block' }}>
          <div class="serif gold">Imperial Dominion</div>
          <div class="small">
            Hold the great capitals {v.imperial.capitals.join(', ')} ({v.imperial.heldCapitals.length}/{v.imperial.capitals.length}) and settlements on {v.imperial.needIslands} of the 5 isles ({v.imperial.islands}).
          </div>
          <Meter v={v.imperial.heldCapitals.length + v.imperial.islands} max={v.imperial.capitals.length + v.imperial.needIslands} />
        </div>
      </div>
      <div class="section-title">Ambitions of the House</div>
      <div class="list">
        {f.objectives.map((o) => (
          <div class={`bcard ${o.done ? '' : ''}`}>
            <span class={o.done ? 'good' : 'gold'}>{o.done ? '✔' : '◇'}</span>
            <span style={{ textDecoration: o.done ? 'line-through' : 'none' }}>{o.label}</span>
            <span class="spacer" />
            <span class="tiny muted">
              {[o.reward.gold ? `${o.reward.gold} gold` : '', o.reward.prestige ? `${o.reward.prestige} prestige` : '', o.reward.legitimacy ? `${o.reward.legitimacy} legitimacy` : ''].filter(Boolean).join(' · ')}
            </span>
          </div>
        ))}
      </div>
      <div class="section-title">The Great Houses</div>
      <div class="list">
        {FACTIONS.map((x) => {
          const fs = sim.fac(x.id);
          return (
            <div class="bcard small">
              <Shield faction={x.id} size={20} />
              <span class="serif">{x.short}</span>
              <span class="spacer" />
              <span>{fs.alive ? `${sim.provincesOf(x.id).length} provinces` : 'fallen'}</span>
              <span class="gold">♛ {fmt(fs.prestige)}</span>
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}

export function ChroniclePanel(props: { app: App; cs: CampaignScene }) {
  const { app, cs } = props;
  const sim = cs.sim;
  const entries = [...sim.s.chronicle].reverse();
  return (
    <SidePanel app={app} title="Chronicle of the Realm">
      <div class="list">
        {entries.map((e) => (
          <div class="small" style={{ padding: '4px 0', borderBottom: '1px solid rgba(201,164,92,0.1)' }}>
            <span class="gold serif">
              {e.turn >= 0 ? `${SEASON_NAMES[e.turn % 4]} ${sim.s.startYear + Math.floor(e.turn / 4)}` : `${sim.s.startYear + Math.floor(e.turn / 4)}`}
            </span>{' '}
            — {e.text}
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

export function HelpPanel(props: { app: App }) {
  return (
    <SidePanel app={props.app} title="How to Rule">
      <div class="small" style={{ lineHeight: 1.55 }}>
        <div class="section-title">Camera</div>
        <div>
          <span class="kbd">W A S D</span> / arrows or left-drag to pan · mouse wheel to zoom (toward the cursor) · middle-drag or <span class="kbd">Shift</span>+drag or <span class="kbd">Q</span>/<span class="kbd">E</span> to rotate · <span class="kbd">Ctrl</span>+wheel to tilt · <span class="kbd">H</span> returns to your capital · click the minimap to jump.
        </div>
        <div class="section-title">Map modes</div>
        <div>
          <span class="kbd">1</span> terrain · <span class="kbd">2</span> political · <span class="kbd">3</span> diplomatic · <span class="kbd">4</span> economic · <span class="kbd">5</span> military (threatened borders) · <span class="kbd">M</span> cycles.
        </div>
        <div class="section-title">Orders</div>
        <div>Left-click selects a settlement, army or fleet. With an army or fleet selected, right-click: the ground to move; an enemy army or fleet to attack; an enemy settlement to besiege or storm it; one of your armies to merge; your fleet (next to the shore) to embark. With a loaded fleet selected, right-click the shore to land the army. The gold area shows this season's reach; grey path segments continue next season.</div>
        <div class="section-title">Economy</div>
        <div>Gold comes from taxes, trade and buildings; armies and fleets cost upkeep every season. Food is harvested mostly in summer and autumn. Timber, stone and iron are needed for buildings, ships and armoured troops. Grow towns into cities for more building slots.</div>
        <div class="section-title">Dynasty &amp; Diplomacy</div>
        <div>Rulers age and die. Heirs follow your succession law; a disputed succession breeds pretenders. Marry your children into other ruling houses to gain allies and claims — if their line fails, your blood may inherit their realm outright. Claims give you a just cause for war; wars without cause cost reputation and legitimacy.</div>
        <div class="section-title">Battles</div>
        <div>Before a battle choose to fight or auto-resolve. In battle: left-click / drag-box to select units, right-click to move or attack, right-drag to set a line and facing. Formation buttons change unit order. Flanking, charges, high ground, fatigue and morale decide battles. <span class="kbd">Space</span> pauses; speed buttons change time.</div>
        <div class="section-title">Sieges</div>
        <div>Walled settlements must be besieged. The defenders starve over time; after a season your army has ladders and rams and may assault. Mangonels and trebuchets batter walls from afar.</div>
      </div>
    </SidePanel>
  );
}
