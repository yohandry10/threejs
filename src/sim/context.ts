import { EventBus, type GameEvent } from '../core/eventBus';
import { Rng } from '../core/rng';
import { factionDef } from '../data/factions';
import { REGION_NAMES } from '../data/worldLayout';
import type { WorldGeo } from './world/geo';
import type { ArmyState, Character, FactionId, FactionState, FleetState, GameState, Notification, ProvinceState } from './types';

/** Simulation context: authoritative state + static geography + event bus + seeded RNG. */
export class Sim {
  rng: Rng;
  /** transient per-session caches (never saved) */
  cache = new Map<string, unknown>();
  constructor(
    public s: GameState,
    public geo: WorldGeo,
    public bus: EventBus = new EventBus(),
  ) {
    this.rng = new Rng(s.rng);
  }
  syncRng() {
    this.s.rng = this.rng.state;
  }
  emit(e: GameEvent) {
    this.bus.emit(e);
  }
  get turn() {
    return this.s.turn;
  }
  fac(id: FactionId): FactionState {
    return this.s.factions[id];
  }
  char(id: number | undefined): Character | undefined {
    return id === undefined ? undefined : this.s.characters[id];
  }
  prov(id: number): ProvinceState {
    return this.s.provinces[id];
  }
  pgeo(id: number) {
    return this.geo.provinces[id];
  }
  provName(id: number) {
    return this.s.provinces[id]?.settlement.name ?? this.geo.provinces[id]?.name ?? '?';
  }
  regionName(id: number) {
    return REGION_NAMES[this.geo.provinces[id].region] ?? '';
  }
  facName(id: FactionId) {
    return factionDef(id).short;
  }
  houseName(id: FactionId) {
    return factionDef(id).house;
  }
  provincesOf(id: FactionId): ProvinceState[] {
    return this.s.provinces.filter((p) => p.owner === id);
  }
  armiesOf(id: FactionId): ArmyState[] {
    return Object.values(this.s.armies).filter((a) => a.faction === id);
  }
  fleetsOf(id: FactionId): FleetState[] {
    return Object.values(this.s.fleets).filter((f) => f.faction === id);
  }
  aliveFactions(): FactionState[] {
    return Object.values(this.s.factions).filter((f) => f.alive);
  }
  majorFactions(): FactionState[] {
    return Object.values(this.s.factions).filter((f) => f.alive && !f.isRebel && f.id !== 'free' && f.id !== 'pirates');
  }
  isPlayer(id: FactionId) {
    return this.s.player === id;
  }
  notify(n: Omit<Notification, 'id' | 'turn'>, faction?: FactionId) {
    if (faction && faction !== this.s.player) return;
    const note: Notification = { ...n, id: this.s.ids.notif++, turn: this.s.turn };
    this.s.notifications.push(note);
    if (this.s.notifications.length > 120) this.s.notifications.splice(0, this.s.notifications.length - 120);
    this.emit({ type: 'NOTIFICATION', notification: note });
  }
  chronicle(text: string, factions: FactionId[], kind = 'event') {
    this.s.chronicle.push({ turn: this.s.turn, text, factions, kind });
    if (this.s.chronicle.length > 400) this.s.chronicle.splice(0, this.s.chronicle.length - 400);
  }
  /** Is the faction involved in the given notification relevant for the player? */
  playerCares(...ids: FactionId[]) {
    const p = this.s.player;
    return ids.includes(p);
  }
}
