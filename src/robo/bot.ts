// Bot pilots: a greedy one-card look-ahead. Each think, a bot scores every
// card it could play (where would I end up? would I fall? is an enemy in my
// laser line?) and plays the best one; it buys upgrades when it can and fires
// its active upgrades when they would hit. In classic mode a bot programs its
// registers in one go, chaining the same look-ahead from where each card leaves it.
import { cellAt, DIRS, isSolid, OPP, wallBlocked } from './board';
import { CARD_IDS, R, UPGRADE_IDS, type CardId } from './data';
import type { Match, Robot } from './match';

export interface BotBrain { think: number; skill: number }

/** Where a card would take the robot, ignoring other robots (they get pushed). */
export function preview(m: Match, rb: Robot, card: CardId, from: { r: number; c: number; d: number } = rb): { r: number; c: number; d: number; dead: boolean } {
  let { r, c, d } = from;
  const b = m.board, hover = m.has(rb, 'hover');
  const walk = (dir: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const cell = cellAt(b, r, c)!;
      if (wallBlocked(b, cell, dir)) return false;
      const nr = r + DIRS[dir].dr, nc = c + DIRS[dir].dc;
      const nx = cellAt(b, nr, nc);
      if (!nx) return true;
      if (isSolid(b, nr, nc)) return false;
      r = nr; c = nc;
      if (nx.type === 'pit' && !hover) return true;
    }
    return false;
  };
  let dead = false;
  if (card === 'move1') dead = walk(d, 1);
  else if (card === 'move2') dead = walk(d, 2);
  else if (card === 'move3') dead = walk(d, 3);
  else if (card === 'back') dead = walk(OPP(d), 1);
  else if (card === 'left') d = (d + 3) % 4;
  else if (card === 'right') d = (d + 1) % 4;
  else if (card === 'uturn') d = OPP(d);
  return { r, c, d, dead };
}

/** Is target in a clear laser line from (r, c) facing d? */
function inLine(m: Match, r: number, c: number, d: number, self: Robot, target: Robot): boolean {
  if (m.has(self, 'rail')) {
    if (d === 0 || d === 2) return target.c === c && (d === 0 ? target.r < r : target.r > r);
    return target.r === r && (d === 3 ? target.c < c : target.c > c);
  }
  const b = m.board;
  let cr = r, cc = c;
  for (let i = 0; i < 30; i++) {
    const cell = cellAt(b, cr, cc);
    if (!cell || wallBlocked(b, cell, d)) return false;
    cr += DIRS[d].dr; cc += DIRS[d].dc;
    if (!cellAt(b, cr, cc) || isSolid(b, cr, cc)) return false;
    if (target.r === cr && target.c === cc) return true;
    if (m.robotAt(cr, cc, self)) return false;
  }
  return false;
}

/** Danger of standing on a tile at the next register: belts towards a pit or the edge, board laser lines. */
function tileRisk(m: Match, r: number, c: number): number {
  const b = m.board, cell = cellAt(b, r, c);
  if (!cell) return 100;
  let risk = 0;
  if (cell.type === 'conv') {
    const n = cellAt(b, r + DIRS[cell.dir].dr, c + DIRS[cell.dir].dc);
    if (!n || n.type === 'pit') risk += 30;
    else risk += 1;
  }
  for (const em of b.emitters) {
    const d = OPP(em.emit!);
    if (d % 2 === 0 ? em.c === c && (d === 2 ? r >= em.r : r <= em.r) : em.r === r && (d === 1 ? c >= em.c : c <= em.c)) risk += 2;
  }
  if (cell.type === 'energy' && !m.drained.has(r * b.cols + c)) risk -= 6;
  if (cell.type === 'wrench') risk -= 2;
  return risk;
}

/**
 * Steps from every tile to the nearest firing position on the target: tiles in
 * the target's row or column with a clear line to it. Multi-source BFS over
 * walkable tiles (walls, crates, pits and the antenna respected).
 */
export function firingField(m: Match, target: Robot, hover: boolean): Int16Array {
  const b = m.board, n = b.cols * b.rows, dist = new Int16Array(n).fill(999);
  const q: number[] = [];
  for (let d = 0; d < 4; d++) {
    let cell = cellAt(b, target.r, target.c)!;
    for (;;) {
      if (wallBlocked(b, cell, d)) break;
      const nx = cellAt(b, cell.r + DIRS[d].dr, cell.c + DIRS[d].dc);
      if (!nx || isSolid(b, nx.r, nx.c)) break;
      if (nx.type !== 'pit' || hover) { const i = nx.r * b.cols + nx.c; if (dist[i] > 0) { dist[i] = 0; q.push(i); } }
      cell = nx;
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], cell = b.cells[i];
    for (let d = 0; d < 4; d++) {
      if (wallBlocked(b, cell, d)) continue;
      const nx = cellAt(b, cell.r + DIRS[d].dr, cell.c + DIRS[d].dc);
      if (!nx || isSolid(b, nx.r, nx.c) || (nx.type === 'pit' && !hover)) continue;
      const j = nx.r * b.cols + nx.c;
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  return dist;
}

export class Bots {
  private next = new Map<number, number>();
  private want = new Map<number, string[]>();
  /** classic: the programming window (Match.progStart) each bot last programmed */
  private planned = new Map<number, number>();
  constructor(private m: Match, private brain: BotBrain = { think: 0.45, skill: 0.85 }) {}

  update(): void {
    const m = this.m;
    if (m.over) return;
    // classic shop phase: the clock is frozen, so bots shop right away
    if (m.phase === 'shop') { for (const rb of m.robots) if (rb.bot && !rb.out) this.shop(rb); return; }
    if (m.classic) {
      // classic: think for a moment once programming opens, then fill every register
      if (m.phase !== 'program' || m.tickT < this.brain.think) return;
      for (const rb of m.robots) {
        if (!rb.bot || rb.out || !rb.alive || this.planned.get(rb.id) === m.progStart) continue;
        this.planned.set(rb.id, m.progStart);
        this.plan(rb);
      }
      return;
    }
    for (const rb of m.robots) {
      if (!rb.bot || rb.out) continue;
      const due = this.next.get(rb.id) ?? 0;
      if (m.t < due) continue;
      this.next.set(rb.id, m.t + this.brain.think * (0.7 + m.rng.next() * 0.6));
      this.shop(rb);
      if (rb.alive) this.act(rb);
    }
  }

  private shop(rb: Robot): void {
    const m = this.m;
    if (!this.want.has(rb.id)) {
      // every bot gets its own taste in upgrades
      const list = [...UPGRADE_IDS].sort(() => m.rng.next() - 0.5);
      this.want.set(rb.id, ['dbl', 'rocket', ...list.filter(x => x !== 'dbl' && x !== 'rocket' && x !== 'kami')]);
    }
    for (const up of this.want.get(rb.id)!) {
      if (m.has(rb, up)) continue;
      if (rb.energy >= R.upgrades[up].cost) { m.buy(rb.id, up); return; }
      if (R.upgrades[up].cost - rb.energy <= 2) return; // save up for it
    }
  }

  private enemies(rb: Robot): Robot[] { return this.m.robots.filter(o => o !== rb && o.alive); }

  private nearest(rb: Robot, foes: Robot[]): Robot {
    return foes.reduce((a, o) => (Math.abs(o.r - rb.r) + Math.abs(o.c - rb.c) < Math.abs(a.r - rb.r) + Math.abs(a.c - rb.c) ? o : a), foes[0]);
  }

  /** Fire an active upgrade if one would pay off; returns whether one was used. */
  private actives(rb: Robot, target: Robot, foes: Robot[], lined: boolean): boolean {
    const m = this.m;
    for (const up of rb.active) {
      if ((rb.acd[up] ?? 0) > 0) continue;
      if ((up === 'rocket' || up === 'over') && lined) { m.use(rb.id, up); return true; }
      if (up === 'emp' && foes.some(o => Math.abs(o.r - rb.r) + Math.abs(o.c - rb.c) <= 4)) { m.use(rb.id, up); return true; }
      if (up === 'kami' && rb.hp <= 3 && rb.lives > 1 && lined) { m.use(rb.id, up); return true; }
      if (up === 'tele' && !lined && m.rng.next() < 0.3) {
        const spot = this.teleSpot(rb, target, R.upgrades.tele.range ?? 5);
        if (spot && m.use(rb.id, up, spot)) return true;
      }
      if (up === 'rev' && m.rng.next() < 0.05) { m.use(rb.id, up); return true; }
    }
    return false;
  }

  /** classic: program every open register, each card scored from where the cards before it leave the robot. */
  private plan(rb: Robot): void {
    const m = this.m;
    const foes = this.enemies(rb);
    if (!foes.length) { m.lock(rb.id); return; }
    const target = this.nearest(rb, foes);
    this.actives(rb, target, foes, foes.some(o => inLine(m, rb.r, rb.c, rb.d, rb, o)));
    if (!rb.alive) return;
    this.field = firingField(m, target, m.has(rb, 'hover'));
    let at = { r: rb.r, c: rb.c, d: rb.d };
    while (rb.prog.length < m.progN) {
      // an empty register (standing still) is an option too; nothing after it gets programmed
      const lined = foes.some(o => inLine(m, at.r, at.c, at.d, rb, o));
      let best: CardId | null = null, bestAt = at;
      let bestS = this.score(rb, at.r, at.c, at.d, target, foes) + (lined ? 4 : -1.5);
      for (const card of CARD_IDS) {
        if (!m.canProgram(rb, card)) continue;
        const p = preview(m, rb, card, at);
        if (p.dead) continue;
        let s = this.score(rb, p.r, p.c, p.d, target, foes);
        for (const next of CARD_IDS) {
          const q = preview(m, rb, next, p);
          if (!q.dead) s = Math.max(s, this.score(rb, q.r, q.c, q.d, target, foes) - 1);
        }
        s -= (R.classic.cards[card] ?? 0) * 0.3;
        s += (m.rng.next() - 0.5) * (1 - this.brain.skill) * 12;
        if (s > bestS) { bestS = s; best = card; bestAt = p; }
      }
      if (!best) break;
      m.program(rb.id, best);
      at = bestAt;
    }
    m.lock(rb.id);
  }

  private act(rb: Robot): void {
    const m = this.m;
    const foes = this.enemies(rb);
    if (!foes.length) return;
    const target = this.nearest(rb, foes);
    const lined = foes.some(o => inLine(m, rb.r, rb.c, rb.d, rb, o));
    if (this.actives(rb, target, foes, lined)) return;
    if (rb.busyT > 0 || rb.jamT > 0) return;

    // score each playable card, plus standing still
    this.field = firingField(m, target, m.has(rb, 'hover'));
    let best: CardId | null = null;
    let bestS = this.score(rb, rb.r, rb.c, rb.d, target, foes) + (lined ? 4 : -1.5);
    for (const card of CARD_IDS) {
      if (!m.canPlay(rb, card)) continue;
      const p = preview(m, rb, card);
      if (p.dead) continue;
      // two-card look-ahead: a turn now is worth what the move after it opens up
      let s = this.score(rb, p.r, p.c, p.d, target, foes);
      for (const next of CARD_IDS) {
        const q = preview(m, rb, next, p);
        if (!q.dead) s = Math.max(s, this.score(rb, q.r, q.c, q.d, target, foes) - 1);
      }
      s -= R.cards[card].cd * 0.4; // base cooldowns: the pace scales them all alike
      s += (m.rng.next() - 0.5) * (1 - this.brain.skill) * 12;
      if (s > bestS) { bestS = s; best = card; }
    }
    if (best) m.play(rb.id, best);
  }

  private field: Int16Array | null = null;

  private score(rb: Robot, r: number, c: number, d: number, target: Robot, foes: Robot[]): number {
    const m = this.m;
    let s = -tileRisk(m, r, c) * 2;
    if (this.field) s -= Math.min(30, this.field[r * m.board.cols + c]) * 2.2; // get to a firing position
    for (const o of foes) {
      if (inLine(m, r, c, d, rb, o)) s += 14 + (o === target ? 4 : 0) + (o.hp <= 2 ? 6 : 0);
      // being in someone else's line hurts, unless we fire back
      if (inLine(m, o.r, o.c, o.d, o, { ...rb, r, c } as Robot)) s -= 3;
    }
    const dr = target.r - r, dc = target.c - c;
    s -= (Math.abs(dr) + Math.abs(dc)) * 0.25;
    // face towards the target's half of the board
    const want = Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? 1 : 3) : (dr > 0 ? 2 : 0);
    if (d === want) s += 2.5;
    if (m.spec(rb).pick && r + DIRS[d].dr === target.r && c + DIRS[d].dc === target.c) s += 8;
    // energy pull when we can't afford anything
    for (const cell of m.board.cells) {
      if (cell.type !== 'energy' || m.drained.has(cell.r * m.board.cols + cell.c)) continue;
      const dist = Math.abs(cell.r - r) + Math.abs(cell.c - c);
      if (dist <= 3) s += (3 - dist) * (rb.energy < 3 ? 1.4 : 0.5);
    }
    if (rb.hp <= 3) for (const cell of m.board.cells) if (cell.type === 'wrench') s -= (Math.abs(cell.r - r) + Math.abs(cell.c - c)) * 0.3;
    return s;
  }

  private teleSpot(rb: Robot, target: Robot, range: number): { r: number; c: number } | null {
    const m = this.m, b = m.board;
    let best: { r: number; c: number } | null = null, bs = -1e9;
    for (const cell of b.cells) {
      if (Math.abs(cell.r - rb.r) + Math.abs(cell.c - rb.c) > range) continue;
      if (cell.type === 'pit' && !m.has(rb, 'hover')) continue;
      if (isSolid(b, cell.r, cell.c) || m.robotAt(cell.r, cell.c)) continue;
      const dr = target.r - cell.r, dc = target.c - cell.c;
      const d = Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? 1 : 3) : (dr > 0 ? 2 : 0);
      const s = (inLine(m, cell.r, cell.c, rb.d, rb, target) ? 20 : 0) + (d === rb.d ? 3 : 0) - tileRisk(m, cell.r, cell.c) * 2 - Math.min(Math.abs(dr), Math.abs(dc)) * 2;
      if (s > bs) { bs = s; best = { r: cell.r, c: cell.c }; }
    }
    return bs > 5 ? best : null;
  }
}
