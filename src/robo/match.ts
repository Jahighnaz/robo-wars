// A live Robo Wars match. Robo Rally rules, played in real time:
// - program cards (Move 1/2/3, Back up, Turn, U-turn) are played whenever they
//   are off cooldown, instead of being locked into five registers;
// - the factory still runs in registers: every `tick` seconds the board
//   activates in the reference order (blue belts x2, green belts, push panels,
//   gears, board lasers, robot lasers, energy) and repair wrenches mend 1;
// - lasers fire on the register, upgrades are bought with energy, and the
//   heavier the weapon the longer its cooldown.
// Headless and seeded: the host simulates, clients only render snapshots.
import { Rng } from '../core/rng';
import { cellAt, DIRS, flipBelts, generateBoard, isSolid, OPP, wallBlocked, type Board, type Cell } from './board';
import { CARD_IDS, R, TEAM_COLORS, type CardId, type ChassisDef } from './data';

/** Register length in seconds; card and upgrade cooldowns, jams and respawns scale with it. */
export interface MatchOptions {
  tick?: number;
  /** equal specs (crew PvP): the chassis is only a look; same hull, cooldowns and no perks for everyone */
  equal?: boolean;
  /**
   * classic: one card per register, cooldowns counted in registers, and a shop
   * phase at the start of every round (5 registers) that the host ends.
   */
  classic?: boolean;
}

export interface PlayerSpec { pid: string; name: string; chassis: string; bot?: boolean; color?: string }

export interface Robot {
  id: number; pid: string; name: string; chassis: string; color: string; bot: boolean;
  r: number; c: number; d: number;
  hp: number; maxHp: number; lives: number; energy: number;
  /** on the board (false while waiting to respawn) */
  alive: boolean;
  /** out of lives */
  out: boolean;
  respawnT: number; guardT: number; jamT: number; busyT: number;
  cds: Record<CardId, number>;
  passive: string[]; active: string[]; acd: Record<string, number>;
  shieldUp: boolean;
  kills: number; deaths: number; dmg: number;
  lastHitBy: number; lastHitT: number;
  prio: number;
  /** classic: the register count when this robot last played a card */
  played: number;
}

export type MatchEvent =
  | { k: 'move'; id: number; push?: boolean }
  | { k: 'turn'; id: number }
  | { k: 'beam'; from: [number, number]; to: [number, number]; color: string; kind: 'laser' | 'rail' | 'board' | 'over' | 'reflect'; dbl?: boolean }
  | { k: 'rocket'; from: [number, number]; to: [number, number]; color: string }
  | { k: 'blast'; r: number; c: number; size: number; color: string }
  | { k: 'hit'; id: number; n: number }
  | { k: 'shield'; id: number }
  | { k: 'fall'; id: number }
  | { k: 'wreck'; id: number }
  | { k: 'kill'; killer: number; victim: number }
  | { k: 'respawn'; id: number }
  | { k: 'register'; n: number }
  | { k: 'belt' } | { k: 'gear' } | { k: 'push' }
  | { k: 'energy'; id: number; n: number }
  | { k: 'heal'; id: number }
  | { k: 'pick'; id: number; target: number }
  | { k: 'emp'; id: number; r: number; c: number; radius: number }
  | { k: 'tele'; id: number; from: [number, number] }
  | { k: 'buy'; id: number; up: string }
  | { k: 'reverse'; on: boolean }
  | { k: 'shop'; n: number }
  | { k: 'round'; n: number }
  | { k: 'over'; winner: number };

/** beam end points are in cell units: (row, col) of the cell centre, or of the edge it stopped at */
type Pt = [number, number];
const centre = (r: number, c: number): Pt => [r + 0.5, c + 0.5];
const edge = (cell: { r: number; c: number }, d: number): Pt => [cell.r + 0.5 + DIRS[d].dr * 0.5, cell.c + 0.5 + DIRS[d].dc * 0.5];

export class Match {
  readonly board: Board;
  readonly robots: Robot[] = [];
  readonly rng: Rng;
  t = 0;
  register = 1;
  tickT = 0;
  over = false;
  winner = -1;
  /** energy tiles drained (cell index → registers until it recharges) */
  drained = new Map<number, number>();
  revT = 0;
  events: MatchEvent[] = [];
  /** seconds per register, and how much slower than the tuned base pace (robo.json match.tick) */
  readonly tick: number;
  readonly pace: number;
  readonly timeLimit: number;
  readonly equal: boolean;
  readonly classic: boolean;
  /** registers run so far; round = 1 + floor(regCount / 5) */
  regCount = 0;
  /** classic: 'shop' freezes the factory until the host starts the round */
  phase: 'shop' | 'run' = 'run';

  constructor(readonly seed: number, players: PlayerSpec[], opts: MatchOptions = {}) {
    this.tick = Math.max(1, opts.tick ?? R.match.tick);
    this.pace = this.tick / R.match.tick;
    this.equal = !!opts.equal;
    this.classic = !!opts.classic;
    if (this.classic) this.phase = 'shop';
    // a long register needs a longer clock: at least 45 registers
    this.timeLimit = Math.max(R.match.timeLimit, Math.round(45 * this.tick));
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.board = generateBoard(seed);
    players.slice(0, this.board.starts.length).forEach((p, i) => this.addRobot(p, i));
    this.prioritise();
  }

  private addRobot(p: PlayerSpec, i: number): void {
    const ch = this.specOf(R.chassis[p.chassis] ? p.chassis : 'clank');
    const st = this.board.starts[i];
    const cds = {} as Record<CardId, number>;
    for (const k of CARD_IDS) cds[k] = 0;
    const rb: Robot = {
      id: i, pid: p.pid, name: p.name, chassis: R.chassis[p.chassis] ? p.chassis : 'clank', color: p.color ?? TEAM_COLORS[i % TEAM_COLORS.length], bot: !!p.bot,
      r: st.r, c: st.c, d: this.faceInwards(st),
      hp: ch.hp, maxHp: ch.hp, lives: R.match.lives, energy: R.match.startEnergy,
      alive: true, out: false, respawnT: 0, guardT: R.match.spawnGuard, jamT: 0, busyT: 0,
      cds, passive: [], active: [], acd: {}, shieldUp: true,
      kills: 0, deaths: 0, dmg: 0, lastHitBy: -1, lastHitT: -99, prio: i + 1, played: -1,
    };
    for (const u of ch.starts) this.install(rb, u);
    this.robots.push(rb);
  }

  private faceInwards(cell: { r: number; c: number }): number {
    const dr = this.board.rows / 2 - (cell.r + 0.5), dc = this.board.cols / 2 - (cell.c + 0.5);
    return Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? 1 : 3) : (dr > 0 ? 2 : 0);
  }

  // ------------------------------------------------------------ queries
  robotAt(r: number, c: number, except?: Robot): Robot | undefined {
    return this.robots.find(o => o !== except && o.alive && o.r === r && o.c === c);
  }
  has(rb: Robot, up: string): boolean { return rb.passive.includes(up) || rb.active.includes(up); }
  cell(rb: { r: number; c: number }): Cell { return cellAt(this.board, rb.r, rb.c)!; }
  /** a player's place: still in, then kills, lives, hull */
  standings(): Robot[] {
    return [...this.robots].sort((a, b) => Number(a.out) - Number(b.out) || b.kills - a.kills || b.lives - a.lives || b.hp - a.hp || a.deaths - b.deaths);
  }

  /** Raycast like the reference board: stops at walls, solid tiles, the edge and (optionally) the first robot. */
  ray(r: number, c: number, d: number, skip: Robot | null, includeStart = false): { end: Pt; robot: Robot | null } {
    const b = this.board;
    let cur = cellAt(b, r, c)!;
    if (includeStart) { const o = this.robotAt(r, c, skip ?? undefined); if (o) return { end: centre(r, c), robot: o }; }
    for (;;) {
      if (wallBlocked(b, cur, d)) return { end: edge(cur, d), robot: null };
      const nxt = cellAt(b, cur.r + DIRS[d].dr, cur.c + DIRS[d].dc);
      if (!nxt) return { end: edge(cur, d), robot: null };
      if (isSolid(b, nxt.r, nxt.c)) return { end: edge(cur, d), robot: null };
      const o = this.robotAt(nxt.r, nxt.c, skip ?? undefined);
      if (o) return { end: centre(nxt.r, nxt.c), robot: o };
      cur = nxt;
    }
  }
  /** Through everything (rail gun, overload): every robot in the line to the edge. */
  rayAll(r: number, c: number, d: number, skip: Robot): { end: Pt; list: Robot[] } {
    const list: Robot[] = [];
    let cr = r, cc = c, last = cellAt(this.board, r, c)!;
    for (;;) {
      const n = cellAt(this.board, cr + DIRS[d].dr, cc + DIRS[d].dc);
      if (!n) break;
      last = n;
      const o = this.robotAt(n.r, n.c, skip);
      if (o) list.push(o);
      cr = n.r; cc = n.c;
    }
    return { end: edge(last, d), list };
  }

  // ------------------------------------------------------------ player actions
  /** The rules a robot plays by: its chassis, or the standard robot in an equal-specs battle. */
  specOf(chassis: string): ChassisDef {
    const ch = R.chassis[chassis] ?? R.chassis.clank;
    return this.equal ? { ...ch, hp: R.standard.hp, cdMul: 1, starts: [], heavy: false, ram: 0, pick: 0, miner: false } : ch;
  }
  spec(rb: Robot): ChassisDef { return this.specOf(rb.chassis); }
  /** live: seconds; classic: registers */
  cardCd(rb: Robot, card: CardId): number { return this.classic ? R.classic.cards[card] ?? 0 : R.cards[card].cd * this.spec(rb).cdMul * this.pace; }
  upgradeCd(up: string): number { const cd = R.upgrades[up].cd ?? 0; return this.classic ? Math.ceil(cd / R.match.tick) : cd * this.pace; }
  get round(): number { return 1 + Math.floor(this.regCount / 5); }
  /** classic: this robot already used its card this register */
  spent(rb: Robot): boolean { return this.classic && rb.played === this.regCount; }
  canBuy(): boolean { return !this.classic || this.phase === 'shop'; }

  /** classic: the host ends the shop phase and the round runs. */
  ready(id: number): boolean {
    if (!this.classic || this.phase !== 'shop' || id !== 0) return false;
    this.phase = 'run';
    this.emit({ k: 'round', n: this.round });
    return true;
  }

  canPlay(rb: Robot, card: CardId): boolean {
    return !this.over && this.phase === 'run' && rb.alive && !rb.out && rb.busyT <= 0 && rb.jamT <= 0 && rb.cds[card] <= 0 && !this.spent(rb);
  }

  play(id: number, card: CardId): boolean {
    const rb = this.robots[id];
    if (!rb || !CARD_IDS.includes(card) || !this.canPlay(rb, card)) return false;
    let steps = 0;
    switch (card) {
      case 'move1': case 'move2': case 'move3': {
        const n = card === 'move1' ? 1 : card === 'move2' ? 2 : 3;
        for (let i = 0; i < n && rb.alive; i++) { if (!this.step(rb, rb.d, rb)) break; steps++; }
        break;
      }
      case 'back': if (this.step(rb, OPP(rb.d), rb)) steps = 1; break;
      case 'left': rb.d = (rb.d + 3) % 4; this.emit({ k: 'turn', id }); break;
      case 'right': rb.d = (rb.d + 1) % 4; this.emit({ k: 'turn', id }); break;
      case 'uturn': rb.d = OPP(rb.d); this.emit({ k: 'turn', id }); break;
    }
    rb.cds[card] = this.cardCd(rb, card);
    rb.played = this.regCount;
    rb.busyT = Math.max(0.12, steps * R.match.stepTime);
    this.prioritise();
    return true;
  }

  /** Buy an upgrade with energy (any time, like picking up an upgrade card). */
  buy(id: number, up: string): boolean {
    const rb = this.robots[id], u = R.upgrades[up];
    if (!rb || !u || rb.out || this.over || !this.canBuy() || this.has(rb, up) || rb.energy < u.cost) return false;
    const list = u.kind === 'passive' ? rb.passive : rb.active;
    if (list.length >= (u.kind === 'passive' ? R.slots.passive : R.slots.active)) return false;
    rb.energy -= u.cost;
    this.install(rb, up);
    this.emit({ k: 'buy', id, up });
    return true;
  }

  private install(rb: Robot, up: string): void {
    const u = R.upgrades[up];
    (u.kind === 'passive' ? rb.passive : rb.active).push(up);
    if (u.kind === 'active') rb.acd[up] = 0;
  }

  /** Fire an active upgrade. Teleport needs a target tile. */
  use(id: number, up: string, target?: { r: number; c: number }): boolean {
    const rb = this.robots[id], u = R.upgrades[up];
    if (!rb || !u || u.kind !== 'active' || !rb.active.includes(up) || !rb.alive || rb.out || this.over || this.phase !== 'run' || (rb.acd[up] ?? 0) > 0 || rb.busyT > 0) return false;
    switch (up) {
      case 'rocket': this.rocket(rb, u.dmg ?? 2); break;
      case 'emp': this.empBlast(rb, u.radius ?? 6, (u.jam ?? 4) * this.pace); break;
      case 'tele': if (!target || !this.teleport(rb, target, u.range ?? 5)) return false; break;
      case 'over': this.overload(rb, u.dmg ?? 3); break;
      case 'kami': this.kamikaze(rb, u.dmg ?? 3); break;
      case 'rev': this.reverse((u.dur ?? 8) * this.pace); break;
      default: return false;
    }
    if (u.once) rb.active = rb.active.filter(x => x !== up);
    else rb.acd[up] = this.upgradeCd(up);
    rb.busyT = Math.max(rb.busyT, 0.25);
    this.prioritise();
    return true;
  }

  // ------------------------------------------------------------ movement
  /** One step in direction d, pushing robots in the way (Robo Rally pushing). Returns whether rb moved. */
  step(rb: Robot, d: number, mover: Robot | null): boolean {
    const b = this.board, cell = this.cell(rb);
    if (wallBlocked(b, cell, d)) return false;
    const nr = rb.r + DIRS[d].dr, nc = rb.c + DIRS[d].dc;
    const n = cellAt(b, nr, nc);
    if (n && isSolid(b, nr, nc)) return false;
    if (n) {
      const occ = this.robotAt(nr, nc, rb);
      if (occ) {
        if (!this.step(occ, d, mover)) return false;
        this.emit({ k: 'move', id: occ.id, push: true });
        const ram = mover === rb ? this.spec(rb).ram : 0;
        if (ram) this.damage(occ, ram, rb);
      }
    }
    rb.r = nr; rb.c = nc;
    this.emit({ k: 'move', id: rb.id });
    if (!n) { this.destroy(rb, 'fall'); return true; }
    this.fallCheck(rb);
    return true;
  }

  private fallCheck(rb: Robot): void {
    if (rb.alive && this.cell(rb).type === 'pit' && !this.has(rb, 'hover')) this.destroy(rb, 'fall');
  }

  /** Shove up to n cells; stops at walls, solid tiles and robots. Heavy chassis don't budge. */
  private knockback(rb: Robot, d: number, n: number): void {
    if (this.spec(rb).heavy) return;
    for (let i = 0; i < n && rb.alive; i++) {
      const cell = this.cell(rb);
      if (wallBlocked(this.board, cell, d)) break;
      const nr = rb.r + DIRS[d].dr, nc = rb.c + DIRS[d].dc;
      const nx = cellAt(this.board, nr, nc);
      if (nx && (isSolid(this.board, nr, nc) || this.robotAt(nr, nc, rb))) break;
      rb.r = nr; rb.c = nc;
      this.emit({ k: 'move', id: rb.id, push: true });
      if (!nx) { this.destroy(rb, 'fall'); return; }
      this.fallCheck(rb);
    }
  }

  // ------------------------------------------------------------ damage
  damage(target: Robot, n: number, src: Robot | null): void {
    if (!target.alive || target.guardT > 0 || n <= 0) return;
    if (target.shieldUp && this.has(target, 'shield')) {
      target.shieldUp = false;
      this.emit({ k: 'shield', id: target.id });
      return;
    }
    target.hp -= n;
    if (src && src !== target) { target.lastHitBy = src.id; target.lastHitT = this.t; src.dmg += n; }
    this.emit({ k: 'hit', id: target.id, n });
    if (target.hp <= 0) this.destroy(target, 'wreck');
  }

  destroy(rb: Robot, how: 'fall' | 'wreck' | 'self'): void {
    if (!rb.alive) return;
    rb.alive = false;
    rb.hp = 0;
    rb.deaths++;
    rb.lives--;
    rb.out = rb.lives <= 0;
    rb.respawnT = R.match.respawn * Math.sqrt(this.pace);
    this.emit({ k: how === 'fall' ? 'fall' : 'wreck', id: rb.id });
    const killer = how !== 'self' && rb.lastHitBy >= 0 && this.t - rb.lastHitT <= R.match.creditWindow ? this.robots[rb.lastHitBy] : null;
    if (killer && killer !== rb) {
      killer.kills++;
      killer.energy += R.match.killEnergy;
      this.emit({ k: 'kill', killer: killer.id, victim: rb.id });
    }
    rb.lastHitBy = -1;
  }

  private respawn(rb: Robot): void {
    // the free start furthest from the nearest enemy
    let best: Cell | null = null, bestD = -1;
    for (const s of this.board.starts) {
      if (this.robotAt(s.r, s.c)) continue;
      let dmin = 99;
      for (const o of this.robots) if (o !== rb && o.alive) dmin = Math.min(dmin, Math.abs(o.r - s.r) + Math.abs(o.c - s.c));
      if (dmin > bestD) { bestD = dmin; best = s; }
    }
    if (!best) { rb.respawnT = 0.5; return; }
    rb.r = best.r; rb.c = best.c; rb.d = this.faceInwards(best);
    rb.hp = rb.maxHp; rb.alive = true; rb.guardT = R.match.spawnGuard; rb.shieldUp = true; rb.jamT = 0;
    this.emit({ k: 'respawn', id: rb.id });
  }

  // ------------------------------------------------------------ weapons
  private laserDamage(rb: Robot): number { return R.match.laserDmg + (this.has(rb, 'dbl') ? 1 : 0); }

  fireLaser(rb: Robot): void {
    const dirs = [rb.d];
    if (this.has(rb, 'rear')) dirs.push(OPP(rb.d));
    const dmg = this.laserDamage(rb), rail = this.has(rb, 'rail');
    for (const d of dirs) {
      if (rail) {
        const ray = this.rayAll(rb.r, rb.c, d, rb);
        this.emit({ k: 'beam', from: centre(rb.r, rb.c), to: ray.end, color: rb.color, kind: 'rail', dbl: dmg > 1 });
        for (const t of ray.list) this.damage(t, dmg, rb);
      } else {
        const ray = this.ray(rb.r, rb.c, d, rb);
        this.emit({ k: 'beam', from: centre(rb.r, rb.c), to: ray.end, color: rb.color, kind: 'laser', dbl: dmg > 1 });
        const t = ray.robot;
        if (!t) continue;
        // Mirror Plating: a laser from the front bounces back
        if (this.has(t, 'jedi') && t.guardT <= 0 && t.d === OPP(d)) {
          this.emit({ k: 'beam', from: centre(t.r, t.c), to: centre(rb.r, rb.c), color: t.color, kind: 'reflect' });
          this.damage(rb, dmg, t);
        } else this.damage(t, dmg, rb);
      }
    }
  }

  private rocket(rb: Robot, dmg: number): void {
    const ray = this.ray(rb.r, rb.c, rb.d, rb);
    this.emit({ k: 'rocket', from: centre(rb.r, rb.c), to: ray.end, color: rb.color });
    const tr = Math.floor(ray.end[0]), tc = Math.floor(ray.end[1]);
    this.emit({ k: 'blast', r: tr, c: tc, size: 1.4, color: '#ff8a2a' });
    if (ray.robot) { this.damage(ray.robot, dmg, rb); this.knockback(ray.robot, rb.d, 1); }
    for (const o of this.robots) {
      if (o === rb || o === ray.robot || !o.alive) continue;
      if (Math.max(Math.abs(o.r - tr), Math.abs(o.c - tc)) <= 1) this.damage(o, 1, rb);
    }
  }

  private empBlast(rb: Robot, radius: number, jam: number): void {
    this.emit({ k: 'emp', id: rb.id, r: rb.r, c: rb.c, radius });
    for (const o of this.robots) {
      if (o === rb || !o.alive || Math.abs(o.r - rb.r) + Math.abs(o.c - rb.c) > radius) continue;
      o.jamT = Math.max(o.jamT, jam);
      o.shieldUp = false;
      o.lastHitBy = rb.id; o.lastHitT = this.t;
    }
  }

  private teleport(rb: Robot, tg: { r: number; c: number }, range: number): boolean {
    const cell = cellAt(this.board, tg.r, tg.c);
    if (!cell || isSolid(this.board, tg.r, tg.c) || this.robotAt(tg.r, tg.c) || Math.abs(tg.r - rb.r) + Math.abs(tg.c - rb.c) > range) return false;
    const from: Pt = [rb.r, rb.c];
    rb.r = tg.r; rb.c = tg.c;
    this.emit({ k: 'tele', id: rb.id, from });
    this.fallCheck(rb);
    return true;
  }

  private overload(rb: Robot, dmg: number): void {
    const ray = this.rayAll(rb.r, rb.c, rb.d, rb);
    this.emit({ k: 'beam', from: centre(rb.r, rb.c), to: ray.end, color: rb.color, kind: 'over' });
    const hits = ray.list.filter(t => !(t.shieldUp && this.has(t, 'shield')));
    for (const t of ray.list) this.damage(t, dmg, rb);
    hits.sort((a, b) => (Math.abs(b.r - rb.r) + Math.abs(b.c - rb.c)) - (Math.abs(a.r - rb.r) + Math.abs(a.c - rb.c)));
    for (const t of hits) this.knockback(t, rb.d, 3);
  }

  private kamikaze(rb: Robot, dmg: number): void {
    const b = this.board, d = rb.d;
    for (;;) {
      const cell = this.cell(rb);
      if (wallBlocked(b, cell, d)) break;
      const nr = rb.r + DIRS[d].dr, nc = rb.c + DIRS[d].dc;
      const n = cellAt(b, nr, nc);
      if (!n) { rb.r = nr; rb.c = nc; this.emit({ k: 'move', id: rb.id }); break; }
      if (isSolid(b, nr, nc)) break;
      const o = this.robotAt(nr, nc, rb);
      if (o) {
        this.damage(o, dmg, rb);
        if (o.alive) {
          const n2 = cellAt(b, nr + DIRS[d].dr, nc + DIRS[d].dc);
          if (n2 && !wallBlocked(b, n, d) && !isSolid(b, n2.r, n2.c) && !this.robotAt(n2.r, n2.c, o)) { o.r = n2.r; o.c = n2.c; this.emit({ k: 'move', id: o.id, push: true }); this.fallCheck(o); }
          else this.knockback(o, (d + 1) % 4, 1);
        }
      }
      rb.r = nr; rb.c = nc;
      this.emit({ k: 'move', id: rb.id });
    }
    const onBoard = !!cellAt(b, rb.r, rb.c);
    if (onBoard) {
      this.emit({ k: 'blast', r: rb.r, c: rb.c, size: 2.4, color: rb.color });
      for (const o of this.robots) {
        if (o === rb || !o.alive) continue;
        const dr = o.r - rb.r, dc = o.c - rb.c;
        if (Math.max(Math.abs(dr), Math.abs(dc)) > 1) continue;
        this.damage(o, dmg, rb);
        if (o.alive) this.knockback(o, Math.abs(dr) >= Math.abs(dc) ? (dr > 0 ? 2 : 0) : (dc > 0 ? 1 : 3), 1);
      }
    }
    this.destroy(rb, onBoard ? 'self' : 'fall');
  }

  private reverse(dur: number): void {
    if (this.revT <= 0) { flipBelts(this.board); this.emit({ k: 'reverse', on: true }); }
    this.revT = Math.max(this.revT, dur);
  }

  // ------------------------------------------------------------ the factory: one register
  private prioritise(): void {
    const a = this.board.antenna;
    const list = this.robots.map(rb => {
      let ang = Math.atan2(rb.c - a.c, -(rb.r - a.r));
      if (ang < 0) ang += Math.PI * 2;
      return { rb, d: Math.abs(rb.r - a.r) + Math.abs(rb.c - a.c), ang };
    });
    list.sort((x, y) => x.d - y.d || x.ang - y.ang);
    list.forEach((e, i) => { e.rb.prio = i + 1; });
  }

  private beltPhase(kind: 'g' | 'b', steps: number): void {
    const b = this.board;
    for (let s = 0; s < steps; s++) {
      const props: { rb: Robot; dest: Cell | null; d: number }[] = [];
      for (const rb of this.robots) {
        if (!rb.alive) continue;
        const cell = this.cell(rb);
        if (cell.type !== 'conv' || cell.kind !== kind) continue;
        const d = cell.dir;
        if (wallBlocked(b, cell, d)) continue;
        const dest = cellAt(b, rb.r + DIRS[d].dr, rb.c + DIRS[d].dc);
        if (dest && isSolid(b, dest.r, dest.c)) continue;
        props.push({ rb, dest, d });
      }
      // conflicts as in the reference: blocked by a robot that stays, same destination, or a swap
      const act = new Set(props);
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of [...act]) {
          if (!act.has(m) || !m.dest) continue;
          const occ = this.robotAt(m.dest.r, m.dest.c, m.rb);
          if (occ && ![...act].some(x => x.rb === occ)) { act.delete(m); changed = true; continue; }
          const same = [...act].filter(x => x !== m && x.dest === m.dest);
          if (same.length) { act.delete(m); for (const x of same) act.delete(x); changed = true; continue; }
          const sw = [...act].find(x => x !== m && x.dest && x.rb.r === m.dest!.r && x.rb.c === m.dest!.c && x.dest.r === m.rb.r && x.dest.c === m.rb.c);
          if (sw) { act.delete(m); act.delete(sw); changed = true; }
        }
      }
      if (!act.size) continue;
      this.emit({ k: 'belt' });
      for (const m of act) {
        m.rb.r += DIRS[m.d].dr; m.rb.c += DIRS[m.d].dc;
        this.emit({ k: 'move', id: m.rb.id, push: true });
        if (!m.dest) { this.destroy(m.rb, 'fall'); continue; }
        if (m.dest.type === 'conv' && m.dest.turn) { m.rb.d = m.dest.turn === 'l' ? (m.rb.d + 3) % 4 : (m.rb.d + 1) % 4; }
      }
      for (const m of act) if (m.dest) this.fallCheck(m.rb);
    }
  }

  private pushPhase(): void {
    for (const rb of this.robots) {
      if (!rb.alive) continue;
      const cell = this.cell(rb);
      if (!cell.pusher || !cell.pusher.ph.includes(this.register)) continue;
      this.emit({ k: 'push' });
      this.step(rb, OPP(cell.pusher.side), null);
    }
  }

  private runRegister(): void {
    const b = this.board;
    this.emit({ k: 'register', n: this.register });
    for (const rb of this.robots) if (rb.alive) rb.shieldUp = true;
    this.beltPhase('b', 2);
    this.beltPhase('g', 1);
    this.pushPhase();
    // gears
    let geared = false;
    for (const rb of this.robots) {
      if (!rb.alive) continue;
      const g = this.cell(rb).gear;
      if (g) { rb.d = g === 'cw' ? (rb.d + 1) % 4 : (rb.d + 3) % 4; geared = true; this.emit({ k: 'turn', id: rb.id }); }
    }
    if (geared) this.emit({ k: 'gear' });
    // board lasers (they hit a robot standing on the emitter too)
    for (const em of b.emitters) {
      const d = OPP(em.emit!);
      const ray = this.ray(em.r, em.c, d, null, true);
      this.emit({ k: 'beam', from: edge(em, em.emit!), to: ray.end, color: '#ff2b2b', kind: 'board' });
      if (ray.robot) this.damage(ray.robot, R.match.boardLaserDmg, null);
    }
    // robot lasers, in priority order; pickaxes swing at the robot in front
    this.prioritise();
    for (const rb of [...this.robots].sort((x, y) => x.prio - y.prio)) {
      if (!rb.alive) continue;
      this.fireLaser(rb);
      const pick = this.spec(rb).pick;
      if (pick && rb.alive && !wallBlocked(b, this.cell(rb), rb.d)) {
        const o = this.robotAt(rb.r + DIRS[rb.d].dr, rb.c + DIRS[rb.d].dc, rb);
        if (o) { this.emit({ k: 'pick', id: rb.id, target: o.id }); this.damage(o, pick, rb); }
      }
    }
    // energy and repairs
    for (const rb of this.robots) {
      if (!rb.alive) continue;
      const cell = this.cell(rb), idx = cell.r * b.cols + cell.c;
      if (cell.type === 'energy' && (!this.drained.has(idx) || this.register === 5)) {
        const n = this.spec(rb).miner ? 2 : 1;
        rb.energy += n;
        this.drained.set(idx, this.classic ? R.classic.energyRecharge : R.match.energyRecharge);
        this.emit({ k: 'energy', id: rb.id, n });
      }
      if (cell.type === 'wrench' && rb.hp < rb.maxHp) { rb.hp++; this.emit({ k: 'heal', id: rb.id }); }
    }
    for (const [idx, n] of this.drained) { if (n <= 1) this.drained.delete(idx); else this.drained.set(idx, n - 1); }
    this.register = (this.register % 5) + 1;
    this.regCount++;
    if (this.classic) {
      // cooldowns count down in registers; a new round opens the shop
      for (const rb of this.robots) {
        for (const k of CARD_IDS) if (rb.cds[k] > 0) rb.cds[k]--;
        for (const k in rb.acd) if (rb.acd[k] > 0) rb.acd[k]--;
      }
      if (this.register === 1) { this.phase = 'shop'; this.emit({ k: 'shop', n: this.round }); }
    }
  }

  // ------------------------------------------------------------ main loop
  update(dt: number): void {
    if (this.over || this.phase === 'shop') return;
    this.t += dt;
    for (const rb of this.robots) {
      if (!this.classic) {
        for (const k of CARD_IDS) if (rb.cds[k] > 0) rb.cds[k] = Math.max(0, rb.cds[k] - dt);
        for (const k in rb.acd) if (rb.acd[k] > 0) rb.acd[k] = Math.max(0, rb.acd[k] - dt);
      }
      if (rb.busyT > 0) rb.busyT -= dt;
      if (rb.jamT > 0) rb.jamT -= dt;
      if (rb.guardT > 0) rb.guardT -= dt;
      if (!rb.alive && !rb.out) { rb.respawnT -= dt; if (rb.respawnT <= 0) this.respawn(rb); }
    }
    if (this.revT > 0) { this.revT -= dt; if (this.revT <= 0) { flipBelts(this.board); this.emit({ k: 'reverse', on: false }); } }
    this.tickT += dt;
    if (this.tickT >= this.tick) { this.tickT -= this.tick; this.runRegister(); }
    const left = this.robots.filter(r => !r.out);
    if ((this.robots.length > 1 && left.length <= 1) || this.t >= this.timeLimit) {
      this.over = true;
      this.winner = this.standings()[0]?.id ?? -1;
      this.emit({ k: 'over', winner: this.winner });
    }
  }

  emit(e: MatchEvent): void { this.events.push(e); if (this.events.length > 400) this.events.splice(0, 100); }
  /** Hand the events since the last call to the renderer / network. */
  drain(): MatchEvent[] { const e = this.events; this.events = []; return e; }
}
