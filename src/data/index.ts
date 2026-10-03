// Game content: JSON files validated with zod at load time.
// Every tunable number lives in these files, not in the code.
import { z } from 'zod';
import blocksJson from './blocks.json';
import enemyBlocksJson from './enemyBlocks.json';
import resourcesJson from './resources.json';
import worldsJson from './worlds.json';
import perksJson from './perks.json';
import tuningJson from './tuning.json';

export const DTYPES = ['kinetic', 'explosive', 'fire', 'energy', 'electric'] as const;
export type DType = (typeof DTYPES)[number];
export const DCOL: Record<DType, string> = {
  kinetic: '#e6f0ff', explosive: '#d07dff', fire: '#ffd166', energy: '#ff3b5c', electric: '#9fd0ff',
};

/** Player-facing names for damage types (workshop theme). */
export const DNAME: Record<DType, string> = { kinetic: 'nail', explosive: 'plasma', fire: 'glue', energy: 'laser', electric: 'welding arc' };

const dtype = z.enum(DTYPES);
const resKey = z.enum(['scrap', 'copper', 'resin', 'crystal', 'pyro', 'shard']);
export type ResKey = z.infer<typeof resKey>;
const cost = z.partialRecord(resKey, z.number().positive());
export type Cost = z.infer<typeof cost>;

const weapon = z.object({
  type: dtype,
  dmg: z.number().positive(),
  rate: z.number().positive(),
  range: z.number().positive(),
  arc: z.number().positive().max(360),
  speed: z.number().optional(),
  spread: z.number().optional(),
  pellets: z.number().int().optional(),
  beam: z.boolean().optional(),
  chain: z.number().int().optional(),
  burn: z.number().optional(),
  life: z.number().optional(),
  pierce: z.number().int().optional(),
  lob: z.boolean().optional(),
  aoe: z.number().optional(),
});
export type WeaponDef = z.infer<typeof weapon>;

const block = z.object({
  name: z.string(),
  ab: z.string(),
  cat: z.enum(['cab', 'prop', 'armor', 'weapon', 'energy', 'util']),
  hp: z.number().positive(),
  mass: z.number().positive(),
  power: z.number().optional(),
  thrust: z.number().optional(),
  turn: z.number().optional(),
  mud: z.boolean().optional(),
  hover: z.boolean().optional(),
  regen: z.number().optional(),
  repair: z.number().optional(),
  magnet: z.number().optional(),
  dir: z.boolean().optional(),
  color: z.string(),
  desc: z.string(),
  cost: cost.optional(),
  w: weapon.optional(),
  /** family (tier 1 id) and tier 1-3; tiers unlock from the previous tier's workshop level */
  fam: z.string(),
  tier: z.number().int().min(1).max(3),
  unlock: z.object({ from: z.string(), mk: z.number().int() }).optional(),
  /** point defence: destroys enemy projectiles in range */
  pd: z.object({ range: z.number(), rate: z.number() }).optional(),
});
export type BlockDef = z.infer<typeof block>;

const enemyBlock = z.object({
  label: z.string(),
  hp: z.number().positive(),
  mass: z.number().positive(),
  melee: z.number().optional(),
  gun: z.number().optional(),
  boom: z.number().optional(),
  lob: z.number().optional(),
  snipe: z.number().optional(),
  rocket: z.number().optional(),
  spray: z.number().optional(),
  thrust: z.number().optional(),
  res: z.partialRecord(dtype, z.number().min(0).max(0.4)).optional(),
  color: z.string(),
  mat: resKey,
});
export type EnemyBlockDef = z.infer<typeof enemyBlock>;

const cell = z.tuple([z.number().int(), z.number().int(), z.string()]);
export type Cell = [number, number, string];

const world = z.object({
  name: z.string(),
  tag: z.string(),
  hazard: z.enum(['mud', 'ice', 'lava']),
  hazardText: z.string(),
  theme: z.object({ bg: z.string(), grid: z.string(), accent: z.string(), haz: z.string(), hazEdge: z.string() }),
  res: z.partialRecord(resKey, z.number().min(0)),
  seeds: z.array(z.object({ name: z.string(), cells: z.array(cell).min(1), pref: z.number().optional(), pop: z.number().optional() })).min(4),
});
export type WorldDef = z.infer<typeof world>;

const perk = z.object({
  id: z.string(), name: z.string(), desc: z.string(),
  stat: z.enum(['rate', 'range', 'magnet', 'speed', 'xp', 'heal', 'armor', 'regen', 'crit',
    'dmg.kinetic', 'dmg.fire', 'dmg.electric', 'dmg.energy', 'dmg.explosive']),
  add: z.number(),
  max: z.number().optional(),
});
export type PerkDef = z.infer<typeof perk>;

const tuning = z.object({
  cellSize: z.number(), enemyCell: z.number(), arena: z.number(), runLength: z.number(), maxEnemies: z.number().int(),
  teslaFalloff: z.number(), teslaJump: z.number(), waveLength: z.number(), breatherEvery: z.number().int(),
  miniBossTimes: z.array(z.number()), budgetCap: z.number(), lootChance: z.number(), deathLootKeep: z.number(),
  workshopMax: z.number().int(),
  /** enemy homing rockets: guidance burns out after `guide` s, a sharp juke (> breakLock rad) breaks the lock, player shots within hitR down them */
  rocket: z.object({ speed: z.number(), turn: z.number(), guide: z.number(), life: z.number(), breakLock: z.number(), hitR: z.number() }),
  gridExpansions: z.array(z.object({ r: z.number().int(), cost })),
});

export const B = z.record(z.string(), block).parse(blocksJson);
export const EB = z.record(z.string(), enemyBlock).parse(enemyBlocksJson);
export const RES = z.record(resKey, z.object({ name: z.string(), color: z.string() })).parse(resourcesJson) as Record<ResKey, { name: string; color: string }>;
export const WORLDS = z.record(z.string(), world).parse(worldsJson);
export const PERKS = z.array(perk).parse(perksJson);
export const T = tuning.parse(tuningJson);

export const RES_KEYS = Object.keys(RES) as ResKey[];
export const PLACEABLE = Object.keys(B).filter(k => B[k].cat !== 'cab');
export const CABS = Object.keys(B).filter(k => B[k].cat === 'cab');
/** tier-1 id of a block's family (cannon2 → cannon) */
export const fam = (t: string) => B[t]?.fam ?? t;
export const isCab = (t: string) => B[t]?.cat === 'cab';
/** a tier unlocks once the previous tier reaches the given workshop level */
export const isUnlocked = (t: string, up: Record<string, number>) => { const u = B[t]?.unlock; return !u || (up[u.from] || 0) >= u.mk; };
export const tierMark = (t: string) => (B[t]?.tier > 1 ? ['', '', 'II', 'III'][B[t].tier] : '');
export const WORLD_KEYS = Object.keys(WORLDS);

// Cross-file integrity checks: world seeds may only use known enemy blocks.
for (const k of WORLD_KEYS) for (const s of WORLDS[k].seeds) for (const c of s.cells) {
  if (!EB[c[2]]) throw new Error(`World ${k}: species ${s.name} uses unknown block ${c[2]}`);
}
if (!B.cab) throw new Error('blocks.json must define a cab');
for (const k in B) { const u = B[k].unlock; if (u && !B[u.from]) throw new Error(`Block ${k} unlocks from unknown ${u.from}`); if (!B[B[k].fam]) throw new Error(`Block ${k} has unknown family ${B[k].fam}`); }
