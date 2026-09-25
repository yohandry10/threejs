import { SAVE_VERSION } from './setup';
import type { GameState } from './types';
import type { Sim } from './context';
import { encodeExplored } from './fog';

export interface SaveBlob {
  magic: 'CROWN_AND_TIDE';
  version: number;
  savedAt: number;
  label: string;
  state: GameState;
}

export function serialize(sim: Sim, label: string): SaveBlob {
  sim.syncRng();
  const pf = sim.s.factions[sim.s.player];
  if (pf) pf.explored = encodeExplored(sim);
  const state = JSON.parse(JSON.stringify(sim.s)) as GameState;
  return { magic: 'CROWN_AND_TIDE', version: SAVE_VERSION, savedAt: Date.now(), label, state };
}

export class SaveError extends Error {}

/** Validate and migrate a save blob to the current version. */
export function migrate(blob: unknown): GameState {
  const b = blob as Partial<SaveBlob>;
  if (!b || b.magic !== 'CROWN_AND_TIDE' || !b.state) throw new SaveError('This file is not a Crown & Tide save.');
  const s = b.state as GameState;
  if (typeof s.turn !== 'number' || !s.factions || !Array.isArray(s.provinces) || !s.characters) throw new SaveError('The save file is corrupted.');
  const v = b.version ?? 1;
  if (v > SAVE_VERSION) throw new SaveError('This save was made by a newer version of the game.');
  // v1 -> v2: stats & tutorial
  s.stats ??= { battles: 0, sieges: 0, marriages: 0, successions: 0, wars: 0 };
  s.tutorial ??= { step: 0, done: true, enabled: false };
  // v2 -> v3: faction ai memory, war weariness, intel
  for (const f of Object.values(s.factions)) {
    f.aiMemory ??= {};
    f.warWeariness ??= 0;
    f.intelOn ??= {};
    f.objectives ??= [];
    f.pastRulers ??= [];
  }
  s.intrigue ??= [];
  s.decisions ??= [];
  s.tradeRoutes ??= [];
  s.diplomacy.truces ??= [];
  s.diplomacy.reputation ??= {};
  for (const p of s.provinces) p.previousOwners ??= [];
  for (const a of Object.values(s.armies)) a.path ??= [];
  for (const f of Object.values(s.fleets)) f.carrying ??= [];
  s.version = SAVE_VERSION;
  return s;
}
