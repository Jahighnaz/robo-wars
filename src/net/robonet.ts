// Robo Wars over the crew link. The host runs the only Match; clients build
// the same board from the seed and copy robot state from snapshots, so they
// never simulate. Inputs travel the other way as tiny action messages.
import { Match, type MatchEvent, type PlayerSpec, type Robot } from '../robo/match';
import { flipBelts } from '../robo/board';
import { CARD_IDS, type CardId } from '../robo/data';

export interface PublicProfile { id: string; name: string; chassis: string; wins: number; matches: number }

export function isPublicProfile(x: unknown): x is PublicProfile {
  const p = x as PublicProfile;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.chassis === 'string';
}

export interface LobbySeat { pid: string; name: string; chassis: string }
export type Action = { a: 'card'; x: CardId } | { a: 'buy'; x: string } | { a: 'use'; x: string; r?: number; c?: number };

export interface Snapshot {
  t: number; reg: number; tickT: number; over: boolean; winner: number; rev: boolean;
  drained: number[];
  /** per robot: r, c, d, hp, lives, energy, flags(alive|out<<1|shieldUp<<2), respawnT, guardT, jamT, kills, deaths */
  rb: number[][];
  cds: number[][];
  up: { p: string[]; a: string[]; acd: number[] }[];
  ev: MatchEvent[];
}

export type RoboMsg =
  | { k: 'rw_lobby'; open: boolean; host: string; hostPid: string; seats: LobbySeat[]; bots: number; tick: number }
  | { k: 'rw_join'; seat: LobbySeat }
  | { k: 'rw_leave'; pid: string }
  | { k: 'rw_start'; seed: number; players: PlayerSpec[]; tick: number; equal: boolean }
  | { k: 'rw_in'; pid: string; act: Action }
  | { k: 'rw_snap'; s: Snapshot }
  | { k: 'rw_end' };

/** Messages only the host needs; the crew host does not relay them. */
export const HOST_ONLY = new Set(['rw_join', 'rw_leave', 'rw_in']);

export const SNAP_HZ = 15;

const r2 = (v: number) => Math.round(v * 100) / 100;

export function snapshot(m: Match, ev: MatchEvent[]): Snapshot {
  return {
    t: r2(m.t), reg: m.register, tickT: r2(m.tickT), over: m.over, winner: m.winner, rev: m.revT > 0,
    drained: [...m.drained.keys()],
    rb: m.robots.map(r => [r.r, r.c, r.d, r.hp, r.lives, r.energy, Number(r.alive) | (Number(r.out) << 1) | (Number(r.shieldUp) << 2), r2(r.respawnT), r2(r.guardT), r2(r.jamT), r.kills, r.deaths]),
    cds: m.robots.map(r => CARD_IDS.map(k => r2(r.cds[k]))),
    up: m.robots.map(r => ({ p: r.passive, a: r.active, acd: r.active.map(k => r2(r.acd[k] ?? 0)) })),
    ev,
  };
}

/** Copy a snapshot into a client's mirror Match (built from the same seed and players). */
export function applySnapshot(m: Match, s: Snapshot): MatchEvent[] {
  m.t = s.t; m.register = s.reg; m.tickT = s.tickT; m.over = s.over; m.winner = s.winner;
  const rev = m.revT > 0;
  if (s.rev !== rev) { flipBelts(m.board); m.revT = s.rev ? 1 : 0; }
  m.drained = new Map(s.drained.map(i => [i, 1]));
  s.rb.forEach((a, i) => {
    const r: Robot | undefined = m.robots[i];
    if (!r) return;
    [r.r, r.c, r.d, r.hp, r.lives, r.energy] = a;
    r.alive = !!(a[6] & 1); r.out = !!(a[6] & 2); r.shieldUp = !!(a[6] & 4);
    [r.respawnT, r.guardT, r.jamT, r.kills, r.deaths] = a.slice(7);
    CARD_IDS.forEach((k, j) => { r.cds[k] = s.cds[i]?.[j] ?? 0; });
    const u = s.up[i];
    if (u) { r.passive = u.p; r.active = u.a; r.acd = {}; u.a.forEach((k, j) => { r.acd[k] = u.acd[j] ?? 0; }); }
  });
  return s.ev;
}
