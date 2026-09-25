import type { Sim } from '../sim/context';
import { sideUnits, type BattleOutcome, type BattleSetup } from '../sim/battles';
import { unitDef } from '../data/units';
import { fullName } from '../sim/characters';
import { BattleField, PLAY } from './field';
import { BattleSim, type BUnit, type Side, type UnitSpawn } from './sim';
import { BattleAI } from './ai';
import { clamp } from '../core/math';

export interface Deployment {
  bsim: BattleSim;
  field: BattleField;
  ais: BattleAI[];
  playerSide: Side | null;
  generals: Map<number, number>; // battle unit id -> character id
  zone: (side: Side, x: number, z: number) => boolean;
  startStrength: [number, number];
}

type Role = 'inf' | 'ranged' | 'cav' | 'general' | 'siege';
const roleOf = (type: string): Role => {
  const d = unitDef(type);
  if (d.category === 'general') return 'general';
  if (d.category === 'siege') return 'siege';
  if (d.visual.mounted) return 'cav';
  if (d.range) return 'ranged';
  return 'inf';
};

/** Build the tactical battle from a campaign battle setup. */
export function deployBattle(sim: Sim, setup: BattleSetup, figureBudget = 3600): Deployment {
  const field = new BattleField(setup);
  const siege = setup.kind === 'siege';
  const bsim = new BattleSim(field, setup.seed, siege, setup.weather);
  const player = sim.s.player;
  const playerSide: Side | null = setup.attacker.faction === player ? 0 : setup.defender.faction === player ? 1 : null;
  const generals = new Map<number, number>();
  const spawns: [UnitSpawn[], UnitSpawn[]] = [[], []];
  const genOf = new Map<UnitSpawn, number>();
  let total = 0;
  (['attacker', 'defender'] as const).forEach((key, si) => {
    const side = setup[key];
    for (const { unit, army, faction } of sideUnits(sim, side)) {
      if (unit.troops <= 0) continue;
      const g = army ? sim.char(army.general) : undefined;
      const sp: UnitSpawn = {
        side: si as Side,
        faction,
        type: unit.type,
        uid: unit.uid,
        armyId: army ? army.id : -1,
        troops: unit.troops,
        xp: unit.xp,
        ai: faction !== player,
        generalName: unit.type === 'bodyguard' && g ? fullName(g) : undefined,
      };
      if (unit.type === 'bodyguard' && g) genOf.set(sp, g.id);
      spawns[si].push(sp);
      total += unit.troops;
    }
  });
  // siege works built during the siege become rams for the assault
  if (siege && setup.province >= 0) {
    const works = sim.s.provinces[setup.province].siege?.equipment ?? 0;
    const hasRam = spawns[0].some((s) => s.type === 'ram');
    if (!hasRam && works > 0) {
      for (let k = 0; k < Math.min(2, Math.ceil(works)); k++) {
        spawns[0].push({ side: 0, faction: setup.attacker.faction, type: 'ram', uid: -1 - k, armyId: -1, troops: 16, xp: 0, ai: setup.attacker.faction !== player });
        total += 16;
      }
    }
  }
  bsim.menPer = BattleSim.menPerFigure(total, figureBudget);

  const fort = field.fort;
  const place = (si: Side, list: UnitSpawn[]) => {
    const fac = si === 0 ? Math.PI : 0;
    const baseZ = siege ? (si === 0 ? field.wallZ(0) + 250 : field.wallZ(0) - 40) : si === 0 ? 230 : -230;
    const fwdZ = Math.cos(fac);
    const rightX = Math.cos(fac);
    const byRole: Record<Role, UnitSpawn[]> = { inf: [], ranged: [], cav: [], general: [], siege: [] };
    for (const s of list) byRole[roleOf(s.type)].push(s);
    const make = (sp: UnitSpawn, lat: number, depth: number) => {
      const x = clamp(lat * rightX, -PLAY + 20, PLAY - 20);
      const z = clamp(baseZ + depth * fwdZ, -PLAY + 20, PLAY - 20);
      const u = bsim.addUnit(sp, x, z, fac);
      const gid = genOf.get(sp);
      if (gid !== undefined) generals.set(u.id, gid);
      return u;
    };
    const row = (items: UnitSpawn[], depth: number, maxW = 560, startLat = 0) => {
      // measure widths by creating then repositioning
      const widths = items.map((sp) => {
        const d = unitDef(sp.type);
        const n = Math.ceil(sp.troops / bsim.menPer);
        const ranks = d.visual.mounted ? 2 : d.range ? 3 : d.category === 'heavy' ? 5 : 4;
        return Math.max(2, Math.ceil(n / ranks)) * (d.visual.mounted ? 2.3 : 1.15) + 5;
      });
      const rows: { sp: UnitSpawn; w: number }[][] = [[]];
      let acc = 0;
      items.forEach((sp, i) => {
        if (acc + widths[i] > maxW && rows[rows.length - 1].length) {
          rows.push([]);
          acc = 0;
        }
        rows[rows.length - 1].push({ sp, w: widths[i] });
        acc += widths[i];
      });
      const created: BUnit[] = [];
      rows.forEach((r, ri) => {
        const tw = r.reduce((a, x) => a + x.w, 0);
        let off = startLat - tw / 2;
        for (const it of r) {
          created.push(make(it.sp, off + it.w / 2, depth - ri * 26));
          off += it.w;
        }
      });
      return { created, width: Math.min(maxW, Math.max(0, ...rows.map((r) => r.reduce((a, x) => a + x.w, 0)))), rows: rows.length };
    };
    if (siege && si === 1 && fort) {
      // defenders: archers on the walls, the rest behind the gate and in the square
      let off = 0;
      byRole.ranged.forEach((sp, i) => {
        const n = Math.ceil(sp.troops / bsim.menPer);
        const w = Math.ceil(n / 2) * 1.15;
        const sgn = i % 2 === 0 ? 1 : -1;
        const x = sgn * (18 + off + w / 2);
        if (sgn < 0) off += w + 4;
        const u = make(sp, 0, 0);
        u.x = clamp(x, -fort.halfW + 10, fort.halfW - 10);
        u.z = field.wallZ(u.x) - 1.7;
        u.cols = Math.ceil(n / 2);
        resetSoldiers(bsim, u);
      });
      const melee = [...byRole.inf];
      melee.forEach((sp, i) => {
        const u = make(sp, 0, 0);
        u.x = ((i % 5) - 2) * 26;
        u.z = field.wallZ(0) - 30 - Math.floor(i / 5) * 24;
        resetSoldiers(bsim, u);
      });
      [...byRole.cav, ...byRole.general, ...byRole.siege].forEach((sp, i) => {
        const u = make(sp, 0, 0);
        u.x = fort.plaza.x + ((i % 3) - 1) * 30;
        u.z = fort.plaza.z + 30 + Math.floor(i / 3) * 20;
        resetSoldiers(bsim, u);
      });
      return;
    }
    const inf = row(byRole.inf, 0);
    const rng = row(byRole.ranged, siege && si === 0 ? 40 : -34);
    const halfW = Math.max(inf.width, rng.width, 60) / 2;
    byRole.cav.forEach((sp, i) => {
      const sgn = i % 2 === 0 ? 1 : -1;
      const k = Math.floor(i / 2);
      make(sp, sgn * (halfW + 35 + k * 40), -8 - (k % 2) * 16);
    });
    byRole.general.forEach((sp, i) => make(sp, (i - (byRole.general.length - 1) / 2) * 30, -70 - inf.rows * 10));
    const siegeRow = siege && si === 0 ? byRole.siege.filter((s) => s.type !== 'ram') : byRole.siege;
    row(siegeRow, -110, 600);
    if (siege && si === 0) {
      byRole.siege.filter((s) => s.type === 'ram').forEach((sp, i) => make(sp, (i - 0.5) * 24, 34));
    }
  };
  place(0, spawns[0]);
  place(1, spawns[1]);
  bsim.next = new Int32Array(bsim.soldiers.length);
  const ais: BattleAI[] = [];
  for (const side of [0, 1] as Side[]) if (bsim.units.some((u) => u.side === side && u.ai)) ais.push(new BattleAI(bsim, side));
  const zone = (side: Side, x: number, z: number) => {
    if (Math.abs(x) > PLAY - 10 || Math.abs(z) > PLAY - 10) return false;
    if (siege && fort) {
      if (side === 1) return field.inside(x, z);
      return z > field.wallZ(clamp(x, -fort.halfW, fort.halfW)) + 90 && !field.inside(x, z);
    }
    return side === 0 ? z > 110 : z < -110;
  };
  return { bsim, field, ais, playerSide, generals, zone, startStrength: [bsim.sideStrength(0), bsim.sideStrength(1)] };
}

/** Snap all soldiers of a unit to its formation (used after changing its position during deployment). */
export function resetSoldiers(bsim: BattleSim, u: BUnit) {
  const p = { x: 0, z: 0, yaw: 0 };
  for (const s of u.soldiers) {
    if (!s.alive) continue;
    bsim.slotPos(u, s.slot, u.x, u.z, u.facing, p);
    s.x = p.x;
    s.z = p.z;
    s.yaw = p.yaw;
    s.y = bsim.groundY(s.x, s.z);
  }
  u.cx = u.x;
  u.cz = u.z;
  u.dest = null;
  u.order = 'idle';
}

/** Translate the tactical result into a campaign battle outcome. */
export function outcomeFromBattle(dep: Deployment, setup: BattleSetup): BattleOutcome {
  const { bsim } = dep;
  const winner = bsim.winner === 0 ? 'attacker' : 'defender';
  const o: BattleOutcome = { winner, losses: [], shipDamage: [], shipsSunk: [], shipsCaptured: [], generalsKilled: [], generalsWounded: [], settlementTaken: false, killsA: 0, killsD: 0, tactical: true };
  const lostBySide = [0, 0];
  for (const u of bsim.units) {
    const surv = bsim.survivingMen(u);
    let lost = Math.max(0, u.startTroops - surv);
    // routed losers are cut down in the pursuit
    if (bsim.winner !== null && u.side !== bsim.winner && u.state !== 'dead') lost = Math.min(u.startTroops, lost + Math.round(surv * (u.def.visual.mounted ? 0.05 : 0.12)));
    lostBySide[u.side] += lost;
    if (u.uid >= 0) o.losses.push({ uid: u.uid, lost });
    const gid = dep.generals.get(u.id);
    if (gid !== undefined) {
      if (u.generalDead) o.generalsKilled.push(gid);
      else if (u.generalWounded) o.generalsWounded.push(gid);
    }
  }
  o.killsD = lostBySide[0]; // attackers slain by the defence
  o.killsA = lostBySide[1];
  o.settlementTaken = setup.kind === 'siege' && winner === 'attacker';
  const [s0, s1] = dep.startStrength;
  const wStart = winner === 'attacker' ? s0 : s1;
  const lStart = winner === 'attacker' ? s1 : s0;
  o.heroic = wStart < lStart * 0.7;
  o.summary = bsim.endReason;
  return o;
}

/** Run a whole battle without rendering (tests / balancing). */
export function simulateHeadless(dep: Deployment, maxSeconds = 1800, dt = 0.1) {
  const { bsim, ais } = dep;
  // headless: the AI commands every unit
  for (const u of bsim.units) u.ai = true;
  if (!ais.some((a) => a.side === 0)) ais.push(new BattleAI(bsim, 0));
  if (!ais.some((a) => a.side === 1)) ais.push(new BattleAI(bsim, 1));
  bsim.started = true;
  let t = 0;
  while (bsim.winner === null && t < maxSeconds) {
    for (const ai of ais) ai.update(dt);
    bsim.update(dt);
    bsim.events.length = 0;
    t += dt;
  }
  if (bsim.winner === null) bsim.finish(1, 'Time ran out.');
  return bsim;
}
