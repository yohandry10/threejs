import { generateWorld } from '../src/sim/world/worldGen';
const g = generateWorld();
const row = Math.round(0.6 * g.hmH);
const out: string[] = [];
for (let x = 60; x < 200; x += 2) out.push(g.height[row * g.hmW + x].toFixed(1));
console.log(out.join(' '));
