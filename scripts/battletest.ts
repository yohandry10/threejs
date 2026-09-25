import { generateWorld } from '../src/sim/world/worldGen';
import { newCampaign } from '../src/sim/setup';
import { makeFieldBattle, makeSettlementBattle, autoResolve } from '../src/sim/battles';
import { deployBattle, simulateHeadless, outcomeFromBattle } from '../src/battle/deploy';

const geo = generateWorld();
const sim = newCampaign(geo, 'aldmere', 12345);
const armies = Object.values(sim.s.armies);
const a = armies.find((x) => x.faction === 'aldmere')!;
const b = armies.find((x) => x.faction !== 'aldmere' && !x.isRebel)!;
const kind = process.argv[2] ?? 'field';
let setup;
if (kind === 'siege') {
  const p = Object.values(sim.s.provinces).find((p) => p.owner !== 'aldmere')!;
  setup = makeSettlementBattle(sim, a, p.id);
  setup.walls = 2; setup.towers = 2; if (process.argv[4] === 'rams') (p as any).siege = { equipment: 2 };
} else { setup = makeFieldBattle(sim, a, b); setup.kind = 'field'; setup.defender.garrisonOf = undefined; setup.river = process.argv[4] === 'river'; }
setup.terrain = (process.argv[3] as any) ?? setup.terrain;
console.log('setup', setup.kind, setup.terrain, 'A', a.units.map(u=>u.type+':'+u.troops).join(','), '\nD', setup.kind==='siege'? 'garrison' : b.units.map(u=>u.type+':'+u.troops).join(','));
const t0 = performance.now();
const dep = deployBattle(sim, setup);
console.log('deploy ms', (performance.now()-t0).toFixed(0), 'soldiers', dep.bsim.soldiers.length, 'units', dep.bsim.units.length, 'menPer', dep.bsim.menPer);
const t1 = performance.now();
const bs = simulateHeadless(dep, 1800, 0.05);
const ms = performance.now() - t1;
console.log('sim ms', ms.toFixed(0), 'battle time', bs.time.toFixed(0), 's', 'ms/step', (ms / (bs.time / 0.05)).toFixed(2));
console.log('winner', bs.winner, bs.endReason, 'capture', bs.capture.toFixed(2));
for (const u of bs.units) console.log(u.side, u.def.id.padEnd(16), u.state.padEnd(9), 'alive', String(u.alive).padStart(4), '/', u.startCount, 'morale', u.morale.toFixed(0), 'fat', u.fatigue.toFixed(0), 'kills', u.killCount, 'ammo', u.ammo.toFixed(0));
const o = outcomeFromBattle(dep, setup);
console.log('outcome', o.winner, 'killsA', o.killsA, 'killsD', o.killsD, 'gen killed', o.generalsKilled, 'wounded', o.generalsWounded);
const ar = autoResolve(sim, setup);
console.log('autoresolve would be', ar.winner, ar.killsA, ar.killsD);
if (bs.field.fort) console.log('gate', bs.field.fort.gate.hp.toFixed(0), bs.field.fort.gate.open, 'breaches', bs.field.fort.segs.filter(s=>s.breached).length, 'towers', bs.field.fort.towers.filter(t=>t.alive).length);
