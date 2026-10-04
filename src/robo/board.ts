// The factory floor: a grid ported from the Robo Rally projection board
// (conveyor belts, gears, pits, walls, board lasers, push panels, energy,
// repair wrenches, priority antenna), plus crates as solid cover.
// Generation is seeded, so every device in a match builds the same board.
import { Rng } from '../core/rng';
import { R } from './data';

/** N E S W, as in the reference: r grows downwards */
export const DIRS = [{ dr: -1, dc: 0 }, { dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }] as const;
export const OPP = (d: number) => (d + 2) % 4;

export type CellType = 'floor' | 'pit' | 'conv' | 'wrench' | 'energy' | 'crate';
export interface Cell {
  r: number; c: number;
  type: CellType;
  /** a wall on that side of this cell (N E S W) */
  walls: [boolean, boolean, boolean, boolean];
  /** belt: direction it carries, turn arrow at this cell, green (1 step) or blue (2 steps) */
  dir: number; turn: 'l' | 'r' | null; kind: 'g' | 'b' | null;
  gear: 'cw' | 'ccw' | null;
  /** push panel on a wall side, active on these registers */
  pusher: { side: number; ph: number[] } | null;
  /** board laser mounted on this wall side, firing across the board */
  emit: number | null;
  /** start position number (1-based), 0 if none */
  start: number;
  pv: number;
}

export interface Board {
  seed: number; cols: number; rows: number;
  cells: Cell[];
  emitters: Cell[];
  starts: Cell[];
  antenna: { r: number; c: number };
}

const newCell = (r: number, c: number): Cell => ({ r, c, type: 'floor', walls: [false, false, false, false], dir: 0, turn: null, kind: null, gear: null, pusher: null, emit: null, start: 0, pv: 0 });

export function cellAt(b: Board, r: number, c: number): Cell | null {
  return r >= 0 && r < b.rows && c >= 0 && c < b.cols ? b.cells[r * b.cols + c] : null;
}

/** a wall between this cell and its neighbour in direction d */
export function wallBlocked(b: Board, cell: Cell, d: number): boolean {
  const n = cellAt(b, cell.r + DIRS[d].dr, cell.c + DIRS[d].dc);
  return cell.walls[d] || !!(n && n.walls[OPP(d)]);
}

export const isAntenna = (b: Board, r: number, c: number) => b.antenna.r === r && b.antenna.c === c;
/** solid: blocks movement and shots */
export const isSolid = (b: Board, r: number, c: number) => isAntenna(b, r, c) || cellAt(b, r, c)?.type === 'crate';

export function generateBoard(seed: number, cols = R.board.cols, rows = R.board.rows): Board {
  const rng = new Rng(seed);
  const ri = (a: number, b: number) => a + Math.floor(rng.next() * (b - a + 1));
  const S = R.board;
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(newCell(r, c));
  const b: Board = { seed, cols, rows, cells, emitters: [], starts: [], antenna: { r: 0, c: 0 } };
  const C = (r: number, c: number) => cellAt(b, r, c);

  // start positions around the edge, facing inwards; their neighbourhood stays plain floor
  const mid = Math.floor(rows / 2);
  const spots: [number, number][] = [[1, 1], [rows - 2, cols - 2], [1, cols - 2], [rows - 2, 1], [mid, 1], [mid, cols - 2]];
  spots.forEach(([r, c], i) => { const cell = C(r, c)!; cell.start = i + 1; b.starts.push(cell); });
  const nearStart = (r: number, c: number) => b.starts.some(s => Math.abs(s.r - r) <= 1 && Math.abs(s.c - c) <= 1);

  // priority antenna in the middle
  b.antenna = { r: mid, c: Math.floor(cols / 2) };
  const reserved = (r: number, c: number) => nearStart(r, c) || isAntenna(b, r, c);
  const free = (cell: Cell | null) => !!cell && cell.type === 'floor' && !cell.gear && !reserved(cell.r, cell.c);

  // conveyor paths (as in the reference: random walks that sometimes turn)
  const greens = Math.ceil(S.belts * 0.6), blues = S.belts - greens;
  for (const [kind, count] of [['g', greens], ['b', blues]] as const) {
    for (let p = 0; p < count; p++) {
      let tries = 0, placed = false;
      while (tries++ < 40 && !placed) {
        let r = ri(0, rows - 1), c = ri(1, cols - 2);
        if (!free(C(r, c))) continue;
        let dir = ri(0, 3);
        const len = kind === 'g' ? ri(6, 12) : ri(5, 9);
        const laid: Cell[] = [];
        let inc: number | null = null;
        for (let s = 0; s < len; s++) {
          const cell = C(r, c);
          if (!free(cell)) break;
          let out = dir;
          const ok = (d: number) => free(C(r + DIRS[d].dr, c + DIRS[d].dc));
          if (inc !== null && rng.next() < 0.28) {
            const opts = [(dir + 1) % 4, (dir + 3) % 4].filter(ok);
            if (opts.length) out = rng.pick(opts);
          }
          if (!ok(out)) {
            const alts = [dir, (dir + 1) % 4, (dir + 3) % 4].filter(ok);
            if (alts.length) out = rng.pick(alts);
            else { cell!.type = 'conv'; cell!.kind = kind; cell!.dir = inc ?? dir; cell!.turn = null; laid.push(cell!); break; }
          }
          cell!.type = 'conv'; cell!.kind = kind; cell!.dir = out;
          cell!.turn = inc === null ? null : out === (inc + 3) % 4 ? 'l' : out === (inc + 1) % 4 ? 'r' : null;
          laid.push(cell!);
          inc = out; dir = out; r += DIRS[out].dr; c += DIRS[out].dc;
        }
        if (laid.length >= 4) placed = true;
        else for (const x of laid) { x.type = 'floor'; x.kind = null; x.turn = null; }
      }
    }
  }

  const freeCell = (): Cell | null => {
    for (let t = 0; t < 120; t++) { const cell = C(ri(0, rows - 1), ri(0, cols - 1)); if (free(cell)) return cell; }
    return null;
  };
  for (let i = 0; i < S.pits; i++) { const f = freeCell(); if (f) { f.type = 'pit'; f.pv = ri(0, 2); } }
  for (let i = 0; i < S.crates; i++) { const f = freeCell(); if (f) f.type = 'crate'; }
  for (let i = 0; i < S.gears; i++) { const f = freeCell(); if (f) f.gear = rng.next() < 0.5 ? 'cw' : 'ccw'; }
  for (let i = 0; i < S.wrenches; i++) { const f = freeCell(); if (f) f.type = 'wrench'; }
  for (let i = 0; i < S.energy; i++) { const f = freeCell(); if (f) f.type = 'energy'; }

  // walls (never sealing a start)
  for (let i = 0; i < S.walls; i++) {
    const cell = freeCell() ?? C(ri(1, rows - 2), ri(2, cols - 3));
    if (cell && cell.type !== 'pit' && cell.type !== 'crate' && !nearStart(cell.r, cell.c)) cell.walls[ri(0, 3)] = true;
  }
  // board lasers: an emitter on a wall, firing across
  for (let i = 0; i < S.lasers; i++) {
    for (let t = 0; t < 40; t++) {
      const cell = C(ri(1, rows - 2), ri(2, cols - 3));
      if (!free(cell)) continue;
      const side = ri(0, 3);
      cell!.walls[side] = true; cell!.emit = side;
      b.emitters.push(cell!); break;
    }
  }
  // push panels on registers 1-3-5 or 2-4
  for (let i = 0; i < S.pushers; i++) {
    for (let t = 0; t < 40; t++) {
      const cell = C(ri(0, rows - 1), ri(0, cols - 1));
      if (!cell || cell.type === 'pit' || cell.type === 'crate' || cell.emit !== null || reserved(cell.r, cell.c)) continue;
      const side = ri(0, 3);
      if (cell.walls[side]) continue;
      cell.walls[side] = true; cell.pusher = { side, ph: rng.next() < 0.5 ? [1, 3, 5] : [2, 4] };
      break;
    }
  }
  return b;
}

/** Flip every conveyor (Reverse Gear), as in the reference. */
export function flipBelts(b: Board): void {
  for (const cell of b.cells) {
    if (cell.type !== 'conv') continue;
    if (cell.turn === 'l') { cell.dir = (cell.dir + 3) % 4; cell.turn = 'r'; }
    else if (cell.turn === 'r') { cell.dir = (cell.dir + 1) % 4; cell.turn = 'l'; }
    else cell.dir = OPP(cell.dir);
  }
}
