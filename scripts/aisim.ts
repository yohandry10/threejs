import { generateWorld } from '../src/sim/world/worldGen';
import { newCampaign } from '../src/sim/setup';
import { endTurn } from '../src/sim/turn';
import { autoResolve, applyBattleOutcome } from '../src/sim/battles';
import { factionDef } from '../src/data/factions';
import { serialize, migrate } from '../src/sim/save';

const turns = Number(process.argv[2] ?? 40);
const geo = generateWorld();
const t0 = performance.now();
const sim = newCampaign(geo, 'aldmere', 12345);
console.log('setup ms', (performance.now() - t0).toFixed(0), 'chars', Object.keys(sim.s.characters).length, 'armies', Object.keys(sim.s.armies).length, 'fleets', Object.keys(sim.s.fleets).length);
let events: Record<string, number> = {};
sim.bus.on('*', (e) => (events[e.type] = (events[e.type] ?? 0) + 1));
const hooks = {
  yieldFrame: async () => {},
  playerBattle: async (setup: any) => {
    const o = autoResolve(sim, setup);
    const r = applyBattleOutcome(sim, setup, o);
    if (r.captureDecision) {
      const { captureWith } = await import('../src/sim/commands');
      captureWith(sim, sim.s.armies[r.captureDecision.army], r.captureDecision.province, 'occupy');
    }
  },
};
// player acts as a passive AI: accept nothing; resolve decisions randomly
const { resolveDecision } = await import('../src/sim/events');
for (let t = 0; t < turns; t++) {
  const ts = performance.now();
  for (const d of [...sim.s.decisions]) resolveDecision(sim, d.id, d.options[d.options.length - 1].id);
  await endTurn(sim, hooks);
  const dt = performance.now() - ts;
  if (t % 5 === 4 || t === turns - 1) {
    const rows = Object.values(sim.s.factions).filter((f) => f.alive).map((f) => `${factionDef(f.id).short.padEnd(9)} prov ${String(sim.provincesOf(f.id).length).padStart(2)} gold ${String(Math.round(f.treasury)).padStart(6)} net ${String(f.lastIncome.net).padStart(5)} food ${String(Math.round(f.food)).padStart(5)} armies ${sim.armiesOf(f.id).length} troops ${sim.armiesOf(f.id).reduce((s, a) => s + a.units.reduce((q, u) => q + u.troops, 0), 0)} fleets ${sim.fleetsOf(f.id).length} pres ${Math.round(f.prestige)} leg ${Math.round(f.legitimacy)}`);
    console.log(`--- turn ${sim.s.turn} (${dt.toFixed(0)}ms) wars ${sim.s.diplomacy.wars.map((w) => w.name + ' ' + Math.round(w.score)).join('; ')}`);
    console.log(rows.join('\n'));
  }
}
console.log('events', events);
console.log('stats', sim.s.stats, 'treaties', sim.s.diplomacy.treaties.map((t) => `${t.type}:${t.a}-${t.b}`).join(' '));
console.log(sim.s.chronicle.filter((c) => c.turn >= 0).slice(-40).map((c) => `[${c.turn}] ${c.text}`).join('\n'));
const blob = serialize(sim, 'test');
const json = JSON.stringify(blob);
console.log('save size KB', (json.length / 1024).toFixed(0));
migrate(JSON.parse(json));
