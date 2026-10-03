// World evolution: adaptive resistance + a genetic algorithm over enemy genomes.
import { DTYPES, WORLDS, type Cell, type DType } from '../data';
import { clamp, DIRS } from '../core/math';
import type { Rng } from '../core/rng';
import { compileSpecies, describeSpecies, makeSpecies, nameFor, type Species } from '../enemies/species';
import type { Save } from '../persistence/save';

export const MIN_SPAWNS = 12;
const MAX_CELLS = 8;

/** Cells still connected to the core at (0,0). */
export function cellConnected(cells: Cell[]): Cell[] {
  const has = new Map(cells.map(c => [c[0] + ',' + c[1], c]));
  const seen = new Set(['0,0']);
  const st: [number, number][] = [[0, 0]];
  while (st.length) {
    const [x, y] = st.pop()!;
    for (const [dx, dy] of DIRS) {
      const k = x + dx + ',' + (y + dy);
      if (has.has(k) && !seen.has(k)) { seen.add(k); st.push([x + dx, y + dy]); }
    }
  }
  return cells.filter(c => seen.has(c[0] + ',' + c[1]));
}

export function freeAdj(cells: Cell[]): [number, number][] {
  const occ = new Set(cells.map(c => c[0] + ',' + c[1]));
  const out: [number, number][] = [];
  for (const c of cells) for (const [dx, dy] of DIRS) {
    const x = c[0] + dx, y = c[1] + dy, k = x + ',' + y;
    if (Math.abs(x) <= 2 && Math.abs(y) <= 2 && !occ.has(k)) { occ.add(k); out.push([x, y]); }
  }
  return out;
}

/** Mutation weights shift toward plating that counters the player's damage mix. */
export function counterWeights(wk: string, killsBy: Partial<Record<DType, number>>): Record<string, number> {
  let tot = 0;
  for (const t of DTYPES) tot += killsBy[t] || 0;
  const sh = (t: DType) => (tot ? (killsBy[t] || 0) / tot : 0);
  const w: Record<string, number> = { spike: 3, plate: 2, gun: 1.6, boomer: 1, thruster: 2, fireplate: 0.4, insul: 0.4, reactive: 0.4 };
  w.reactive += 4 * sh('kinetic') + 3 * sh('explosive');
  w.fireplate += 5 * sh('fire');
  w.insul += 3 * (sh('electric') + sh('energy'));
  if (wk === 'tundra') w.insul += 1;
  if (wk === 'magma') w.fireplate += 1;
  return w;
}

export function mutate(cells: Cell[], weights: Record<string, number>, rng: Rng): Cell[] {
  const ops = 1 + (rng.next() < 0.5 ? 1 : 0);
  for (let i = 0; i < ops; i++) {
    const r = rng.next();
    const nonCore = cells.filter(c => c[2] !== 'core');
    if (r < 0.45 && cells.length < MAX_CELLS) {
      const f = freeAdj(cells);
      if (f.length) { const p = rng.pick(f); cells.push([p[0], p[1], rng.wpick(weights)]); }
    } else if (r < 0.65 && nonCore.length > 1) {
      const c = rng.pick(nonCore);
      cells.splice(cells.indexOf(c), 1);
      const kept = cellConnected(cells);
      cells.length = 0;
      cells.push(...kept);
    } else if (nonCore.length) {
      rng.pick(nonCore)[2] = rng.wpick(weights);
    }
  }
  return cells;
}

export function crossover(A: Species, Bp: Species, rng: Rng): Cell[] {
  const cells = A.cells.map(c => [c[0], c[1], c[2]] as Cell);
  if (A === Bp) return cells;
  for (const c of Bp.cells) {
    if (c[2] === 'core' || rng.next() < 0.5) continue;
    const ex = cells.find(o => o[0] === c[0] && o[1] === c[1]);
    if (ex) { if (ex[2] !== 'core') ex[2] = c[2]; }
    else if (cells.length < MAX_CELLS && cells.some(o => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) === 1)) cells.push([c[0], c[1], c[2]]);
  }
  return cellConnected(cells);
}

export interface EvolutionReport { lines: string[]; children: number; evolved: boolean }

/** Runs at debrief. Mutates save.worlds[wk] and returns human-readable lines. */
export function evolveWorld(save: Save, wk: string, killsBy: Partial<Record<DType, number>>, rng: Rng): EvolutionReport {
  const W = save.worlds[wk];
  const lines: string[] = [];
  const sps = W.species;
  const totalN = sps.reduce((a, s) => a + s.st.n, 0);

  // Adaptive resistance
  let tot = 0;
  for (const t of DTYPES) tot += killsBy[t] || 0;
  if (tot >= 15) {
    for (const t of DTYPES) {
      const share = (killsBy[t] || 0) / tot;
      if (share > 0.4) {
        const before = W.res[t];
        W.res[t] = Math.min(0.35, +(W.res[t] + 0.05).toFixed(2));
        if (W.res[t] > before) lines.push('The machines adapted to your ' + t + ' weapons: +5% resistance (now ' + Math.round(W.res[t] * 100) + '%).');
        else lines.push('Resistance to ' + t + ' is maxed at 35%. Mix up your weapons.');
      } else if (W.res[t] > 0 && share < 0.15) {
        W.res[t] = Math.max(0, +(W.res[t] - 0.02).toFixed(2));
      }
    }
  }
  if (totalN < MIN_SPAWNS) {
    lines.push('Too few encounters for the species to evolve this time.');
    return { lines, children: 0, evolved: false };
  }

  // Genetic algorithm
  for (const s of sps) { const n = Math.max(1, s.st.n); s.fit = s.st.dmg / n + 0.4 * s.st.life / n; }
  const sorted = sps.slice().sort((a, b) => (b.fit || 0) - (a.fit || 0));
  const n = sorted.length;
  const parents = sorted.slice(0, Math.max(1, Math.ceil(n * 0.3)));
  let nKill = Math.max(1, Math.floor(n * 0.3));
  if (n - nKill < 4) nKill = Math.max(0, n - 4);
  const extinct = nKill ? sorted.slice(n - nKill) : [];
  const weights = counterWeights(wk, killsBy);
  const nChild = nKill + (n < 10 ? 1 : 0);
  const children: Species[] = [];
  for (let i = 0; i < nChild; i++) {
    const A = rng.pick(parents), Bp = rng.pick(parents);
    const cells = mutate(crossover(A, Bp, rng), weights, rng);
    const hasGun = cells.some(c => c[2] === 'gun');
    const pref = hasGun ? clamp((A.pref || 200) + rng.range(-50, 50), 130, 280) : 0;
    const child = makeSpecies(save.nextId++, nameFor(cells, rng), cells, pref, W.gen + 1);
    child.spd = clamp(((A.spd + Bp.spd) / 2) * rng.range(0.92, 1.1), 0.75, 1.35);
    compileSpecies(child);
    children.push(child);
    lines.push(child.name + ' evolved from ' + A.name + (A !== Bp ? ' × ' + Bp.name : '') + ': ' + describeSpecies(child) + '.');
  }
  for (const s of extinct) lines.push(s.name + ' went extinct.');
  W.species = sps.filter(s => !extinct.includes(s)).concat(children).slice(0, 10);
  const maxFit = Math.max(0.001, ...sorted.map(s => s.fit || 0));
  for (const s of W.species) {
    s.pop = 0.5 + (s.fit !== undefined ? s.fit / maxFit : 0.6);
    delete s.fit;
    s.st = { n: 0, dmg: 0, life: 0 };
  }
  save.discovered += children.length;
  W.gen++;
  if (W.gen % 5 === 0) {
    W.era++;
    lines.push('A new era begins in ' + WORLDS[wk].name + ' (era ' + W.era + '). Its bosses grow stronger.');
  }
  W.log = lines.slice(0, 8);
  return { lines, children: children.length, evolved: true };
}
