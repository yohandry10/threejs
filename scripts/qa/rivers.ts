import { generateWorld } from '../../src/sim/world/worldGen';
import { heightAt } from '../../src/sim/world/geo';
const g = generateWorld();
for (const r of g.rivers) {
  const n = r.widths.length;
  const m = r.mouth ?? -1;
  const hs: string[] = [];
  for (let i = Math.max(0, m - 6); i < n; i += 2) hs.push(`${i}:${heightAt(g, r.pts[i * 2], r.pts[i * 2 + 1]).toFixed(1)}`);
  console.log(r.name, 'n', n, 'mouth', m, 'end', r.pts[(n - 1) * 2].toFixed(0), r.pts[(n - 1) * 2 + 1].toFixed(0), hs.join(' '));
}
