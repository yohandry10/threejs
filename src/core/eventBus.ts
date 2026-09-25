/** Structured, typed game event bus shared by simulation, renderer, UI and audio. */
export type GameEventType =
  | 'RULER_DIED'
  | 'SUCCESSION_OCCURRED'
  | 'CHARACTER_BORN'
  | 'CHARACTER_DIED'
  | 'WAR_DECLARED'
  | 'PEACE_SIGNED'
  | 'ALLIANCE_FORMED'
  | 'ALLIANCE_BROKEN'
  | 'TREATY_SIGNED'
  | 'MARRIAGE_COMPLETED'
  | 'PROPOSAL_REJECTED'
  | 'CITY_CAPTURED'
  | 'SIEGE_STARTED'
  | 'ARMY_DESTROYED'
  | 'ARMY_CREATED'
  | 'ARMY_MOVED'
  | 'FLEET_MOVED'
  | 'SHIP_SUNK'
  | 'FLEET_DESTROYED'
  | 'BATTLE_RESOLVED'
  | 'BUILDING_COMPLETED'
  | 'UNIT_RECRUITED'
  | 'TURN_ENDED'
  | 'TURN_STARTED'
  | 'FACTION_ELIMINATED'
  | 'REBELLION'
  | 'EVENT_TRIGGERED'
  | 'NOTIFICATION'
  | 'STATE_CHANGED'
  | 'OWNERSHIP_CHANGED'
  | 'VICTORY';

export interface GameEvent {
  type: GameEventType;
  [k: string]: unknown;
}

type Handler = (e: GameEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private any = new Set<Handler>();
  on(type: GameEventType | '*', fn: Handler): () => void {
    if (type === '*') {
      this.any.add(fn);
      return () => this.any.delete(fn);
    }
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit(e: GameEvent): void {
    const set = this.handlers.get(e.type);
    if (set) for (const fn of [...set]) safeCall(fn, e);
    for (const fn of [...this.any]) safeCall(fn, e);
  }
  clear(): void {
    this.handlers.clear();
    this.any.clear();
  }
}

function safeCall(fn: Handler, e: GameEvent) {
  try {
    fn(e);
  } catch (err) {
    console.error('[event handler]', e.type, err);
  }
}
