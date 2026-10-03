// Records (KPIs). Each has a serious label and a tongue-in-cheek title for
// whoever holds it on the crew board.
import type { RunResult } from '../sim/run';
import { challengeScore, type Profile, type PublicProfile } from './profile';
import { fam } from '../data';

/** damage dealt by every tier of one tool family */
export const famDmg = (r: RunResult, f: string) => Object.keys(r.dmg).reduce((a, k) => a + (fam(k) === f ? r.dmg[k] : 0), 0);

export type Unit = 'time' | 'int' | 'dps' | 'm' | 'hp';

export interface RecordDef {
  id: string;
  label: string;
  title: string;
  kind: 'serious' | 'fun';
  unit: Unit;
  better: 'high' | 'low';
  /** value from one run; null when the run does not count for this record */
  run?: (r: RunResult, challenge: boolean) => number | null;
  /** value from lifetime counters */
  life?: (life: Record<string, number>) => number;
}

const totalDmg = (r: RunResult) => Object.values(r.dmg).reduce((a, b) => a + b, 0);

export const RECORDS: RecordDef[] = [
  { id: 'longest_shift', label: 'Longest shift survived', title: 'Workaholic', kind: 'serious', unit: 'time', better: 'high', run: r => r.t },
  { id: 'most_kills', label: 'Most kills in one shift', title: 'Pest Control', kind: 'serious', unit: 'int', better: 'high', run: r => r.kills },
  { id: 'top_level', label: 'Highest level in one shift', title: 'Fast-Track Promotion', kind: 'serious', unit: 'int', better: 'high', run: r => r.level },
  { id: 'productivity', label: 'Peak productivity (damage/s)', title: 'Productivity Guru', kind: 'serious', unit: 'dps', better: 'high', run: r => (r.t >= 60 ? totalDmg(r) / r.t : null) },
  { id: 'deadline', label: 'Fastest apex takedown', title: 'Deadline Crusher', kind: 'serious', unit: 'time', better: 'low', run: r => (r.won ? r.t : null) },
  { id: 'haul', label: 'Biggest haul of parts', title: 'Procurement Department', kind: 'serious', unit: 'int', better: 'high', run: r => r.loot },
  { id: 'league', label: 'Best challenge score', title: 'League Champion', kind: 'serious', unit: 'int', better: 'high', run: (r, ch) => (ch ? challengeScore(r) : null) },
  { id: 'shifts', label: 'Shifts clocked', title: 'Never Takes a Sick Day', kind: 'serious', unit: 'int', better: 'high', life: l => l.runs || 0 },
  { id: 'procrastinator', label: 'Longest time not touching anything', title: 'The Procrastinator', kind: 'fun', unit: 'time', better: 'high', run: r => r.stats.idleT },
  { id: 'crash_test', label: 'Most damage tanked in one shift', title: 'Crash Test Dummy', kind: 'fun', unit: 'hp', better: 'high', run: r => r.taken },
  { id: 'donuts', label: 'Most donuts in one shift', title: 'Parking Lot Menace', kind: 'fun', unit: 'int', better: 'high', run: r => Math.floor(r.stats.spins) },
  { id: 'flatpack', label: 'Most blocks lost in one shift', title: 'Flat-Pack Disassembler', kind: 'fun', unit: 'int', better: 'high', run: r => r.stats.blocksLost },
  { id: 'speedrun_hr', label: 'Quickest wreck', title: 'Speedrun to HR', kind: 'fun', unit: 'time', better: 'low', run: r => (r.won ? null : r.t) },
  { id: 'commute', label: 'Longest commute in one shift', title: 'Long-Distance Commuter', kind: 'fun', unit: 'm', better: 'high', run: r => r.stats.dist / 18 },
  { id: 'sticky', label: 'Most glue damage in one shift', title: 'Sticky Fingers', kind: 'fun', unit: 'hp', better: 'high', run: r => famDmg(r, 'flamer') },
  { id: 'bug_zapper', label: 'Most enemy projectiles zapped in one shift', title: 'Human Bug Zapper', kind: 'fun', unit: 'int', better: 'high', run: r => r.stats.zapped || 0 },
  { id: 'inventory', label: 'Most supplies salvaged in one shift', title: 'Inventory Clerk', kind: 'fun', unit: 'int', better: 'high', run: r => r.stats.mined + r.stats.caches },
  { id: 'hammer', label: 'Biggest single hit', title: 'Percussive Maintenance', kind: 'fun', unit: 'hp', better: 'high', run: r => r.stats.maxHit },
];

export const recordById = (id: string) => RECORDS.find(r => r.id === id);

export function isBetter(def: RecordDef, v: number, old: number | undefined): boolean {
  if (old === undefined) return true;
  return def.better === 'high' ? v > old : v < old;
}

/** Fold a finished run into the personal bests; returns the records that improved. */
export function applyRun(p: Profile, r: RunResult, challenge: boolean): RecordDef[] {
  const improved: RecordDef[] = [];
  for (const d of RECORDS) {
    const v = d.run ? d.run(r, challenge) : d.life ? d.life(p.life) : null;
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (d.run && v <= 0 && d.better === 'high') continue;
    if (isBetter(d, v, p.best[d.id])) { p.best[d.id] = v; if (d.run) improved.push(d); }
  }
  return improved;
}

export function fmtRecord(d: RecordDef, v: number): string {
  switch (d.unit) {
    case 'time': return Math.floor(v / 60) + ':' + String(Math.floor(v % 60)).padStart(2, '0');
    case 'dps': return Math.round(v) + '/s';
    case 'm': return v >= 1000 ? (v / 1000).toFixed(2) + ' km' : Math.round(v) + ' m';
    case 'hp': return Math.round(v).toLocaleString('en') + ' HP';
    default: return Math.round(v).toLocaleString('en');
  }
}

export interface Standing { def: RecordDef; holder: PublicProfile | null; value: number | null; mine: number | null }

/** Crew board: who holds each record among me and every known crew-mate. */
export function standings(me: PublicProfile, mates: PublicProfile[]): Standing[] {
  const all = [me, ...mates.filter(m => m.id !== me.id)];
  return RECORDS.map(def => {
    let holder: PublicProfile | null = null, value: number | null = null;
    for (const p of all) {
      const v = p.best[def.id];
      if (v === undefined || v === null) continue;
      if (value === null || isBetter(def, v, value)) { value = v; holder = p; }
    }
    return { def, holder, value, mine: me.best[def.id] ?? null };
  });
}
