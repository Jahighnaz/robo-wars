// Robo Wars content and tuning: src/data/robo.json, validated at load time.
import { z } from 'zod';
import json from '../data/robo.json';

const card = z.object({ name: z.string(), cd: z.number().positive(), glyph: z.string() });
const chassis = z.object({
  name: z.string(),
  move: z.enum(['walk', 'treads', 'wheels', 'slide', 'crawl']),
  hp: z.number().int().positive(),
  cdMul: z.number().positive(),
  color: z.string(),
  perk: z.string(),
  starts: z.array(z.string()),
  heavy: z.boolean().optional(),
  ram: z.number().optional(),
  pick: z.number().optional(),
  miner: z.boolean().optional(),
});
const upgrade = z.object({
  name: z.string(),
  kind: z.enum(['passive', 'active']),
  cost: z.number().int().positive(),
  desc: z.string(),
  cd: z.number().optional(),
  dmg: z.number().optional(),
  radius: z.number().optional(),
  jam: z.number().optional(),
  range: z.number().optional(),
  dur: z.number().optional(),
  once: z.boolean().optional(),
});
const schema = z.object({
  board: z.object({
    cols: z.number().int().min(8), rows: z.number().int().min(6),
    belts: z.number().int(), gears: z.number().int(), pits: z.number().int(), walls: z.number().int(),
    lasers: z.number().int(), pushers: z.number().int(), energy: z.number().int(), wrenches: z.number().int(), crates: z.number().int(),
  }),
  match: z.object({
    tick: z.number().positive(), lives: z.number().int().positive(), timeLimit: z.number().positive(), respawn: z.number(),
    spawnGuard: z.number(), startEnergy: z.number().int(), killEnergy: z.number().int(), stepTime: z.number().positive(),
    laserDmg: z.number(), boardLaserDmg: z.number(), creditWindow: z.number(), energyRecharge: z.number().int(),
    /** most energy a robot can earn per round (5 registers), from cubes and kills together */
    roundIncome: z.number().int().positive(),
  }),
  cards: z.record(z.string(), card),
  chassis: z.record(z.string(), chassis),
  upgrades: z.record(z.string(), upgrade),
  slots: z.object({ passive: z.number().int(), active: z.number().int() }),
  /** equal-specs battles (crew PvP): every robot gets this hull and no chassis perks */
  standard: z.object({ hp: z.number().int().positive() }),
  /** classic mode: one card per register; cooldowns counted in registers */
  classic: z.object({ /** seconds between cards, belt moves and lasers while registers run */ beat: z.number().positive(), cards: z.record(z.string(), z.number().int().min(0)), energyRecharge: z.number().int().positive() }),
});

export const R = schema.parse(json);
export type CardId = 'move1' | 'move2' | 'move3' | 'back' | 'left' | 'right' | 'uturn';
export const CARD_IDS: CardId[] = ['move1', 'move2', 'move3', 'back', 'left', 'right', 'uturn'];
export type ChassisDef = z.infer<typeof chassis>;
export type UpgradeDef = z.infer<typeof upgrade>;
export const CHASSIS_IDS = Object.keys(R.chassis);
export const UPGRADE_IDS = Object.keys(R.upgrades);
for (const k of CARD_IDS) if (!R.cards[k]) throw new Error('robo.json: missing card ' + k);
for (const c of CHASSIS_IDS) for (const u of R.chassis[c].starts) if (!R.upgrades[u]) throw new Error(`robo.json: ${c} starts with unknown upgrade ${u}`);

/** Player colours for robots (tags, floor rings, beams). */
export const TEAM_COLORS = ['#00f0ff', '#ff2bd6', '#f5ff3b', '#5dff8a', '#ff8a2a', '#a774ff'];
