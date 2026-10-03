// Versioned save. The format is identical to the prototype (v: 1), so prototype
// export codes import here and codes exported here still load in the prototype.
import { B, DTYPES, RES_KEYS, WORLDS, WORLD_KEYS, type DType, type ResKey } from '../data';
import { compileSpecies, makeSpecies, type Species } from '../enemies/species';
import type { BuildCell } from '../vehicle/vehicle';

export interface WorldState {
  gen: number; tier: number; runs: number; wins: number; era: number;
  res: Record<DType, number>; species: Species[]; log: string[];
}

export interface Settings { dmgNumbers: boolean; arcs: boolean; shake: boolean; bloom: boolean }

export interface Save {
  v: 1;
  nextId: number;
  res: Record<ResKey, number>;
  inv: Record<string, number>;
  build: BuildCell[];
  gridR: number;
  up: Record<string, number>;
  worlds: Record<string, WorldState>;
  runs: number; wins: number; muted: boolean; seenHelp: boolean; discovered: number;
  /** standalone-only additions; ignored by the prototype */
  settings?: Settings;
}

export const defaultSettings = (): Settings => ({ dmgNumbers: true, arcs: true, shake: true, bloom: true });

export function newWorldState(save: Pick<Save, 'nextId'>, k: string): WorldState {
  const w: WorldState = { gen: 0, tier: 1, runs: 0, wins: 0, era: 1, res: {} as Record<DType, number>, species: [], log: [] };
  for (const t of DTYPES) w.res[t] = 0;
  for (const s of WORLDS[k].seeds) w.species.push(makeSpecies(save.nextId++, s.name, s.cells.map(c => [c[0], c[1], c[2]]), s.pref || 0, 0));
  return w;
}

export function defaultSave(): Save {
  const s: Save = {
    v: 1, nextId: 1,
    res: { scrap: 60, copper: 0, resin: 0, crystal: 0, pyro: 0, shard: 0 },
    inv: { armor: 2, shotgun: 1 },
    build: [
      { x: 0, y: 0, t: 'cab', r: 0 }, { x: 0, y: -1, t: 'cannon', r: 0 },
      { x: -1, y: 0, t: 'wheel', r: 0 }, { x: 1, y: 0, t: 'wheel', r: 0 },
      { x: -1, y: 1, t: 'wheel', r: 0 }, { x: 0, y: 1, t: 'battery', r: 0 }, { x: 1, y: 1, t: 'wheel', r: 0 },
      { x: 0, y: 2, t: 'cannon', r: 2 },
    ],
    gridR: 2, up: {}, worlds: {}, runs: 0, wins: 0, muted: false, seenHelp: false, discovered: 0,
    settings: defaultSettings(),
  };
  for (const k of WORLD_KEYS) s.worlds[k] = newWorldState(s, k);
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validSave(s: any): s is Save {
  if (!s || s.v !== 1 || !s.res || !s.inv || !Array.isArray(s.build) || !s.worlds) return false;
  if (!s.build.some((b: BuildCell) => b.t === 'cab' && b.x === 0 && b.y === 0)) return false;
  for (const k of WORLD_KEYS) {
    const w = s.worlds[k];
    if (!w || !Array.isArray(w.species) || w.species.length < 1 || !w.res) return false;
  }
  for (const b of s.build) if (!B[b.t]) return false;
  return true;
}

/** Fill in missing fields (migrations) and compile species. */
export function hydrate(s: Save): Save {
  for (const r of RES_KEYS) if (typeof s.res[r] !== 'number') s.res[r] = 0;
  for (const k of WORLD_KEYS) {
    const w = s.worlds[k];
    for (const t of DTYPES) if (typeof w.res[t] !== 'number') w.res[t] = 0;
    if (!Array.isArray(w.log)) w.log = [];
    for (const sp of w.species) {
      if (!sp.st) sp.st = { n: 0, dmg: 0, life: 0 };
      if (!sp.spd) sp.spd = 1;
      if (!sp.pop) sp.pop = 1;
      compileSpecies(sp);
    }
  }
  if (!s.nextId) s.nextId = 1000;
  if (!s.up || typeof s.up !== 'object') s.up = {};
  if (!s.gridR) s.gridR = 2;
  for (const t in s.inv) if (!B[t]) delete s.inv[t];
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  return s;
}

export const serialize = (s: Save) => JSON.stringify(s, (k, v) => (k === 'c' ? undefined : v));

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(code: string): string {
  const bin = atob(code.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export const exportCode = (s: Save) => toBase64(serialize(s));

export function importCode(code: string): Save {
  let parsed: unknown;
  try { parsed = JSON.parse(fromBase64(code.trim())); } catch { throw new Error('the code is damaged or incomplete'); }
  if (!validSave(parsed)) throw new Error('not a Scrap Evolution save');
  return hydrate(parsed);
}
