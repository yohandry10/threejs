(globalThis as any).__SHIP_NAN_CHECK = true;
import * as mod from "../../src/render/ships/shipBuilder";
for (const type of ['flagship', 'carrack', 'cog', 'hulk', 'galley']) {
  const b = mod.shipGeometriesForTest(type, 'aldmere');
  const check = (name: string, g: any) => {
    const p = g.getAttribute('position').array;
    let bad = 0;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad++;
    const n = g.getAttribute('normal')?.array;
    let badN = 0;
    if (n) for (let i = 0; i < n.length; i++) if (!Number.isFinite(n[i])) badN++;
    if (bad || badN) console.log(type, name, 'NaN pos', bad, 'NaN normals', badN, 'of', p.length);
  };
  b.levels.forEach((lvl: any, li: number) => lvl.forEach(([k, g]: any) => check(`L${li}:${k}`, g)));
  b.sails.forEach((s: any, i: number) => check('sail' + i, s.geo));
  b.pennants.forEach((s: any, i: number) => check('pennant' + i, s.geo));
  b.lines.forEach((s: any, i: number) => check('lines' + i, s));
  let tris = 0;
  for (const [, g] of b.levels[0]) tris += g.getAttribute('position').count / 3;
  let trisMid = 0; for (const [, g] of b.levels[1]) trisMid += g.getAttribute('position').count / 3;
  let trisLo = 0; for (const [, g] of b.levels[2]) trisLo += g.getAttribute('position').count / 3;
  console.log(type, 'tris hi', tris, 'mid', trisMid, 'lo', trisLo);
}
