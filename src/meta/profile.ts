// Player profile: name, lifetime counters, personal records, trophies and what
// we know about crew-mates. Stored inside the save (the prototype ignores it).
import type { RunResult } from '../sim/run';
import { fam } from '../data';
import { avatarOf } from './avatars';

export interface ChallengeEntry { pid: string; name: string; score: number; t: number; kills: number; won: boolean; at: number }
export interface Challenge { id: string; wk: string; seed: number; by: string; byName: string; at: number; entries: ChallengeEntry[] }

/** What we share with other devices. */
export interface PublicProfile {
  id: string; name: string;
  best: Record<string, number>;
  life: Record<string, number>;
  trophies: string[];
  updated: number;
}

export interface Profile {
  id: string;
  name: string;
  best: Record<string, number>;
  life: Record<string, number>;
  trophies: Record<string, number>;
  eggs: Record<string, number>;
  mates: Record<string, PublicProfile>;
  challenges: Challenge[];
  crewCode?: string;
  /** captain on the truck (see AVATARS) */
  avatar: string;
}

const uid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export function newProfile(): Profile {
  return {
    id: uid(),
    name: 'Intern #' + (100 + Math.floor(Math.random() * 900)),
    best: {}, life: {}, trophies: {}, eggs: {}, mates: {}, challenges: [], avatar: 'charles',
  };
}

/** Fill in anything missing (older saves, imported codes). */
export function ensureProfile(p: Partial<Profile> | undefined): Profile {
  const d = newProfile();
  if (!p || typeof p !== 'object') return d;
  return {
    id: typeof p.id === 'string' ? p.id : d.id,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 24) : d.name,
    best: p.best && typeof p.best === 'object' ? p.best : {},
    life: p.life && typeof p.life === 'object' ? p.life : {},
    trophies: p.trophies && typeof p.trophies === 'object' ? p.trophies : {},
    eggs: p.eggs && typeof p.eggs === 'object' ? p.eggs : {},
    mates: p.mates && typeof p.mates === 'object' ? p.mates : {},
    challenges: Array.isArray(p.challenges) ? p.challenges.slice(0, 10) : [],
    crewCode: typeof p.crewCode === 'string' ? p.crewCode : undefined,
    avatar: avatarOf(p.avatar).id,
  };
}

export function publicProfile(p: Profile): PublicProfile {
  return { id: p.id, name: p.name, best: { ...p.best }, life: { ...p.life }, trophies: Object.keys(p.trophies), updated: Date.now() };
}

export function isPublicProfile(x: unknown): x is PublicProfile {
  const o = x as PublicProfile;
  return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.best === 'object' && typeof o.life === 'object' && Array.isArray(o.trophies);
}

const add = (o: Record<string, number>, k: string, v: number) => { o[k] = (o[k] || 0) + v; };

/** Lifetime counters after a run. */
export function accumulate(p: Profile, r: RunResult): void {
  const L = p.life;
  add(L, 'runs', 1);
  add(L, 'kills', r.kills);
  add(L, 'loot', r.loot);
  add(L, 'dist', r.stats.dist);
  add(L, 'time', r.t);
  if (r.won) { add(L, 'wins', 1); add(L, 'win_' + r.wk, 1); } else add(L, 'wrecks', 1);
  // kills count per tool family, so tier II/III tools keep feeding the same trophies
  for (const t in r.ks) add(L, 'k_' + fam(t), r.ks[t]);
  add(L, 'zapped', r.stats.zapped || 0);
  if (r.crew && r.crew > 1) { add(L, 'coop', 1); if (r.won) add(L, 'coop_wins', 1); }
}

/** Challenge score: survive, kill, level up, and a big bonus for the apex. */
export function challengeScore(r: RunResult): number {
  return Math.round(r.kills * 10 + r.t * 2 + r.level * 25 + (r.won ? 1000 : 0));
}

export function addChallengeEntry(c: Challenge, e: ChallengeEntry): void {
  const i = c.entries.findIndex(x => x.pid === e.pid);
  if (i < 0) c.entries.push(e);
  else if (e.score > c.entries[i].score) c.entries[i] = e;
  c.entries.sort((a, b) => b.score - a.score);
}

const CODE_PREFIX = 'CP1:';
export function exportCard(p: Profile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(publicProfile(p)));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return CODE_PREFIX + btoa(bin);
}
export function importCard(code: string): PublicProfile {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error('that is not a Charles Projects record card');
  let obj: unknown;
  try {
    const bin = atob(c.slice(CODE_PREFIX.length).replace(/\s+/g, ''));
    obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
  } catch { throw new Error('the card is damaged or incomplete'); }
  if (!isPublicProfile(obj)) throw new Error('the card is damaged or incomplete');
  return obj;
}
