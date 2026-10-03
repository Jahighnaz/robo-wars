// Block grid, connectivity and the stat compiler (shared rules with enemies).
import { B, fam, T } from '../data';
import { clamp, DIRS } from '../core/math';
import type { Rng } from '../core/rng';

export interface BuildCell { x: number; y: number; t: string; r: number }

export interface Block {
  x: number; y: number; t: string; r: number;
  hp: number; max: number; cd: number;
  wx: number; wy: number; fl: number; dead?: boolean;
  syn: { chain: number; rateM: number; dmgM: number };
}

export interface Mods {
  dmg: Record<string, number>;
  rate: number; range: number; magnet: number; speed: number; xp: number;
  heal: number; armor: number; regen: number; crit: number;
}

export interface VehicleStats {
  mass: number; thrust: number; turnW: number; turn: number; power: number; demand: number;
  /** point-defence blocks */
  zappers: Block[];
  magnet: number; trackT: number; hoverT: number; radius: number; weapons: Block[]; props: number;
  speed: number; powerFactor: number; trackFrac: number; hoverFrac: number;
}

export interface Vehicle {
  x: number; y: number; h: number; vx: number; vy: number;
  list: Block[]; map: Map<number, Block>; s: VehicleStats; flash: number;
}

export type UpLevels = Record<string, number>;

export const freshMods = (): Mods => ({
  dmg: { kinetic: 0, explosive: 0, fire: 0, energy: 0, electric: 0 },
  rate: 0, range: 0, magnet: 0, speed: 0, xp: 0, heal: 0, armor: 0, regen: 0, crit: 0,
});

export const bkey = (x: number, y: number) => (x + 32) * 128 + (y + 32);

export function makeVehicle(build: BuildCell[], up: UpLevels, rng?: Rng): Vehicle {
  const v = { x: 0, y: 0, h: -Math.PI / 2, vx: 0, vy: 0, list: [], map: new Map(), s: null as unknown as VehicleStats, flash: 0 } as Vehicle;
  for (const b of build) addBlock(v, b.x, b.y, b.t, b.r, up, rng);
  return v;
}

export function addBlock(v: Vehicle, x: number, y: number, t: string, r: number, up: UpLevels, rng?: Rng): Block {
  const d = B[t];
  const mx = Math.round(d.hp * (1 + 0.2 * (up[t] || 0)));
  const b: Block = { x, y, t, r: r || 0, hp: mx, max: mx, cd: rng ? rng.range(0, 0.3) : 0, wx: 0, wy: 0, fl: 0, syn: { chain: 0, rateM: 1, dmgM: 1 } };
  v.list.push(b);
  v.map.set(bkey(x, y), b);
  return b;
}

export const getB = (v: Vehicle, x: number, y: number) => v.map.get(bkey(x, y));

export function neighbours(v: Vehicle, b: { x: number; y: number }): Block[] {
  const out: Block[] = [];
  for (const [dx, dy] of DIRS) { const n = getB(v, b.x + dx, b.y + dy); if (n) out.push(n); }
  return out;
}

/** Blocks still connected to the cab at (0,0). */
export function reachable(v: Vehicle): Set<Block> {
  const cab = getB(v, 0, 0);
  const seen = new Set<Block>();
  if (!cab) return seen;
  const st = [cab];
  seen.add(cab);
  while (st.length) {
    const b = st.pop()!;
    for (const n of neighbours(v, b)) if (!seen.has(n)) { seen.add(n); st.push(n); }
  }
  return seen;
}

export function compileVehicle(v: Vehicle, mods: Mods, up: UpLevels): VehicleStats {
  const CS = T.cellSize;
  const s = { mass: 0, thrust: 0, turnW: 0, power: 0, demand: 0, magnet: 100 + mods.magnet, trackT: 0, hoverT: 0, radius: CS, weapons: [] as Block[], zappers: [] as Block[], props: 0 } as VehicleStats;
  for (const b of v.list) {
    const d = B[b.t];
    s.mass += d.mass;
    const L = up[b.t] || 0;
    if (d.thrust) {
      const th = d.thrust * (1 + 0.08 * L);
      s.thrust += th; s.turnW += (d.turn || 0) * th; s.props++;
      if (d.mud) s.trackT += th;
      if (d.hover) s.hoverT += th;
    }
    const pw = d.power || 0;
    const f = fam(b.t);
    if (pw > 0) s.power += pw + (f === 'battery' || f === 'cab' ? L : 0);
    else if (pw < 0) s.demand -= pw;
    if (d.magnet) s.magnet += d.magnet + 25 * L;
    if (d.w) s.weapons.push(b);
    if (d.pd) s.zappers.push(b);
    const rr = Math.hypot(b.x, b.y) * CS + CS * 0.75;
    if (rr > s.radius) s.radius = rr;
  }
  s.turn = s.thrust ? s.turnW / s.thrust : 1.6;
  s.speed = (s.thrust ? clamp(90 * s.thrust / s.mass, 40, 290) : 28) * (1 + mods.speed);
  s.powerFactor = s.demand > s.power ? Math.max(0.15, s.power / s.demand) : 1;
  s.trackFrac = s.thrust ? s.trackT / s.thrust : 0;
  s.hoverFrac = s.thrust ? s.hoverT / s.thrust : 0;
  for (const b of s.weapons) {
    let chain = 0, rateM = 1, dmgM = 1;
    const bf = fam(b.t);
    for (const n of neighbours(v, b)) {
      const nf = fam(n.t);
      if (nf === 'battery') { if (bf === 'tesla') chain++; if (bf === 'laser') dmgM += 0.2; }
      if (nf === 'cannon' && bf === 'cannon') rateM += 0.12;
    }
    b.syn = { chain, rateM, dmgM };
  }
  v.s = s;
  return s;
}

/** Empty cells next to the build, inside a square of radius rlim. */
export function validCells(list: { x: number; y: number }[], rlim: number): [number, number][] {
  const occ = new Set(list.map(b => b.x + ',' + b.y));
  const out: [number, number][] = [];
  for (const b of list) for (const [dx, dy] of DIRS) {
    const x = b.x + dx, y = b.y + dy, k = x + ',' + y;
    if (Math.abs(x) <= rlim && Math.abs(y) <= rlim && !occ.has(k)) { occ.add(k); out.push([x, y]); }
  }
  return out;
}

/** Remove a block from a stored build; returns blocks that lost their connection (also removed). */
export function removeFromBuild(build: BuildCell[], target: BuildCell): BuildCell[] {
  build.splice(build.indexOf(target), 1);
  const v = makeVehicle(build, {});
  const keep = reachable(v);
  const lost = new Set(v.list.filter(o => !keep.has(o)).map(o => o.x + ',' + o.y));
  const removed: BuildCell[] = [];
  for (let i = build.length - 1; i >= 0; i--) if (lost.has(build[i].x + ',' + build[i].y)) removed.push(...build.splice(i, 1));
  return removed;
}
