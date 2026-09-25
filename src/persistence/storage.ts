import type { SaveBlob } from '../sim/save';

/** Save slots in IndexedDB (falls back to localStorage). */
const DB = 'crown-and-tide';
const STORE = 'saves';

export interface SaveMeta {
  slot: string;
  label: string;
  savedAt: number;
  faction: string;
  turn: number;
  year: number;
  season: number;
  version: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbp: Promise<IDBDatabase | null> | null = null;
const db = () => (dbp ??= openDb());

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!d) return resolve(undefined);
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

const LS_PREFIX = 'crownandtide.save.';

export async function writeSave(slot: string, blob: SaveBlob): Promise<void> {
  const s = blob.state;
  const meta: SaveMeta = { slot, label: blob.label, savedAt: blob.savedAt, faction: s.player, turn: s.turn, year: s.startYear + Math.floor(s.turn / 4), season: s.turn % 4, version: blob.version };
  const json = JSON.stringify(blob);
  const d = await db();
  if (d) {
    await tx(STORE, 'readwrite', (st) => st.put(json, slot));
    await tx('meta', 'readwrite', (st) => st.put(meta, slot));
  } else {
    localStorage.setItem(LS_PREFIX + slot, json);
    localStorage.setItem(LS_PREFIX + 'meta.' + slot, JSON.stringify(meta));
  }
}

export async function readSave(slot: string): Promise<unknown | null> {
  const d = await db();
  let json: string | null | undefined;
  if (d) json = await tx<string>(STORE, 'readonly', (st) => st.get(slot) as IDBRequest<string>);
  else json = localStorage.getItem(LS_PREFIX + slot);
  if (!json) return null;
  return JSON.parse(json);
}

export async function listSaves(): Promise<SaveMeta[]> {
  const d = await db();
  let out: SaveMeta[] = [];
  if (d) out = ((await tx<SaveMeta[]>('meta', 'readonly', (st) => st.getAll() as IDBRequest<SaveMeta[]>)) ?? []) as SaveMeta[];
  else
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(LS_PREFIX + 'meta.')) out.push(JSON.parse(localStorage.getItem(k)!));
    }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot: string): Promise<void> {
  const d = await db();
  if (d) {
    await tx(STORE, 'readwrite', (st) => st.delete(slot));
    await tx('meta', 'readwrite', (st) => st.delete(slot));
  } else {
    localStorage.removeItem(LS_PREFIX + slot);
    localStorage.removeItem(LS_PREFIX + 'meta.' + slot);
  }
}
