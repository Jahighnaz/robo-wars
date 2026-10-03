// One run: movement, director, combat, enemies, loot. Pure simulation, no DOM
// or canvas, so it runs headless in tests and the balance bot.
import { B, DCOL, DTYPES, EB, isCab, isUnlocked, PERKS, RES, RES_KEYS, T, WORLDS, type DType, type PerkDef, type ResKey, type WorldDef } from '../data';
import { angDiff, clamp, lerp, swapRemove, TAU, roman } from '../core/math';
import { Rng } from '../core/rng';
import { compileSpecies, type Species } from '../enemies/species';
import { evolveWorld } from '../evolution/evolution';
import type { Save, WorldState } from '../persistence/save';
import {
  addBlock, bkey, compileVehicle, freshMods, makeVehicle, neighbours, reachable, validCells,
  type Block, type BuildCell, type Mods, type UpLevels, type Vehicle,
} from '../vehicle/vehicle';

const CS = T.cellSize;
const EC = T.enemyCell;
const ARENA = T.arena;
const RUN_LEN = T.runLength;

export interface Enemy {
  sp: Species; x: number; y: number; vx: number; vy: number; h: number;
  hp: number; max: number; sc: number; r: number; speed: number; melee: number; gun: number; boom: number;
  res: Partial<Record<DType, number>>; pref: number; cd: number; flash: number;
  burn: number; burnDps: number; burnSrc?: string; dead: boolean; t0: number; bossLv: number;
  lastType: DType; lastSrc?: string; isMini?: boolean; dmgAcc: number; dmgT: number; crit: boolean;
  /** stable id (co-op snapshots); owner index of the last hit and of the burn */
  id: number; lastO: number; burnO: number;
  /** heavy weapons: lobbed bombs, charged rail shots, homing rockets, scrap spray */
  lob: number; snipe: number; rocket: number; spray: number; cd2: number; cd3: number;
  /** rail shot charge: seconds left and the aim point (telegraphed to the player) */
  aimT: number; aimX: number; aimY: number;
  /** previous-step position, for render interpolation */
  px?: number; py?: number;
}
export interface Projectile {
  x: number; y: number; vx: number; vy: number; dmg: number; type: DType; src: string; life: number; r: number;
  pierce: number; burn: number; hits: Enemy[] | null;
  /** owner: index into Run.players */
  o: number;
  lob?: boolean; sx?: number; sy?: number; tx?: number; ty?: number; t?: number; T?: number; z?: number; aoe?: number;
}
export type EnemyShot = 'bolt' | 'spray' | 'snipe' | 'rocket' | 'lob';
export const SHOT_KINDS: EnemyShot[] = ['bolt', 'spray', 'snipe', 'rocket', 'lob'];
export interface EnemyBullet {
  x: number; y: number; vx: number; vy: number; dmg: number; life: number; sp: Species | null;
  kind: EnemyShot;
  /** lob: start, target, flight time, progress, height */
  sx?: number; sy?: number; tx?: number; ty?: number; T?: number; t?: number; z?: number;
  /** rocket: seconds of guidance left; set when a player shot or blast brings it down */
  fuel?: number; downed?: boolean;
}
export interface Pickup { x: number; y: number; k: ResKey | 'xp'; amt: number; vx: number; vy: number }
export interface Deposit { x: number; y: number; res: ResKey; amt: number; prog: number; cache?: boolean }
export interface Hazard { x: number; y: number; r: number }
export interface Fx {
  x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number;
  ring?: boolean; r?: number; block?: boolean; rot?: number; vr?: number; text?: string; big?: boolean;
}
export interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; max: number; c: string; w: number; zig?: boolean; glow?: boolean; seed: number }

export type SimEvent =
  | { k: 'toast'; msg: string; ms: number; pid?: string }
  | { k: 'snd'; f: number; dur: number; type: OscillatorType; vol: number }
  | { k: 'shot'; f: number }
  | { k: 'hurt' };

export type Card =
  | { kind: 'block'; key: string; t: string; label: string; title: string; desc: string }
  | { kind: 'up'; key: string; t: string; label: string; title: string; desc: string }
  | { kind: 'perk'; key: string; p: PerkDef; label: string; title: string; desc: string }
  | { kind: 'repair'; key: string; label: string; title: string; desc: string };

export interface RunResult {
  won: boolean; t: number; kills: number; level: number; gained: Partial<Record<ResKey, number>>;
  report: string[]; wk: string; dmg: Record<string, number>; ks: Record<string, number>;
  peak: Record<string, number>; taken: number; newSpecies: number;
  /** extra numbers for records and trophies */
  stats: RunStats; loot: number; seed: number;
  /** co-op: number of players and this player's id */
  crew?: number; pid?: string;
}

/** Things measured during a run that feed records and trophies. */
export interface RunStats {
  dist: number; idleT: number; hazardT: number; spins: number; mined: number; caches: number;
  blocksLost: number; maxChain: number; crits: number; minCab: number; takenAt120: number;
  maxHit: number; touched: boolean; firstTouchT: number;
  /** enemy projectiles destroyed by point defence; times the truck was wrecked (co-op) */
  zapped: number; downs: number;
}

/** One truck in the run. Solo runs have exactly one; co-op adds teammates. */
export interface Player {
  pid: string; name: string; color: string; idx: number; avatar: string;
  V: Vehicle; mods: Mods; lvl: Record<string, number>; up: UpLevels; build: BuildCell[]; gridR: number;
  joy: { x: number; y: number };
  alive: boolean; gone: boolean; respawnT: number; lavaT: number; hazWarned: boolean; downs: number;
  kills: number; dmgBy: Record<string, number>; killsSrc: Record<string, number>; peak: Record<string, number>;
  taken: number; stats: RunStats;
  /** co-op level-up cards still owed to this player */
  pendingCards: number;
}

export interface PlayerSpec { pid: string; name: string; build: BuildCell[]; up: UpLevels; gridR: number; color?: string; /** captain on the cab (cosmetic) */ avatar?: string }

export const PLAYER_COLORS = ['#00f0ff', '#ff2bd6', '#f5ff3b', '#5dff8a'];
export const RESPAWN_TIME = 10;

const freshStats = (): RunStats => ({ dist: 0, idleT: 0, hazardT: 0, spins: 0, mined: 0, caches: 0, blocksLost: 0, maxChain: 0, crits: 0, minCab: 1, takenAt120: -1, maxHit: 0, touched: false, firstTouchT: -1, zapped: 0, downs: 0 });

export interface RunOptions { seed?: number; /** extra players (co-op); the save's owner is always player 0 */ crew?: PlayerSpec[]; pid?: string; name?: string; avatar?: string; /** exhibition run: no loot banked, no evolution */ exhibition?: boolean; visual?: boolean; dmgNumbers?: boolean; viewW?: number; viewH?: number }

export class Run {
  readonly save: Save;
  readonly wk: string;
  readonly W: WorldState;
  readonly Wd: WorldDef;
  readonly rng: Rng;
  readonly visual: boolean;
  dmgNumbers: boolean;

  t = 0; level = 1; xp = 0; xpNeed = 7;
  budget = 2; wave = -1; pattern = 'ring'; patAng = 0; breather = false;
  mb1 = false; mb2 = false; boss = false; bossE: Enemy | null = null;
  won = false; over = false; endT = 0; wonPending = false;
  kills = 0; killsBy: Record<DType, number>; loot: Record<ResKey, number>;
  reroll = 1; pendingLevels = 0;
  maxR = 30; zoom = 1; spawnD = 600; nextSp: Species | null = null;
  shake = 0;
  result: RunResult | null = null;
  /** co-op: one result per player, keyed by pid */
  results: Record<string, RunResult> = {};
  readonly seed: number;
  readonly exhibition: boolean;
  readonly coop: boolean;
  /** enemy pressure multiplier (more trucks, more enemies) */
  readonly crowd: number;
  readonly maxEnemies: number;

  players: Player[] = [];
  E: Enemy[] = []; PB: Projectile[] = []; EBL: EnemyBullet[] = []; PK: Pickup[] = [];
  FX: Fx[] = []; BEAMS: Beam[] = []; DEP: Deposit[] = []; HZ: Hazard[] = [];
  events: SimEvent[] = [];

  private hash = new Map<number, Enemy[]>();
  private readonly HS = 80;
  private nextEnemyId = 1;

  constructor(save: Save, wk: string, opts: RunOptions = {}) {
    this.save = save;
    this.wk = wk;
    this.W = save.worlds[wk];
    this.Wd = WORLDS[wk];
    this.visual = opts.visual ?? false;
    this.dmgNumbers = opts.dmgNumbers ?? false;
    this.seed = opts.seed ?? ((Date.now() ^ (this.W.gen * 7919) ^ 0x9e3779b9) >>> 0);
    this.exhibition = opts.exhibition ?? false;
    this.rng = new Rng(this.seed);
    this.killsBy = {} as Record<DType, number>;
    for (const t of DTYPES) this.killsBy[t] = 0;
    this.loot = {} as Record<ResKey, number>;
    for (const r of RES_KEYS) this.loot[r] = 0;
    const specs: PlayerSpec[] = [{ pid: opts.pid ?? 'me', name: opts.name ?? 'You', avatar: opts.avatar, build: save.build, up: save.up, gridR: save.gridR }, ...(opts.crew ?? [])];
    for (const sp of specs) this.addPlayer(sp);
    this.coop = this.players.length > 1;
    const n = this.players.length;
    this.crowd = 1 + 0.75 * (n - 1);
    this.maxEnemies = Math.min(340, Math.round(T.maxEnemies * (1 + 0.45 * (n - 1))));
    for (const sp of this.W.species) { compileSpecies(sp); sp.st = { n: 0, dmg: 0, life: 0 }; }
    this.genMap();
    this.setView(opts.viewW ?? 1024, opts.viewH ?? 768);
  }

  private addPlayer(sp: PlayerSpec): Player {
    const idx = this.players.length;
    const p: Player = {
      pid: sp.pid, name: sp.name, color: sp.color ?? PLAYER_COLORS[idx % PLAYER_COLORS.length], idx, avatar: sp.avatar ?? 'charles',
      V: makeVehicle(sp.build, sp.up, this.rng), mods: freshMods(), lvl: {}, up: sp.up, build: sp.build.map(b => ({ ...b })), gridR: sp.gridR,
      joy: { x: 0, y: 0 }, alive: true, gone: false, respawnT: 0, lavaT: 0, hazWarned: false, downs: 0,
      kills: 0, dmgBy: {}, killsSrc: {}, peak: {}, taken: 0, stats: freshStats(), pendingCards: 0,
    };
    // teammates start in a loose line next to each other
    p.V.x = (idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * 110;
    this.players.push(p);
    this.recompile(p);
    this.updateBlockPositions(p);
    return p;
  }

  /** index of the player on this device (0 on the host; a co-op client's mirror sets its own) */
  local = 0;
  // ---- solo-compatible accessors for the local player
  get me(): Player { return this.players[this.local]; }
  get V(): Vehicle { return this.me.V; }
  get mods(): Mods { return this.me.mods; }
  get lvl(): Record<string, number> { return this.me.lvl; }
  get joy(): { x: number; y: number } { return this.me.joy; }
  get dmgBy(): Record<string, number> { return this.me.dmgBy; }
  get killsSrc(): Record<string, number> { return this.me.killsSrc; }
  get peak(): Record<string, number> { return this.me.peak; }
  get taken(): number { return this.me.taken; }
  get stats(): RunStats { return this.me.stats; }
  playerById(pid: string): Player | undefined { return this.players.find(p => p.pid === pid); }
  private alivePlayers(): Player[] { return this.players.filter(p => p.alive); }

  setView(w: number, h: number): void {
    this.zoom = clamp(Math.min(w, h) / 620, 0.72, 1.6);
    this.spawnD = Math.hypot(w, h) / 2 / this.zoom + 70;
  }

  private emit(e: SimEvent) { if (this.visual) this.events.push(e); }
  /** toast for everyone, or only for one player when pid is given */
  private toast(msg: string, ms = 1600, pid?: string) { this.emit({ k: 'toast', msg, ms, pid }); }
  private snd(f: number, dur: number, type: OscillatorType, vol: number) { this.emit({ k: 'snd', f, dur, type, vol }); }

  recompile(p: Player = this.players[0]): void {
    compileVehicle(p.V, p.mods, p.up);
    const cnt: Record<string, number> = {};
    for (const b of p.V.list) cnt[b.t] = (cnt[b.t] || 0) + 1;
    for (const t in cnt) p.peak[t] = Math.max(p.peak[t] || 0, cnt[t]);
  }

  private genMap(): void {
    const r = this.rng;
    for (let i = 0; i < 16; i++) {
      let x = 0, y = 0, g = 0;
      do { x = r.range(-ARENA + 200, ARENA - 200); y = r.range(-ARENA + 200, ARENA - 200); g++; } while (Math.hypot(x, y) < 380 && g < 30);
      this.HZ.push({ x, y, r: r.range(110, 250) });
    }
    for (let i = 0; i < 46; i++) {
      let x = 0, y = 0, g = 0;
      do { x = r.range(-ARENA + 120, ARENA - 120); y = r.range(-ARENA + 120, ARENA - 120); g++; } while (Math.hypot(x, y) < 160 && g < 30);
      this.DEP.push({ x, y, res: r.wpick(this.Wd.res), amt: Math.round(r.range(4, 9)), prog: 0 });
    }
  }

  // ------------------------------------------------------------ end of run
  end(won: boolean): void {
    if (this.over) return;
    this.over = true;
    this.won = won;
    const W = this.W, save = this.save;
    for (const e of this.E) if (!e.dead && !e.bossLv) e.sp.st.life += this.t - e.t0;
    if (won) for (const p of this.PK) if (p.k !== 'xp') this.loot[p.k] += p.amt;
    const mult = won ? 1 : T.deathLootKeep;
    const gained: Partial<Record<ResKey, number>> = {};
    let lootTotal = 0;
    for (const r of RES_KEYS) {
      const n = Math.floor(this.loot[r] * mult);
      lootTotal += n;
      if (n > 0) gained[r] = n;
      if (n > 0 && !this.exhibition) save.res[r] += n;
    }
    let rep = { lines: ['Challenge runs are exhibition matches: no loot is banked and the sector does not evolve.'], children: 0 };
    if (!this.exhibition) {
      W.runs++; save.runs++;
      if (won) { W.wins++; save.wins++; }
      rep = evolveWorld(save, this.wk, this.killsBy, this.rng);
      if (won) W.tier = Math.min(12, W.tier + 1);
    }
    this.snd(won ? 660 : 140, 0.6, won ? 'triangle' : 'sawtooth', 0.05);
    for (const p of this.players) {
      this.results[p.pid] = {
        won, t: this.t, kills: p.kills, level: this.level, gained: this.exhibition ? {} : { ...gained }, report: rep.lines, wk: this.wk,
        dmg: { ...p.dmgBy }, ks: { ...p.killsSrc }, peak: { ...p.peak }, taken: p.taken, newSpecies: rep.children,
        stats: { ...p.stats }, loot: lootTotal, seed: this.seed, crew: this.players.length, pid: p.pid,
      };
    }
    this.result = this.results[this.players[0].pid];
  }

  // ------------------------------------------------------------ director
  private pickSpecies(): Species {
    const ws: Record<string, number> = {};
    for (const s of this.W.species) ws[s.id] = s.pop || 1;
    const id = +this.rng.wpick(ws);
    return this.W.species.find(s => s.id === id) || this.W.species[0];
  }

  /** Spawns happen around a random living truck. */
  private anchor(): Vehicle {
    const alive = this.alivePlayers();
    return (alive.length ? this.rng.pick(alive) : this.players[0]).V;
  }

  private spawnPos(): { x: number; y: number } {
    const r = this.rng, V = this.anchor();
    let a: number;
    if (this.pattern === 'flank') a = this.patAng + r.range(-0.6, 0.6);
    else if (this.pattern === 'stream') a = this.patAng + r.range(-0.2, 0.2);
    else a = r.range(0, TAU);
    const d = this.spawnD + r.range(0, this.pattern === 'scatter' ? 220 : 80);
    let x = V.x + Math.cos(a) * d, y = V.y + Math.sin(a) * d;
    if (Math.abs(x) > ARENA - 20 || Math.abs(y) > ARENA - 20) { x = V.x - Math.cos(a) * d; y = V.y - Math.sin(a) * d; }
    return { x: clamp(x, -ARENA + 20, ARENA - 20), y: clamp(y, -ARENA + 20, ARENA - 20) };
  }

  spawnEnemy(sp: Species, x: number, y: number, bossLv = 0): Enemy {
    const c = sp.c, tier = this.W.tier, V = this.anchor();
    let hpM = (1 + 0.4 * (tier - 1)) * (1 + this.t / 260);
    let sc = 1, spdM = 1, dmgM = 1 + 0.12 * (tier - 1);
    if (bossLv === 1) { hpM *= 10; sc = 1.9; spdM = 0.75; dmgM *= 2.2; }
    if (bossLv === 2) { hpM *= 16 * (1 + 0.15 * (this.W.era - 1)); sc = 2.7; spdM = 0.65; dmgM *= 2.2; }
    // bosses get tougher with more trucks shooting at them
    if (bossLv && this.coop) hpM *= 1 + 0.6 * (this.players.length - 1);
    const e: Enemy = {
      sp, x, y, vx: 0, vy: 0, h: Math.atan2(V.y - y, V.x - x), hp: c.hp * hpM, max: c.hp * hpM, sc, r: (c.ext + 0.6) * EC * sc,
      speed: c.speed * spdM, melee: c.melee * dmgM, gun: bossLv ? 7 * (1 + 0.12 * (tier - 1)) : c.gun * dmgM, boom: bossLv ? 0 : c.boom * dmgM,
      lob: c.lob * dmgM, snipe: c.snipe * dmgM, rocket: c.rocket * dmgM, spray: c.spray * dmgM, cd2: this.rng.range(1.5, 3.5), cd3: this.rng.range(1, 2.5), aimT: 0, aimX: 0, aimY: 0,
      res: c.res, pref: sp.pref || (bossLv ? 160 : 0), cd: this.rng.range(0.5, 1.8), flash: 0, burn: 0, burnDps: 0, dead: false,
      t0: this.t, bossLv, lastType: 'kinetic', dmgAcc: 0, dmgT: 0, crit: false, id: this.nextEnemyId++, lastO: 0, burnO: 0,
    };
    if (e.r > this.maxR) this.maxR = e.r;
    sp.st.n++;
    this.E.push(e);
    return e;
  }

  private spawnBoss(lv: number): void {
    let sp = this.W.species[0];
    for (const s of this.W.species) if (s.c.hp + s.c.melee * 3 > sp.c.hp + sp.c.melee * 3) sp = s;
    const p = this.spawnPos();
    const e = this.spawnEnemy(sp, p.x, p.y, lv);
    if (lv === 2) { this.bossE = e; this.toast('WORLD BOSS: Apex ' + sp.name + '. Destroy it to win.', 3200); this.snd(90, 1.0, 'sawtooth', 0.06); }
    else { e.isMini = true; this.toast('MINI-BOSS: Elder ' + sp.name, 2400); this.snd(120, 0.6, 'sawtooth', 0.05); }
  }

  private spawnCache(): void {
    const r = this.rng, V = this.anchor();
    const a = r.range(0, TAU), d = r.range(160, 260);
    const x = clamp(V.x + Math.cos(a) * d, -ARENA + 60, ARENA - 60), y = clamp(V.y + Math.sin(a) * d, -ARENA + 60, ARENA - 60);
    this.DEP.push({ x, y, res: r.wpick(this.Wd.res), amt: 14, prog: 0, cache: true });
  }

  private director(dt: number): void {
    const t = this.t;
    const waveIdx = Math.floor(t / T.waveLength);
    if (waveIdx !== this.wave) {
      this.wave = waveIdx;
      this.pattern = this.rng.pick(['ring', 'flank', 'stream', 'scatter']);
      this.patAng = this.rng.range(0, TAU);
      this.breather = waveIdx > 0 && waveIdx % T.breatherEvery === T.breatherEvery - 1;
      if (this.breather) { this.spawnCache(); this.toast('Breather. A supply cache dropped nearby.', 2200); }
      else if (waveIdx > 0 && t < RUN_LEN) this.toast('Wave ' + (waveIdx + 1), 1200);
    }
    if (!this.mb1 && t >= T.miniBossTimes[0]) { this.mb1 = true; this.spawnBoss(1); }
    if (!this.mb2 && t >= T.miniBossTimes[1]) { this.mb2 = true; this.spawnBoss(1); }
    if (!this.boss && t >= RUN_LEN) { this.boss = true; this.spawnBoss(2); }
    const lvlAdj = clamp(Math.sqrt((this.level + 2) / (2 + t / 25)), 0.75, 1.5);
    let rate = (0.7 + t / 38) * (0.8 + 0.2 * this.W.tier) * lvlAdj * this.crowd;
    if (this.breather) rate *= 0.35;
    if (this.boss) rate *= 0.3;
    this.budget = Math.min(this.budget + rate * dt, T.budgetCap * this.crowd);
    let guard = 0;
    while (this.E.length < this.maxEnemies && guard++ < 12 + 6 * (this.players.length - 1)) {
      const sp = this.nextSp || (this.nextSp = this.pickSpecies());
      if (this.budget < sp.c.cost) break;
      this.budget -= sp.c.cost;
      this.nextSp = null;
      const p = this.spawnPos();
      this.spawnEnemy(sp, p.x, p.y, 0);
    }
  }

  // ------------------------------------------------------------ spatial hash
  private buildHash(): void {
    for (const a of this.hash.values()) a.length = 0;
    const HS = this.HS;
    for (const e of this.E) {
      if (e.dead) continue;
      const k = (Math.floor(e.x / HS) + 2048) * 4096 + (Math.floor(e.y / HS) + 2048);
      let a = this.hash.get(k);
      if (!a) { a = []; this.hash.set(k, a); }
      a.push(e);
    }
  }

  query(x: number, y: number, r: number, fn: (e: Enemy) => void): void {
    const HS = this.HS;
    const x0 = Math.floor((x - r) / HS), x1 = Math.floor((x + r) / HS), y0 = Math.floor((y - r) / HS), y1 = Math.floor((y + r) / HS);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.hash.get((cx + 2048) * 4096 + (cy + 2048));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) if (!a[i].dead) fn(a[i]);
    }
  }

  // ------------------------------------------------------------ combat
  private findTarget(x: number, y: number, range: number, face: number, arc: number): Enemy | null {
    let best: Enemy | null = null, bd = Infinity;
    const half = arc / 2, full = arc >= TAU - 0.01;
    this.query(x, y, range + this.maxR, e => {
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) - e.r;
      if (d > range || d >= bd) return;
      if (!full && Math.abs(angDiff(face, Math.atan2(dy, dx))) > half) return;
      bd = d; best = e;
    });
    return best;
  }

  private credit(src: string | undefined, dmg: number, e: Enemy, o: number): void {
    if (!src) return;
    const by = this.players[o]?.dmgBy;
    if (by) by[src] = (by[src] || 0) + Math.min(dmg, Math.max(0, e.hp));
  }

  private resist(e: Enemy, type: DType) { return Math.min(0.75, (e.res[type] || 0) + (this.W.res[type] || 0)); }

  hitEnemy(e: Enemy, dmg: number, type: DType, src?: string, o = 0): void {
    if (e.dead) return;
    const pl = this.players[o] ?? this.players[0];
    let crit = false;
    if (this.rng.next() < pl.mods.crit) { dmg *= 2; crit = true; }
    dmg *= 1 - this.resist(e, type);
    this.credit(src, dmg, e, o);
    e.hp -= dmg; e.flash = 0.07; e.lastType = type; e.lastO = o;
    if (src) e.lastSrc = src;
    if (crit) pl.stats.crits++;
    if (dmg > pl.stats.maxHit) pl.stats.maxHit = dmg;
    if (this.dmgNumbers) { e.dmgAcc += dmg; if (crit) e.crit = true; }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private flushDmg(e: Enemy): void {
    if (e.dmgAcc < 1) return;
    if (this.FX.length < 760) {
      this.FX.push({ x: e.x + this.rng.range(-6, 6), y: e.y - e.r, vx: this.rng.range(-12, 12), vy: -55, life: 0.7, max: 0.7,
        c: e.crit ? '#f5ff3b' : DCOL[e.lastType], s: 0, text: String(Math.round(e.dmgAcc)), big: e.crit || e.bossLv > 0 });
    }
    e.dmgAcc = 0; e.crit = false; e.dmgT = this.t;
  }

  private killEnemy(e: Enemy): void {
    const r = this.rng;
    e.dead = true;
    this.kills++;
    const pl = this.players[e.lastO] ?? this.players[0];
    pl.kills++;
    if (this.dmgNumbers) this.flushDmg(e);
    this.killsBy[e.lastType] = (this.killsBy[e.lastType] || 0) + 1;
    if (e.lastSrc) pl.killsSrc[e.lastSrc] = (pl.killsSrc[e.lastSrc] || 0) + 1;
    if (!e.bossLv) e.sp.st.life += this.t - e.t0;
    this.burst(e.x, e.y, e.bossLv ? 40 : 7, EB.core.color, e.bossLv ? 260 : 140);
    const xp = Math.max(1, Math.round(e.sp.c.cost * 1.3 * (e.bossLv === 2 ? 25 : e.bossLv ? 8 : 1)));
    this.dropXP(e.x, e.y, xp);
    const chance = e.bossLv ? 1 : T.lootChance;
    if (r.next() < chance) {
      const n = e.bossLv ? 6 : 1;
      for (let i = 0; i < n; i++) {
        const k: ResKey = r.next() < 0.5 ? r.wpick(this.Wd.res) : EB[r.pick(e.sp.cells)[2]].mat;
        this.PK.push({ x: e.x + r.range(-14, 14), y: e.y + r.range(-14, 14), k, amt: e.bossLv ? 3 : 1, vx: 0, vy: 0 });
      }
    }
    if (e.bossLv) this.PK.push({ x: e.x, y: e.y, k: 'shard', amt: e.bossLv === 2 ? 4 : 1, vx: 0, vy: 0 });
    if (pl.mods.heal && pl.alive) { const b = pl.V.list.find(o => o.hp < o.max); if (b) b.hp = Math.min(b.max, b.hp + pl.mods.heal); }
    this.shake = Math.max(this.shake, e.bossLv ? 14 : 1.5);
    if (e.bossLv) this.snd(100, 0.8, 'sawtooth', 0.06);
    else if (r.next() < 0.3) this.snd(220, 0.08, 'triangle', 0.02);
    if (e.bossLv === 2 && !this.over) { this.wonPending = true; this.endT = this.t + 1.2; this.toast('APEX DESTROYED', 1800); }
  }

  private dropXP(x: number, y: number, amt: number): void {
    if (this.PK.length > 520) { this.xp += amt * (1 + this.players[0].mods.xp); this.checkLevel(); return; }
    this.PK.push({ x, y, k: 'xp', amt, vx: 0, vy: 0 });
  }

  /** Team XP: every level gives each truck a card. Solo runs pause for it (pendingLevels). */
  private checkLevel(): void {
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = Math.round((5 + this.level * 4 + this.level * this.level * 0.2) * (this.coop ? 1 + 0.35 * (this.players.length - 1) : 1));
      if (this.coop) { for (const p of this.players) if (!p.gone) p.pendingCards++; }
      else this.pendingLevels++;
    }
  }

  private explode(x: number, y: number, r: number, dmg: number, type: DType, src: string | undefined, o: number): void {
    this.query(x, y, r + this.maxR, e => { const d = Math.hypot(e.x - x, e.y - y); if (d < r + e.r) this.hitEnemy(e, dmg, type, src, o); });
    for (const rk of this.EBL) if (rk.kind === 'rocket' && Math.hypot(rk.x - x, rk.y - y) < r + T.rocket.hitR) rk.downed = true;
    this.ring(x, y, r, DCOL[type]);
    this.burst(x, y, 10, DCOL[type], 180);
    this.shake = Math.max(this.shake, 3);
    this.snd(90, 0.25, 'sawtooth', 0.025);
  }

  private fireWeapons(p: Player, dt: number): void {
    const V = p.V, s = V.s, r = this.rng, o = p.idx;
    for (const b of s.weapons) {
      if (b.dead) continue;
      const d = B[b.t], w = d.w!, lv = p.lvl[b.t] || 0;
      b.cd -= dt;
      if (b.cd > 0) continue;
      const range = w.range * (1 + p.mods.range);
      const face = V.h + (d.dir ? (b.r * Math.PI) / 2 : 0);
      const tgt = this.findTarget(b.wx, b.wy, range, face, (w.arc * Math.PI) / 180);
      if (!tgt) { b.cd = 0.08; continue; }
      const U = p.up[b.t] || 0;
      const rate = w.rate * (1 + 0.12 * lv) * (1 + 0.05 * U) * (1 + p.mods.rate) * b.syn.rateM * s.powerFactor;
      b.cd = 1 / rate;
      const dmg = w.dmg * (1 + 0.25 * lv) * (1 + 0.15 * U) * (1 + (p.mods.dmg[w.type] || 0)) * b.syn.dmgM;
      const src = b.t;
      const ang = Math.atan2(tgt.y - b.wy, tgt.x - b.wx);
      if (w.beam) {
        this.hitEnemy(tgt, dmg, w.type, src, o);
        if (this.visual) this.BEAMS.push({ x1: b.wx, y1: b.wy, x2: tgt.x, y2: tgt.y, life: 0.12, max: 0.12, c: DCOL.energy, w: 3, glow: true, seed: r.next() });
        if (o === 0) this.emit({ k: 'shot', f: 880 });
      } else if (w.chain) {
        const links = w.chain + b.syn.chain;
        const hit: Enemy[] = [tgt];
        let cur = tgt, px = b.wx, py = b.wy;
        for (let j = 0; j <= links; j++) {
          if (this.visual) {
            this.BEAMS.push({ x1: px, y1: py, x2: cur.x, y2: cur.y, life: 0.16, max: 0.16, c: DCOL.electric, w: 3.5, zig: true, glow: true, seed: r.next() });
            if (this.FX.length < 600) this.burst(cur.x, cur.y, 3, '#e6dcff', 120);
          }
          this.hitEnemy(cur, dmg * (j === 0 ? 1 : T.teslaFalloff), 'electric', src, o);
          if (j + 1 > p.stats.maxChain) p.stats.maxChain = j + 1;
          px = cur.x; py = cur.y;
          let nb: Enemy | null = null, nd = T.teslaJump;
          this.query(px, py, T.teslaJump, e => {
            if (hit.includes(e)) return;
            const dd = Math.hypot(e.x - px, e.y - py);
            if (dd < nd) { nd = dd; nb = e; }
          });
          if (!nb) break;
          hit.push(nb);
          cur = nb;
        }
        if (o === 0) this.emit({ k: 'shot', f: 520 });
      } else if (w.lob) {
        const TT = 0.85;
        this.PB.push({ lob: true, sx: b.wx, sy: b.wy, tx: tgt.x + tgt.vx * TT * 0.6, ty: tgt.y + tgt.vy * TT * 0.6, t: 0, T: TT, x: b.wx, y: b.wy,
          vx: 0, vy: 0, dmg, type: w.type, src, aoe: w.aoe, life: TT + 0.1, r: 4, pierce: 0, burn: 0, hits: null, o });
        if (o === 0) this.emit({ k: 'shot', f: 160 });
      } else {
        const n = w.pellets || 1;
        for (let i = 0; i < n; i++) {
          const a = ang + r.range(-(w.spread || 0), w.spread || 0);
          const sp = (w.speed || 600) * r.range(0.9, 1.08);
          this.PB.push({ x: b.wx, y: b.wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, type: w.type, src,
            life: w.life || range / (w.speed || 600) + 0.05, r: w.type === 'fire' ? 7 : 3, pierce: w.pierce || 0, burn: w.burn || 0, hits: null, o });
        }
        if (o === 0) this.emit({ k: 'shot', f: w.type === 'fire' ? 200 : 330 });
      }
    }
  }

  private nearestBlock(p: Player, x: number, y: number): { b: Block | null; d: number } {
    let best: Block | null = null, bd = Infinity;
    for (const b of p.V.list) { const d = (b.wx - x) ** 2 + (b.wy - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return { b: best, d: Math.sqrt(bd) };
  }

  /** Nearest living truck to a point (enemy targeting). */
  private nearestPlayer(x: number, y: number): Player | null {
    let best: Player | null = null, bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = (p.V.x - x) ** 2 + (p.V.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  hitPlayer(b: Block | null, dmg: number, sp: Species | null, p: Player = this.players[0]): void {
    if (!b || this.over || b.dead || !p.alive) return;
    const V = p.V;
    dmg *= 1 - p.mods.armor;
    if (B[b.t].cat !== 'armor') {
      let arm: Block | null = null;
      for (const n of neighbours(V, b)) if (B[n.t].cat === 'armor' && (!arm || n.hp > arm.hp)) arm = n;
      if (arm) {
        const tr = dmg * 0.4;
        dmg -= tr; arm.hp -= tr; arm.fl = 0.1;
        if (arm.hp <= 0) this.destroyBlock(p, arm);
      }
    }
    if (sp) sp.st.dmg += dmg;
    if (b.dead || !p.alive) return;
    p.taken += dmg;
    b.hp -= dmg; b.fl = 0.1; V.flash = 0.08;
    if (p.idx === 0) this.shake = Math.max(this.shake, Math.min(8, 1 + dmg * 0.2));
    if (b.hp <= 0) this.destroyBlock(p, b);
  }

  private destroyBlock(p: Player, b: Block): void {
    if (b.dead || this.over) return;
    const V = p.V;
    b.dead = true;
    V.list = V.list.filter(o => o !== b);
    V.map.delete(bkey(b.x, b.y));
    this.burst(b.wx, b.wy, 14, B[b.t].color, 200);
    if (p.idx === 0) { this.shake = Math.max(this.shake, 7); this.emit({ k: 'hurt' }); }
    this.snd(180, 0.3, 'sawtooth', 0.04);
    if (isCab(b.t)) { this.down(p); return; }
    const keep = reachable(V);
    const lost = V.list.filter(o => !keep.has(o));
    p.stats.blocksLost += 1 + lost.length;
    if (lost.length) {
      for (const o of lost) { o.dead = true; V.map.delete(bkey(o.x, o.y)); this.debris(o); }
      V.list = V.list.filter(o => keep.has(o));
      this.toast(lost.length === 1 ? B[lost[0].t].name + ' broke off!' : lost.length + ' blocks broke off!', 1400, p.pid);
    } else this.toast(B[b.t].name + ' destroyed', 900, p.pid);
    this.recompile(p);
  }

  /** Cab destroyed. Solo: the run ends. Co-op: the truck respawns unless the whole crew is down. */
  private down(p: Player): void {
    p.stats.blocksLost += p.V.list.length;
    p.stats.downs++;
    if (!this.coop) { this.end(false); return; }
    for (const o of p.V.list) { o.dead = true; this.debris(o); }
    p.V.list = []; p.V.map.clear();
    p.alive = false; p.downs++;
    p.respawnT = RESPAWN_TIME;
    if (!this.alivePlayers().length) { this.end(false); return; }
    this.toast(p.name + "'s truck is wrecked! Back in " + RESPAWN_TIME + ' s.', 2400);
  }

  private respawn(p: Player): void {
    const mate = this.alivePlayers()[0];
    const V = makeVehicle(p.build, p.up, this.rng);
    V.x = clamp((mate ? mate.V.x : 0) + this.rng.range(-90, 90), -ARENA + 60, ARENA - 60);
    V.y = clamp((mate ? mate.V.y : 0) + this.rng.range(-90, 90), -ARENA + 60, ARENA - 60);
    p.V = V; p.alive = true;
    this.recompile(p);
    this.updateBlockPositions(p);
    this.toast(p.name + ' is back on shift!', 1600);
  }

  /** A player left the session: their truck disappears for good. */
  removePlayer(pid: string): void {
    const p = this.playerById(pid);
    if (!p || p.gone) return;
    p.gone = true; p.alive = false; p.V.list = []; p.V.map.clear(); p.pendingCards = 0;
    this.toast(p.name + ' left the shift', 2000);
    if (!this.over && !this.alivePlayers().length) this.end(false);
  }

  /** Enemy heavy weapons. Each has a readable tell before it hurts. */
  private heavyWeapons(e: Enemy, tp: Player, d: number, dt: number): void {
    const r = this.rng, V = tp.V;
    // scrap spray: a short-range fan
    if (e.spray > 0) {
      e.cd3 -= dt;
      if (e.cd3 <= 0 && d < 300) {
        e.cd3 = 2.2;
        const base = Math.atan2(V.y - e.y, V.x - e.x);
        for (let j = 0; j < 5; j++) {
          const ang = base + (j - 2) * 0.13 + r.range(-0.03, 0.03);
          this.EBL.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 210, vy: Math.sin(ang) * 210, dmg: e.spray, life: 1.3, sp: e.sp, kind: 'spray' });
        }
      }
    }
    e.cd2 -= dt;
    // rail spike: charges for 0.9 s with a visible laser line, then fires where you were
    if (e.snipe > 0) {
      if (e.aimT > 0) {
        e.aimT -= dt;
        if (e.aimT <= 0) {
          const ang = Math.atan2(e.aimY - e.y, e.aimX - e.x);
          this.EBL.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, dmg: e.snipe, life: 1.4, sp: e.sp, kind: 'snipe' });
          e.cd2 = 3.2;
          this.snd(1400, 0.12, 'sawtooth', 0.02);
        }
      } else if (e.cd2 <= 0 && d < 560) {
        e.aimT = 0.9; e.aimX = V.x + V.vx * 0.5; e.aimY = V.y + V.vy * 0.5;
      }
      return;
    }
    if (e.cd2 > 0) return;
    // bomb lobber: an arcing bomb with a warning ring where it will land
    if (e.lob > 0 && d < 520) {
      e.cd2 = 3.6;
      const T_ = 1.15;
      const tx = V.x + V.vx * T_ * 0.7, ty = V.y + V.vy * T_ * 0.7;
      this.EBL.push({ x: e.x, y: e.y, vx: 0, vy: 0, dmg: e.lob, life: T_ + 0.2, sp: e.sp, kind: 'lob', sx: e.x, sy: e.y, tx, ty, T: T_, t: 0, z: 0 });
    } else if (e.rocket > 0 && d < 620) {
      // rocket pod: a homing missile with short guidance; juke it, shoot it down, or zap it
      e.cd2 = 3.6;
      const ang = Math.atan2(V.y - e.y, V.x - e.x), R = T.rocket;
      this.EBL.push({ x: e.x, y: e.y, vx: Math.cos(ang) * R.speed, vy: Math.sin(ang) * R.speed, dmg: e.rocket, life: R.life, sp: e.sp, kind: 'rocket', fuel: R.guide });
    }
  }

  /** Splash damage from enemy bombs and rockets, to every truck in range. */
  private enemyBlast(x: number, y: number, rad: number, dmg: number, sp: Species | null): void {
    for (const pl of this.players) {
      if (!pl.alive) continue;
      for (const b of pl.V.list.slice()) {
        const bd = Math.hypot(b.wx - x, b.wy - y);
        if (bd < rad) this.hitPlayer(b, dmg * (1 - (bd / rad) * 0.7), sp, pl);
        if (this.over) return;
      }
    }
    this.ring(x, y, rad, '#ff7a1a');
    this.burst(x, y, 12, '#ffb03a', 200);
    this.snd(110, 0.25, 'sawtooth', 0.03);
  }

  /** Point defence: zappers destroy the nearest enemy projectile in range. */
  private pointDefence(p: Player, dt: number): void {
    const zs = p.V.s.zappers;
    if (!zs.length || !this.EBL.length) { for (const z of zs) z.cd = Math.max(0, z.cd - dt); return; }
    for (const z of zs) {
      if (z.dead) continue;
      z.cd -= dt;
      if (z.cd > 0) continue;
      const pd = B[z.t].pd!;
      let best = -1, bd = pd.range * pd.range;
      for (let i = 0; i < this.EBL.length; i++) {
        const b = this.EBL[i];
        const dd = (b.x - z.wx) ** 2 + (b.y - z.wy) ** 2;
        if (dd < pd.range * pd.range && dd * (b.kind === 'rocket' ? 0.25 : 1) < bd) { bd = dd * (b.kind === 'rocket' ? 0.25 : 1); best = i; }
      }
      if (best < 0) { z.cd = 0.05; continue; }
      const b = this.EBL[best];
      if (this.visual) {
        this.BEAMS.push({ x1: z.wx, y1: z.wy, x2: b.x, y2: b.y, life: 0.1, max: 0.1, c: '#6fffd2', w: 2, zig: true, glow: true, seed: 0 });
        this.burst(b.x, b.y, 4, '#6fffd2', 90);
      }
      swapRemove(this.EBL, best);
      p.stats.zapped++;
      z.cd = 1 / (pd.rate * (1 + 0.08 * (p.up[z.t] || 0)) * p.V.s.powerFactor);
      if (p.idx === this.local) this.emit({ k: 'shot', f: 1200 });
    }
  }

  // ------------------------------------------------------------ fx helpers
  private burst(x: number, y: number, n: number, c: string, sp: number): void {
    if (!this.visual || this.FX.length > 700) return;
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, TAU), v = r.range(0.2, 1) * sp;
      this.FX.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: r.range(0.25, 0.6), max: 0.6, c, s: r.range(2, 4.5) });
    }
  }
  private ring(x: number, y: number, rad: number, c: string): void {
    if (this.visual) this.FX.push({ ring: true, x, y, r: rad, vx: 0, vy: 0, life: 0.3, max: 0.3, c, s: 0 });
  }
  private debris(b: Block): void {
    if (!this.visual) return;
    const r = this.rng, a = r.range(0, TAU), v = r.range(120, 220);
    this.FX.push({ x: b.wx, y: b.wy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4, max: 1.4, c: B[b.t].color, s: CS * 0.85, rot: r.range(0, TAU), vr: r.range(-8, 8), block: true });
  }

  inHazard(x: number, y: number): boolean {
    for (const z of this.HZ) if ((x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return true;
    return false;
  }

  /** Steering and arcade physics for one truck. Shared with the co-op client's prediction. */
  static drive(V: Vehicle, joy: { x: number; y: number }, dt: number, onHaz: boolean, haz: string, st?: RunStats, t = 0): void {
    const s = V.s;
    const mag = Math.min(1, Math.hypot(joy.x, joy.y));
    let fwd = 0;
    if (mag > 0.05) {
      if (st && !st.touched) { st.touched = true; st.firstTouchT = t; }
      const ta = Math.atan2(joy.y, joy.x);
      const da = angDiff(V.h, ta);
      const tr = s.turn * dt;
      const turn = clamp(da, -tr, tr);
      V.h += turn;
      if (st) st.spins += Math.abs(turn) / TAU;
      fwd = Math.max(0.2, Math.cos(angDiff(V.h, ta)));
    } else if (st) st.idleT += dt;
    let spd = s.speed * mag * fwd;
    let grip = 6;
    if (onHaz && haz === 'mud') spd *= 0.42 + 0.58 * s.trackFrac;
    if (onHaz && haz === 'ice') grip *= 0.18 + 0.82 * s.trackFrac;
    const k = 1 - Math.exp(-grip * dt);
    V.vx += (Math.cos(V.h) * spd - V.vx) * k;
    V.vy += (Math.sin(V.h) * spd - V.vy) * k;
    V.x = clamp(V.x + V.vx * dt, -ARENA + 30, ARENA - 30);
    V.y = clamp(V.y + V.vy * dt, -ARENA + 30, ARENA - 30);
    if (st) st.dist += Math.hypot(V.vx, V.vy) * dt;
  }

  // ------------------------------------------------------------ step
  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    if (this.wonPending && this.t >= this.endT) { this.end(true); return; }
    const r = this.rng;
    const haz = this.Wd.hazard;

    for (const p of this.players) {
      if (p.gone) continue;
      if (!p.alive) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn(p);
        continue;
      }
      const V = p.V, s = V.s, st = p.stats;
      const onHaz = this.inHazard(V.x, V.y);
      Run.drive(V, p.joy, dt, onHaz, haz, st, this.t);
      if (onHaz) st.hazardT += dt;
      if (st.takenAt120 < 0 && this.t >= 120) st.takenAt120 = p.taken;
      const cabB = V.map.get(bkey(0, 0));
      if (cabB) st.minCab = Math.min(st.minCab, cabB.hp / cabB.max);
      this.updateBlockPositions(p);
      for (const b of V.list) if (b.fl > 0) b.fl -= dt;

      // hazards
      if (onHaz && haz === 'lava') {
        p.lavaT += dt;
        if (!p.hazWarned) { p.hazWarned = true; this.toast(this.Wd.hazardText, 2400, p.pid); }
        if (p.lavaT >= 0.25) {
          p.lavaT = 0;
          const dmg = 2.5 * (1 - s.hoverFrac);
          if (dmg > 0.2 && V.list.length) this.hitPlayer(r.pick(V.list), dmg, null, p);
          if (this.over) return;
        }
      } else if (onHaz && !p.hazWarned) { p.hazWarned = true; this.toast(this.Wd.hazardText, 2400, p.pid); }

      // regen / repair
      for (const b of V.list) {
        const d = B[b.t];
        const hm = 1 + 0.25 * (p.up[b.t] || 0);
        const heal = p.mods.regen + (d.regen || 0) * hm;
        if (heal) b.hp = Math.min(b.max, b.hp + heal * dt);
        if (d.repair) for (const n of neighbours(V, b)) n.hp = Math.min(n.max, n.hp + d.repair * hm * dt);
      }
    }

    this.director(dt);
    this.buildHash();
    for (const p of this.players) if (p.alive) { this.fireWeapons(p, dt); this.pointDefence(p, dt); }
    if (this.over) return;

    // player projectiles (they can also bring enemy rockets down)
    const PB = this.PB;
    const rockets = this.EBL.some(b => b.kind === 'rocket');
    for (let i = PB.length - 1; i >= 0; i--) {
      const p = PB[i];
      p.life -= dt;
      if (p.lob) {
        p.t! += dt;
        const kk = Math.min(1, p.t! / p.T!);
        p.x = lerp(p.sx!, p.tx!, kk); p.y = lerp(p.sy!, p.ty!, kk); p.z = Math.sin(kk * Math.PI) * 60;
        if (kk >= 1) { this.explode(p.tx!, p.ty!, p.aoe!, p.dmg, p.type, p.src, p.o); swapRemove(PB, i); }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      let done = false;
      if (rockets) for (const rk of this.EBL) {
        if (rk.kind !== 'rocket' || rk.downed || Math.abs(rk.x - p.x) > T.rocket.hitR + p.r || Math.hypot(rk.x - p.x, rk.y - p.y) > T.rocket.hitR + p.r) continue;
        rk.downed = true;
        if (p.pierce > 0) p.pierce--; else { done = true; break; }
      }
      if (done) { swapRemove(PB, i); continue; }
      const owner = this.players[p.o] ?? this.players[0];
      this.query(p.x, p.y, p.r + this.maxR, e => {
        if (done) return;
        if (p.hits && p.hits.includes(e)) return;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
          this.hitEnemy(e, p.dmg, p.type, p.src, p.o);
          if (p.burn) {
            e.burn = 2; e.burnSrc = p.src; e.burnO = p.o;
            e.burnDps = Math.max(e.burnDps, p.burn * (1 + 0.15 * (owner.up[p.src] || 0)) * (1 + (owner.mods.dmg.fire || 0)));
          }
          if (p.pierce > 0) { p.pierce--; (p.hits || (p.hits = [])).push(e); }
          else done = true;
        }
      });
      if (done || p.life <= 0) swapRemove(PB, i);
    }

    // enemies
    for (const e of this.E) {
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.burn > 0) {
        e.burn -= dt; e.lastType = 'fire'; e.lastSrc = e.burnSrc; e.lastO = e.burnO;
        const bd = e.burnDps * dt * (1 - this.resist(e, 'fire'));
        this.credit(e.burnSrc, bd, e, e.burnO);
        e.hp -= bd;
        if (this.dmgNumbers) e.dmgAcc += bd;
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }
      if (this.dmgNumbers && e.dmgAcc > 0 && this.t - e.dmgT > 0.3) this.flushDmg(e);
      const tp = this.nearestPlayer(e.x, e.y);
      if (!tp) continue;
      const V = tp.V, pr = V.s.radius;
      const dx = V.x - e.x, dy = V.y - e.y, d = Math.hypot(dx, dy) || 1;
      let tx = dx / d, ty = dy / d;
      if (e.pref > 0) {
        if (d < e.pref * 0.8) { tx = -tx; ty = -ty; }
        else if (d < e.pref * 1.25) { const ox = -ty, oy = tx; tx = ox * 0.8; ty = oy * 0.8; }
      }
      let sx = 0, sy = 0;
      this.query(e.x, e.y, e.r * 2, o => {
        if (o === e) return;
        const ddx = e.x - o.x, ddy = e.y - o.y, dd = Math.hypot(ddx, ddy) || 0.01, m = e.r + o.r;
        if (dd < m) { sx += (ddx / dd) * (m - dd) / m; sy += (ddy / dd) * (m - dd) / m; }
      });
      const tvx = (tx + sx * 1.5) * e.speed, tvy = (ty + sy * 1.5) * e.speed;
      const kk = 1 - Math.exp(-5 * dt);
      e.vx += (tvx - e.vx) * kk; e.vy += (tvy - e.vy) * kk;
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (Math.abs(e.vx) + Math.abs(e.vy) > 8) e.h = Math.atan2(e.vy, e.vx);
      // contact with the nearest truck
      if (d < pr + e.r) {
        const nb = this.nearestBlock(tp, e.x, e.y);
        if (nb.b && nb.d < CS * 0.62 + e.r) {
          if (e.boom > 0) {
            for (const b of V.list.slice()) {
              const bd = Math.hypot(b.wx - e.x, b.wy - e.y);
              if (bd < 50) this.hitPlayer(b, e.boom * (1 - bd / 70), e.sp, tp);
              if (this.over) return;
            }
            this.ring(e.x, e.y, 50, '#ff7a1a');
            this.burst(e.x, e.y, 12, '#ff7a1a', 200);
            e.dead = true;
            e.sp.st.life += this.t - e.t0;
            continue;
          }
          this.hitPlayer(nb.b, e.melee * dt * 0.8, e.sp, tp);
          if (this.over) return;
          const push = CS * 0.62 + e.r - nb.d;
          const ux = (e.x - nb.b.wx) / (nb.d || 1), uy = (e.y - nb.b.wy) / (nb.d || 1);
          e.x += ux * push; e.y += uy * push;
        }
      }
      // shooting
      if (e.gun > 0) {
        e.cd -= dt;
        if (e.cd <= 0 && d < 420) {
          e.cd = e.bossLv ? 1.3 : 1.8;
          const n = e.bossLv === 2 ? 3 : e.bossLv ? 2 : 1;
          const base = Math.atan2(dy, dx);
          for (let j = 0; j < n; j++) {
            const ang = base + (n > 1 ? (j - (n - 1) / 2) * 0.22 : r.range(-0.05, 0.05));
            this.EBL.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240, dmg: e.gun, life: 2.2, sp: e.sp, kind: 'bolt' });
          }
        }
      }
      if (e.spray > 0 || e.lob > 0 || e.snipe > 0 || e.rocket > 0) this.heavyWeapons(e, tp, d, dt);
    }
    this.E = this.E.filter(e => !e.dead);

    // enemy bullets
    const EBL = this.EBL;
    for (let i = EBL.length - 1; i >= 0; i--) {
      const p = EBL[i];
      p.life -= dt;
      if (p.kind === 'lob') {
        p.t! += dt;
        const k = Math.min(1, p.t! / p.T!);
        p.x = lerp(p.sx!, p.tx!, k); p.y = lerp(p.sy!, p.ty!, k); p.z = Math.sin(k * Math.PI) * 90;
        if (k >= 1) { this.enemyBlast(p.tx!, p.ty!, 45, p.dmg, p.sp); swapRemove(EBL, i); if (this.over) return; }
        continue;
      }
      if (p.kind === 'rocket') {
        if (p.downed) { this.burst(p.x, p.y, 8, '#ffb03a', 140); this.snd(700, 0.08, 'square', 0.02); swapRemove(EBL, i); continue; }
        const tgt = (p.fuel ?? 0) > 0 ? this.nearestPlayer(p.x, p.y) : null;
        if (tgt) {
          p.fuel! -= dt;
          const sp = Math.hypot(p.vx, p.vy), want = Math.atan2(tgt.V.y - p.y, tgt.V.x - p.x), cur = Math.atan2(p.vy, p.vx);
          const off = angDiff(cur, want);
          if (Math.abs(off) > T.rocket.breakLock) p.fuel = 0; // overshot: the lock breaks and it flies straight on
          else {
            const na = cur + clamp(off, -T.rocket.turn * dt, T.rocket.turn * dt);
            p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
          }
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      let hit = false;
      for (const pl of this.players) {
        if (!pl.alive) continue;
        const V = pl.V;
        if (Math.hypot(p.x - V.x, p.y - V.y) < V.s.radius + 4) {
          const nb = this.nearestBlock(pl, p.x, p.y);
          if (nb.b && nb.d < CS * 0.62 + 4) {
            if (p.kind === 'rocket') this.enemyBlast(p.x, p.y, 32, p.dmg, p.sp);
            else this.hitPlayer(nb.b, p.dmg, p.sp, pl);
            hit = true; if (this.over) return; break;
          }
        }
      }
      if (hit || p.life <= 0) swapRemove(EBL, i);
    }

    // deposits: any truck can salvage
    const DEP = this.DEP;
    for (let i = DEP.length - 1; i >= 0; i--) {
      const dp = DEP[i];
      let miner: Player | null = null;
      for (const pl of this.players) if (pl.alive && Math.hypot(dp.x - pl.V.x, dp.y - pl.V.y) < 44 + pl.V.s.radius * 0.5) { miner = pl; break; }
      if (miner) {
        dp.prog += dt / 1.6;
        if (dp.prog >= 1) {
          if (dp.cache) miner.stats.caches++; else miner.stats.mined++;
          for (let j = 0; j < dp.amt; j++) {
            const an = r.range(0, TAU);
            this.PK.push({ x: dp.x, y: dp.y, k: dp.res, amt: 1, vx: Math.cos(an) * r.range(60, 160), vy: Math.sin(an) * r.range(60, 160) });
          }
          this.burst(dp.x, dp.y, 12, RES[dp.res].color, 160);
          this.snd(500, 0.12, 'triangle', 0.03);
          swapRemove(DEP, i);
        }
      } else dp.prog = Math.max(0, dp.prog - dt * 0.5);
    }

    // pickups: pulled to the nearest truck within its magnet range; loot and XP are shared
    const PK = this.PK;
    for (let i = PK.length - 1; i >= 0; i--) {
      const p = PK[i];
      let best: Player | null = null, bd = Infinity;
      for (const pl of this.players) {
        if (!pl.alive) continue;
        const d = Math.hypot(pl.V.x - p.x, pl.V.y - p.y);
        if (d < pl.V.s.magnet && d < bd) { bd = d; best = pl; }
      }
      if (best) {
        const V = best.V, mr = V.s.magnet;
        const dx = V.x - p.x, dy = V.y - p.y, d = bd;
        const pull = 520 * (1 - d / mr) + 160;
        p.vx += (dx / (d || 1)) * pull * dt * 6;
        p.vy += (dy / (d || 1)) * pull * dt * 6;
      }
      p.vx *= 1 - Math.min(1, 4 * dt); p.vy *= 1 - Math.min(1, 4 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (best && bd < 22 + best.V.s.radius * 0.4) {
        if (p.k === 'xp') { this.xp += p.amt * (1 + best.mods.xp); this.checkLevel(); }
        else this.loot[p.k] += p.amt;
        swapRemove(PK, i);
      }
    }

    // fx
    const FX = this.FX;
    for (let i = FX.length - 1; i >= 0; i--) {
      const f = FX[i];
      f.life -= dt;
      if (!f.ring) {
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (!f.text) { f.vx *= 0.94; f.vy *= 0.94; }
        if (f.rot !== undefined) f.rot += (f.vr || 0) * dt;
      }
      if (f.life <= 0) swapRemove(FX, i);
    }
    const BE = this.BEAMS;
    for (let i = BE.length - 1; i >= 0; i--) { BE[i].life -= dt; if (BE[i].life <= 0) swapRemove(BE, i); }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 30 * dt);
    for (const p of this.players) if (p.V.flash > 0) p.V.flash -= dt;
  }

  // ------------------------------------------------------------ level-up cards
  makeCards(p: Player = this.players[0]): Card[] {
    const r = this.rng, V = p.V;
    const cards: Card[] = [];
    const used = new Set<string>();
    const weaponsOn = [...new Set(V.s.weapons.map(b => b.t))];
    const placeable = Object.keys(B).filter(k => !isCab(k) && isUnlocked(k, p.up));
    const canPlace = validCells(V.list, p.gridR + 1).length > 0;
    let guard = 0;
    while (cards.length < 3 && guard++ < 80) {
      const x = r.next();
      let c: Card;
      if (x < 0.45 && canPlace) {
        const t = r.pick(placeable);
        c = { kind: 'block', t, key: 'b' + t, label: 'New block', title: B[t].name, desc: B[t].desc };
      } else if (x < 0.8 && weaponsOn.length) {
        const t = r.pick(weaponsOn), l = p.lvl[t] || 0;
        c = { kind: 'up', t, key: 'u' + t, label: 'Upgrade', title: B[t].name + ' Mk ' + roman(l + 2), desc: '+25% damage and +12% fire rate for every ' + B[t].name + '.' };
      } else {
        const pk = r.pick(PERKS);
        c = { kind: 'perk', p: pk, key: 'p' + pk.id, label: 'Perk', title: pk.name, desc: pk.desc };
      }
      if (used.has(c.key)) continue;
      used.add(c.key);
      cards.push(c);
    }
    const damaged = V.list.some(b => b.hp < b.max * 0.55) || V.list.length < p.build.length;
    if (damaged && r.next() < 0.55) cards[cards.length - 1] = { kind: 'repair', key: 'repair', label: 'Repair', title: 'Field repair', desc: 'Restore every block to full HP.' };
    return cards;
  }

  /** Apply a non-block card. Block cards go through placeBlock() (solo) or autoPlace() (co-op). */
  applyCard(c: Card, p: Player = this.players[0]): void {
    if (c.kind === 'up') p.lvl[c.t] = (p.lvl[c.t] || 0) + 1;
    if (c.kind === 'perk') applyPerk(p.mods, c.p);
    if (c.kind === 'repair') for (const b of p.V.list) b.hp = b.max;
    if (c.kind === 'block') { this.autoPlace(c.t, p); return; }
    this.recompile(p);
  }

  placementCells(p: Player = this.players[0]): [number, number][] { return validCells(p.V.list, p.gridR + 1); }

  placeBlock(x: number, y: number, t: string, p: Player = this.players[0]): Block {
    const nb = addBlock(p.V, x, y, t, 0, p.up, this.rng);
    nb.cd = 0.2;
    this.recompile(p);
    this.updateBlockPositions(p);
    return nb;
  }

  /** Co-op: bolt the block onto a free slot without pausing; weapons face outward. */
  autoPlace(t: string, p: Player): Block | null {
    if (!p.alive) return null;
    const cells = this.placementCells(p);
    if (!cells.length) return null;
    const [x, y] = this.rng.pick(cells);
    const nb = this.placeBlock(x, y, t, p);
    if (B[t].dir) nb.r = Math.abs(y) >= Math.abs(x) ? (y > 0 ? 2 : 0) : x > 0 ? 1 : 3;
    this.recompile(p);
    return nb;
  }

  rotateBlock(b: Block, p: Player = this.players[0]): void {
    b.r = (b.r + 1) % 4;
    this.recompile(p);
  }

  updateBlockPositions(p: Player = this.players[0]): void {
    const V = p.V, a = V.h + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const b of V.list) { b.wx = V.x + (b.x * ca - b.y * sa) * CS; b.wy = V.y + (b.x * sa + b.y * ca) * CS; }
  }

  consumeLevel(): void { this.pendingLevels = Math.max(0, this.pendingLevels - 1); }
}

export function applyPerk(m: Mods, p: PerkDef): void {
  if (p.stat.startsWith('dmg.')) { const k = p.stat.slice(4); m.dmg[k] = (m.dmg[k] || 0) + p.add; return; }
  const key = p.stat as Exclude<keyof Mods, 'dmg'>;
  m[key] = p.max !== undefined ? Math.min(p.max, m[key] + p.add) : m[key] + p.add;
}
