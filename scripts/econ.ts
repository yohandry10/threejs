import { generateWorld } from '../src/sim/world/worldGen';
import { newCampaign } from '../src/sim/setup';
import { factionEconomy, provinceYield } from '../src/sim/economy';
const geo = generateWorld();
const sim = newCampaign(geo, 'aldmere', 12345);
for (const f of Object.values(sim.s.factions)) {
  if (!f.alive) continue;
  const e = factionEconomy(sim, f.id);
  console.log(f.id.padEnd(9), JSON.stringify(e));
}
for (const p of sim.provincesOf('aldmere')) console.log(p.settlement.name, p.population, JSON.stringify(provinceYield(sim, p)));
