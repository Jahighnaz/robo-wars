// Robo Wars save: the pilot, their record and settings. Small and versioned.
import { CHASSIS_IDS } from '../robo/data';

export type Difficulty = 'easy' | 'normal' | 'hard';
export interface Settings { sound: boolean; music: boolean; bots: number; difficulty: Difficulty }
export interface Pilot { id: string; name: string; chassis: string }
export interface Record_ { matches: number; wins: number; kills: number; deaths: number; bestStreak: number; byChassis: Record<string, number> }
export interface Save { v: 1; pilot: Pilot; rec: Record_; settings: Settings; crewCode?: string }

const uid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export const defaultSettings = (): Settings => ({ sound: true, music: true, bots: 3, difficulty: 'normal' });

export function defaultSave(): Save {
  return {
    v: 1,
    pilot: { id: uid(), name: 'Pilot #' + (100 + Math.floor(Math.random() * 900)), chassis: 'clank' },
    rec: { matches: 0, wins: 0, kills: 0, deaths: 0, bestStreak: 0, byChassis: {} },
    settings: defaultSettings(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validSave(s: any): s is Save {
  return !!s && s.v === 1 && !!s.pilot && typeof s.pilot.id === 'string';
}

/** Fill in anything missing and clamp what came from storage. */
export function hydrate(s: Save): Save {
  const d = defaultSave();
  s.pilot.name = typeof s.pilot.name === 'string' && s.pilot.name.trim() ? s.pilot.name.slice(0, 20) : d.pilot.name;
  if (!CHASSIS_IDS.includes(s.pilot.chassis)) s.pilot.chassis = 'clank';
  s.rec = { ...d.rec, ...(s.rec || {}) };
  s.settings = { ...d.settings, ...(s.settings || {}) };
  s.settings.bots = Math.max(1, Math.min(5, Math.round(s.settings.bots)));
  if (!['easy', 'normal', 'hard'].includes(s.settings.difficulty)) s.settings.difficulty = 'normal';
  return s;
}

export const serialize = (s: Save) => JSON.stringify(s);
