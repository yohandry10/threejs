import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { App } from '../app/app';
import type { CampaignScene } from '../scenes/campaignScene';
import { factionDef } from '../data/factions';
import { unitDef, shipDef } from '../data/units';
import { buildingDef, TIERS } from '../data/buildings';
import { Icons, Meter, Portrait, Shield, Tip, TipRows, UnitIcon, fmt, fmtSigned } from './common';
import { buildOptions, cancelConstruction, cancelRecruit, orderBreakdown, provinceYield, recruit, recruitOptions, startConstruction } from '../sim/economy';
import { age, fullName, skillOf } from '../sim/characters';
import { armyPower, assignGeneral, availableCommanders, fleetCapacity, troopCount } from '../sim/military';
import { disbandArmy, disbandUnit, setArmyStance, splitArmy } from '../sim/commands';
import { canAssault, siegeSupplyTurns } from '../sim/conquest';
import { atWar, opinion, relationLabel } from '../sim/diplomacy';
import { isVisible } from '../sim/fog';
import { REGION_NAMES } from '../data/worldLayout';

export function SelectionPanel(props: { app: App; cs: CampaignScene }) {
  const { cs } = props;
  const sel = cs.selection;
  if (!sel) return null;
  if (sel.kind === 'settlement') return <SettlementPanel {...props} pid={sel.id} />;
  if (sel.kind === 'army') {
    const a = cs.sim.s.armies[sel.id];
    if (!a) return null;
    return <ArmyPanel {...props} id={sel.id} />;
  }
  const f = cs.sim.s.fleets[sel.id];
  if (!f) return null;
  return <FleetPanel {...props} id={sel.id} />;
}

function Head(props: { faction: string; title: string; sub: string; onClose: () => void; right?: h.JSX.Element }) {
  return (
    <div class="panel-head">
      <Shield faction={props.faction} size={30} />
      <div>
        <h2>{props.title}</h2>
        <div class="small muted">{props.sub}</div>
      </div>
      <span class="spacer" />
      {props.right}
      <button class="close-x" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}

export function SettlementPanel(props: { app: App; cs: CampaignScene; pid: number }) {
  const { app, cs, pid } = props;
  const sim = cs.sim;
  const p = sim.s.provinces[pid];
  const pg = sim.geo.provinces[pid];
  const own = p.owner === sim.s.player;
  const [tab, setTab] = useState(0);
  const st = p.settlement;
  const y = provinceYield(sim, p);
  const order = orderBreakdown(sim, p);
  const orderSum = order.reduce((s, o) => s + o.value, 0);
  const visible = own || isVisible(sim, pg.x, pg.z);
  const tierName = TIERS[st.tier].name;
  const kind = st.fortress ? 'Fortress' : sim.fac(p.owner)?.capital === pid ? `Capital ${tierName}` : tierName;
  const tabs = own ? ['Overview', 'Buildings', 'Recruit', 'Garrison'] : ['Overview', 'Garrison'];
  const t = Math.min(tab, tabs.length - 1);
  const flash = (err: string | null, ok: string) => cs.showToast(err ?? ok, err ? 'warn' : 'info');
  return (
    <div class="panel selpanel pe">
      <Head faction={p.owner} title={st.name} sub={`${kind}${st.isPort ? ' · Port' : ''} · ${REGION_NAMES[pg.region] ?? ''} · ${factionDef(p.owner).realm}`} onClose={() => cs.select(null)} />
      <div class="tabs">
        {tabs.map((n, i) => (
          <div class={`tab ${t === i ? 'on' : ''}`} onClick={() => setTab(i)}>
            {n}
          </div>
        ))}
      </div>
      <div class="panel-body scroll">
        {tabs[t] === 'Overview' && (
          <div class="grid3">
            <div class="stat">
              <span class="k">Population</span>
              <span class="v">{fmt(p.population)}</span>
              <span class="tiny faint">cap {fmt(TIERS[st.tier].popCap)}</span>
            </div>
            <Tip tip={<TipRows title="Public Order" rows={order.map((o) => [o.label, o.value, o.value >= 0 ? 'good' : 'bad'])} foot="Below -25 for several seasons, the people may rise in revolt." />}>
              <div class="stat">
                <span class="k">Public Order</span>
                <span class={`v ${orderSum < -20 ? 'bad' : orderSum < 5 ? 'warnc' : 'good'}`}>{fmtSigned(orderSum)}</span>
                <Meter v={orderSum + 100} max={200} color={orderSum < 0 ? 'var(--danger)' : 'var(--good)'} />
              </div>
            </Tip>
            <Tip tip={<TipRows title="Income" rows={[['Taxes', y.tax, 'good'], ['Buildings & markets', y.buildingGold, 'good']]} foot={p.blockaded ? 'Blockaded: income reduced.' : p.siege ? 'Under siege: income collapsed.' : undefined} />}>
              <div class="stat">
                <span class="k">Income</span>
                <span class="v gold">{visible ? fmtSigned(y.tax + y.buildingGold) : '?'}</span>
              </div>
            </Tip>
            <Tip tip={<TipRows title="Food" rows={[['Harvest & fishing', y.food, 'good'], ['Eaten', -y.foodUse, 'bad']]} />}>
              <div class="stat">
                <span class="k">Food</span>
                <span class={`v ${y.food - y.foodUse >= 0 ? 'good' : 'bad'}`}>{visible ? fmtSigned(y.food - y.foodUse) : '?'}</span>
              </div>
            </Tip>
            <div class="stat">
              <span class="k">Development</span>
              <span class="v">{p.development.toFixed(1)} / 10</span>
            </div>
            <div class="stat">
              <span class="k">Defences</span>
              <span class="v">{st.walls === 0 ? 'None' : ['', 'Palisade', 'Stone walls', 'Great walls'][st.walls]}</span>
              {st.walls > 0 && <span class="tiny faint">gate {fmt(st.gateHp)} · holds {siegeSupplyTurns(sim, p)} seasons</span>}
            </div>
            <div class="stat">
              <span class="k">Resources</span>
              <span class="v small">{pg.resources.join(', ')}</span>
            </div>
            <div class="stat">
              <span class="k">Terrain</span>
              <span class="v small">{pg.terrain}</span>
            </div>
            <div class="stat">
              <span class="k">Status</span>
              <span class="v small">{p.siege ? <span class="bad">Besieged ({p.siege.turns} seasons)</span> : p.blockaded ? <span class="warnc">Blockaded</span> : p.unrest > 0 ? <span class="warnc">Unrest</span> : 'Peaceful'}</span>
            </div>
            {!own && (
              <div class="stat" style={{ gridColumn: 'span 3' }}>
                <span class="k">Relations</span>
                <span class="v small">
                  {factionDef(p.owner).house}: {relationLabel(opinion(sim, p.owner, sim.s.player))} ({fmtSigned(opinion(sim, p.owner, sim.s.player))}){atWar(sim, p.owner, sim.s.player) ? <span class="bad"> — at war</span> : null}
                  {' · '}
                  <span class="linkish" onClick={() => ((app.ui.diploTarget = p.owner), app.ui.openPanel('diplomacy'))}>
                    open diplomacy
                  </span>
                </span>
              </div>
            )}
            {own && p.previousOwners.length > 0 && <div class="stat tiny muted" style={{ gridColumn: 'span 3' }}>Formerly held by {p.previousOwners.map((o) => factionDef(o.faction).short).join(', ')}</div>}
          </div>
        )}
        {tabs[t] === 'Buildings' && own && (
          <div class="grid2">
            <div>
              <div class="section-title">
                Buildings ({st.buildings.length}/{TIERS[st.tier].slots} slots)
              </div>
              <div class="list">
                {st.buildings.map((b) => {
                  const def = buildingDef(b.id);
                  const lv = def.levels[b.level - 1];
                  return (
                    <Tip tip={<div><div class="tt-title">{lv.name}</div>{def.desc}{b.damaged && <div class="bad">Damaged — repairing</div>}</div>}>
                      <div class="bcard">
                        <span class="gold serif">{lv.name}</span>
                        <span class="spacer" />
                        <span class="tiny muted">{def.category}</span>
                        {b.damaged && <span class="bad tiny">damaged</span>}
                      </div>
                    </Tip>
                  );
                })}
              </div>
              {st.construction.length > 0 && <div class="section-title">Under Construction</div>}
              <div class="list">
                {st.construction.map((c, i) => (
                  <div class="bcard">
                    <span>{c.building === '__tier' ? `Growing into a ${TIERS[c.level].name}` : buildingDef(c.building).levels[c.level - 1].name}</span>
                    <span class="spacer" />
                    <span class="tiny muted">
                      {c.turnsLeft} season{c.turnsLeft > 1 ? 's' : ''}
                    </span>
                    <button class="btn small" onClick={() => (cancelConstruction(sim, pid, i), app.notify())}>
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div class="section-title">Construct</div>
              <div class="list">
                {buildOptions(sim, pid).map((o) => (
                  <Tip tip={<div><div class="tt-title">{o.name}</div><div>{o.desc}</div>{o.blocked && <div class="bad" style={{ marginTop: '4px' }}>{o.blocked}</div>}</div>}>
                    <div
                      class={`bcard ${o.blocked ? 'dis' : 'can'}`}
                      onClick={() => {
                        if (o.blocked) return;
                        flash(startConstruction(sim, pid, o.id), `Construction of ${o.name} begins.`);
                        app.audio.ui('coin');
                        app.notify();
                      }}
                    >
                      <span class={o.upgrade ? 'gold' : ''}>{o.upgrade ? '▲ ' : ''}{o.name}</span>
                      <span class="spacer" />
                      <span class="cost">
                        {fmt(o.cost)}g{o.timber ? ` · ${o.timber}w` : ''}{o.stone ? ` · ${o.stone}s` : ''}{o.iron ? ` · ${o.iron}i` : ''} · {o.turns}t
                      </span>
                    </div>
                  </Tip>
                ))}
              </div>
            </div>
          </div>
        )}
        {tabs[t] === 'Recruit' && own && (
          <div class="grid2">
            <div>
              <div class="section-title">Muster Troops &amp; Ships</div>
              <div class="list">
                {recruitOptions(sim, pid).map((o) => {
                  const d = o.ship ? null : unitDef(o.type);
                  const sd = o.ship ? shipDef(o.type) : null;
                  return (
                    <Tip
                      tip={
                        <div>
                          <div class="tt-title">{o.name}</div>
                          <div>{d?.desc ?? sd?.desc}</div>
                          {d && (
                            <div class="small muted" style={{ marginTop: '4px' }}>
                              Men {d.troops} · Attack {d.attack} · Defence {d.defense} · Armour {d.armor} · Charge {d.charge}
                              {d.range ? ` · Range ${d.range}` : ''} · Upkeep {d.upkeep}g
                            </div>
                          )}
                          {sd && (
                            <div class="small muted" style={{ marginTop: '4px' }}>
                              Hull {sd.hull} · Crew {sd.crew} · Carries {sd.capacity} men · Upkeep {sd.upkeep}g
                            </div>
                          )}
                          {o.blocked && <div class="bad">{o.blocked}</div>}
                        </div>
                      }
                    >
                      <div
                        class={`bcard ${o.blocked ? 'dis' : 'can'}`}
                        onClick={() => {
                          if (o.blocked) return;
                          flash(recruit(sim, pid, o.type), `${o.name} will be ready in ${o.turns} season${o.turns > 1 ? 's' : ''}.`);
                          app.audio.ui('coin');
                          app.notify();
                        }}
                      >
                        {o.ship ? <Icons.ship size={20} /> : <UnitIcon cat={d!.category} size={20} />}
                        <span>{o.name}</span>
                        <span class="spacer" />
                        <span class="cost">
                          {fmt(o.cost)}g{o.iron ? ` · ${o.iron}i` : ''}
                          {o.timber ? ` · ${o.timber}w` : ''} · {o.turns}t
                        </span>
                      </div>
                    </Tip>
                  );
                })}
                {recruitOptions(sim, pid).length === 0 && <div class="muted small">Build a barracks, archery range, stables or harbour to recruit here.</div>}
              </div>
            </div>
            <div>
              <div class="section-title">In Training</div>
              <div class="list">
                {st.recruitment.map((r, i) => (
                  <div class="bcard">
                    <span>{r.ship ? shipDef(r.unitType).name : unitDef(r.unitType).name}</span>
                    <span class="spacer" />
                    <span class="tiny muted">
                      {r.turnsLeft} season{r.turnsLeft > 1 ? 's' : ''}
                    </span>
                    <button class="btn small" onClick={() => (cancelRecruit(sim, pid, i), app.notify())}>
                      Cancel
                    </button>
                  </div>
                ))}
                {!st.recruitment.length && <div class="muted small">Nothing in training. New troops join an army standing in or near the town, or form a new one.</div>}
              </div>
            </div>
          </div>
        )}
        {tabs[t] === 'Garrison' && (
          <div>
            <div class="small muted" style={{ marginBottom: '6px' }}>
              The garrison is raised from the townsfolk and grows with walls and military buildings. It defends the settlement in sieges and assaults.
            </div>
            {visible ? (
              <div class="unit-cards">
                {st.garrison.map((u) => (
                  <UnitCard unit={u} />
                ))}
              </div>
            ) : (
              <div class="muted">The strength of the garrison is unknown. Gather intelligence or send scouts.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UnitCard(props: { unit: { type: string; troops: number; maxTroops: number; xp: number; uid: number }; sel?: boolean; onClick?: () => void }) {
  const u = props.unit;
  const d = unitDef(u.type);
  const chev = Math.floor(u.xp);
  return (
    <Tip
      tip={
        <div>
          <div class="tt-title">{d.name}</div>
          <div class="small">{d.desc}</div>
          <div class="small muted" style={{ marginTop: '4px' }}>
            {u.troops}/{u.maxTroops} men · Attack {d.attack} · Defence {d.defense} · Armour {d.armor} · Charge {d.charge}
            {d.range ? ` · Range ${d.range}` : ''}
            {chev ? ` · Veterancy ${chev}` : ''}
          </div>
        </div>
      }
    >
      <div class={`ucard ${props.sel ? 'sel' : ''}`} onClick={props.onClick}>
        {chev > 0 && <span class="chev">{'▲'.repeat(Math.min(3, Math.ceil(chev / 3)))}</span>}
        <div class="ic">
          <UnitIcon cat={d.category} size={28} />
        </div>
        <div class="uname">{d.name}</div>
        <div class="tiny muted">{u.troops}</div>
        <div class="bar">
          <div style={{ width: `${(u.troops / u.maxTroops) * 100}%` }} />
        </div>
      </div>
    </Tip>
  );
}

export function ArmyPanel(props: { app: App; cs: CampaignScene; id: number }) {
  const { app, cs, id } = props;
  const sim = cs.sim;
  const a = sim.s.armies[id];
  const own = a.faction === sim.s.player;
  const gen = sim.char(a.general);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const known = own || (sim.fac(sim.s.player).intelOn[a.faction] ?? -1) > sim.s.turn || cs.selectedArmy?.id === id;
  const toggle = (uid: number) => {
    const n = new Set(sel);
    if (n.has(uid)) n.delete(uid);
    else n.add(uid);
    setSel(n);
  };
  const siegeP = a.siegeOf !== undefined ? sim.s.provinces[a.siegeOf] : undefined;
  const cmds = own ? availableCommanders(sim, a.faction) : [];
  return (
    <div class="panel selpanel pe">
      <Head
        faction={a.faction}
        title={a.name}
        sub={`${factionDef(a.faction).house}${a.isRebel ? ' · Rebels' : ''} · ${fmt(troopCount(a.units))} men · ${a.units.length} units`}
        onClose={() => cs.select(null)}
        right={
          own ? (
            <div class="row">
              {siegeP && (
                <button class="btn primary" disabled={!canAssault(sim, a, siegeP)} onClick={() => cs.assault()} title="Storm the walls">
                  Assault {siegeP.settlement.name}
                </button>
              )}
              <Tip tip="Forced march: +40% movement this season, but tires the troops and drains supply.">
                <button class={`btn small ${a.stance === 'forced' ? 'active' : ''}`} disabled={a.stance === 'forced' || a.embarked !== undefined} onClick={() => (setArmyStance(sim, a, 'forced'), cs.updateRange(), app.notify())}>
                  Forced March
                </button>
              </Tip>
            </div>
          ) : undefined
        }
      />
      <div class="panel-body scroll">
        <div class="row" style={{ alignItems: 'flex-start', gap: '14px' }}>
          <div class="charcard" style={{ minWidth: '230px' }}>
            {gen ? (
              <Portrait c={gen} age={age(sim, gen)} w={58} onClick={() => ((app.ui.charFocus = gen.id), app.ui.openPanel('dynasty'))} />
            ) : (
              <div class="portrait" style={{ width: '58px', height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icons.sword size={26} />
              </div>
            )}
            <div class="col" style={{ gap: '2px' }}>
              <div class="serif gold">{gen ? fullName(gen) : 'Captain (no general)'}</div>
              {gen && (
                <div class="tiny muted">
                  Command {skillOf(gen, 'command')} · Age {age(sim, gen)} · Loyalty {Math.round(gen.loyalty)}
                </div>
              )}
              {gen && (
                <div>
                  {gen.traits.map((t) => (
                    <span class="trait">{t}</span>
                  ))}
                </div>
              )}
              {own && cmds.length > 0 && (
                <select
                  class="pe"
                  style={{ background: '#1b1916', color: 'var(--ink)', border: '1px solid var(--line)', marginTop: '3px', maxWidth: '200px' }}
                  value=""
                  onChange={(e) => {
                    const v = Number((e.target as HTMLSelectElement).value);
                    if (v) {
                      assignGeneral(sim, a, v);
                      app.notify();
                    }
                  }}
                >
                  <option value="">{gen ? 'Replace general…' : 'Appoint a general…'}</option>
                  {cmds.map((c) => (
                    <option value={String(c.id)}>
                      {fullName(c)} (Cmd {skillOf(c, 'command')})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div class="grid3" style={{ flex: 1 }}>
            <Tip tip={<TipRows title="Morale" rows={[['Army morale', Math.round(a.morale)]]} foot="Raised by victories, supply and a good general. Low morale armies fight poorly." />}>
              <div class="stat">
                <span class="k">Morale</span>
                <span class="v">{Math.round(a.morale)}</span>
                <Meter v={a.morale} color="var(--gold)" />
              </div>
            </Tip>
            <Tip tip={<TipRows title="Supply" rows={[['Supply', Math.round(a.supply)]]} foot="Refills in friendly lands. Falls in enemy territory, faster in winter. Below 30, men desert and sicken." />}>
              <div class="stat">
                <span class="k">Supply</span>
                <span class={`v ${a.supply < 30 ? 'bad' : ''}`}>{Math.round(a.supply)}</span>
                <Meter v={a.supply} color={a.supply < 30 ? 'var(--danger)' : 'var(--good)'} />
              </div>
            </Tip>
            <div class="stat">
              <span class="k">Movement</span>
              <span class="v">
                {Math.round(a.movePoints)} / {a.maxMovePoints}
              </span>
              <Meter v={a.movePoints} max={a.maxMovePoints} color="var(--blue)" />
            </div>
            <div class="stat">
              <span class="k">Strength</span>
              <span class="v">{known ? fmt(armyPower(sim, a)) : '?'}</span>
            </div>
            <div class="stat">
              <span class="k">Status</span>
              <span class="v small">{a.embarked !== undefined ? 'At sea' : siegeP ? `Besieging ${siegeP.settlement.name}` : a.path.length ? 'On the march' : a.stance === 'forced' ? 'Forced march' : 'Encamped'}</span>
            </div>
            {own && (
              <div class="stat">
                <span class="k">Orders</span>
                <span class="v tiny muted">Right-click to move or attack. Right-click one of your ships to embark.</span>
              </div>
            )}
          </div>
        </div>
        <div class="section-title">Units {own && sel.size > 0 && <span class="small muted">({sel.size} selected)</span>}</div>
        {known ? (
          <div class="unit-cards">
            {a.units.map((u) => (
              <UnitCard unit={u} sel={sel.has(u.uid)} onClick={own ? () => toggle(u.uid) : undefined} />
            ))}
          </div>
        ) : (
          <div class="muted">
            Your scouts cannot make out the composition of this host (roughly {Math.round(troopCount(a.units) / 250) * 250 || 'a few hundred'} men). Move an army close or gather intelligence.
          </div>
        )}
        {own && (
          <div class="row" style={{ marginTop: '8px' }}>
            <button
              class="btn small"
              disabled={!sel.size || a.embarked !== undefined}
              onClick={() => {
                const r = splitArmy(sim, a, [...sel]);
                if (typeof r === 'string') cs.showToast(r, 'warn');
                else {
                  setSel(new Set());
                  cs.select({ kind: 'army', id: r.id });
                }
              }}
            >
              Detach Selected
            </button>
            <button
              class="btn small danger"
              disabled={!sel.size}
              onClick={() => {
                for (const uid of sel) disbandUnit(sim, a, uid);
                setSel(new Set());
                if (!sim.s.armies[id]) cs.select(null);
                app.notify();
              }}
            >
              Disband Selected
            </button>
            <span class="spacer" />
            <button
              class="btn small danger"
              onClick={() =>
                (app.ui.confirm = {
                  text: `Disband ${a.name}? Its men return to the fields.`,
                  onYes: () => {
                    disbandArmy(sim, a);
                    cs.select(null);
                  },
                }) && app.notify()
              }
            >
              Disband Army
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FleetPanel(props: { app: App; cs: CampaignScene; id: number }) {
  const { app, cs, id } = props;
  const sim = cs.sim;
  const f = sim.s.fleets[id];
  const own = f.faction === sim.s.player;
  const adm = sim.char(f.admiral);
  const cap = fleetCapacity(f);
  const carried = f.carrying.reduce((s, aid) => s + (sim.s.armies[aid] ? troopCount(sim.s.armies[aid].units) : 0), 0);
  return (
    <div class="panel selpanel pe">
      <Head faction={f.faction} title={f.name} sub={`${factionDef(f.faction).house} · ${f.ships.length} ships${f.inPort !== undefined ? ` · in port at ${sim.provName(f.inPort)}` : ''}`} onClose={() => cs.select(null)} />
      <div class="panel-body scroll">
        <div class="grid3">
          <div class="stat">
            <span class="k">Admiral</span>
            <span class="v small">{adm ? `${fullName(adm)} (Cmd ${skillOf(adm, 'command')})` : 'None'}</span>
          </div>
          <div class="stat">
            <span class="k">Movement</span>
            <span class="v">
              {Math.round(f.movePoints)} / {f.maxMovePoints}
            </span>
            <Meter v={f.movePoints} max={f.maxMovePoints} color="var(--blue)" />
          </div>
          <Tip tip="Transport capacity: how many soldiers the fleet can carry. Armies must embark to cross the sea.">
            <div class="stat">
              <span class="k">Transport</span>
              <span class="v">
                {fmt(carried)} / {fmt(cap)} men
              </span>
            </div>
          </Tip>
          <div class="stat">
            <span class="k">Orders</span>
            <span class="v small">{f.order === 'blockade' && f.orderTarget !== undefined ? `Blockading ${sim.provName(f.orderTarget)}` : f.carrying.length ? 'Carrying an army' : f.order}</span>
          </div>
          {f.carrying.length > 0 && (
            <div class="stat" style={{ gridColumn: 'span 2' }}>
              <span class="k">Aboard</span>
              <span class="v small">
                {f.carrying.map((aid) => sim.s.armies[aid]?.name).join(', ')}
                {own && <span class="muted"> — right-click the shore to land them.</span>}
              </span>
            </div>
          )}
        </div>
        <div class="section-title">Ships</div>
        <div class="list">
          {f.ships.map((s) => {
            const d = shipDef(s.type);
            return (
              <div class="bcard">
                <Icons.ship size={18} />
                <span class="serif">{s.name}</span>
                <span class="tiny muted">{d.name}</span>
                <span class="spacer" />
                <span class="tiny" style={{ width: '120px' }}>
                  Hull <Meter v={s.hull} max={s.maxHull} color={s.hull < s.maxHull * 0.4 ? 'var(--danger)' : 'var(--good)'} />
                </span>
                <span class="tiny" style={{ width: '100px' }}>
                  Crew {s.crew}/{s.maxCrew}
                </span>
                {own && (
                  <button
                    class="btn small danger"
                    onClick={() => {
                      f.ships = f.ships.filter((x) => x !== s);
                      if (!f.ships.length) {
                        import('../sim/military').then((m) => {
                          m.destroyFleet(sim, f, 'disbanded');
                          cs.select(null);
                        });
                      }
                      app.notify();
                    }}
                  >
                    Scuttle
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {own && <div class="small muted" style={{ marginTop: '8px' }}>Right-click the sea to sail, an enemy fleet to attack, or an enemy port to blockade it. Fleets repair in friendly harbours.</div>}
      </div>
    </div>
  );
}
