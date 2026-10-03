// One run: movement, director, combat, enemies, loot. Pure simulation, no DOM
// or canvas, so it runs headless in tests and the balance bot.
import { B, DCOL, DTYPES, EB, PERKS, RES, RES_KEYS, T, WORLDS, type DType, type PerkDef, type ResKey, type WorldDef } from '../data';
import { angDiff, clamp, lerp, swapRemove, TAU, roman } from '../core/math';
import { Rng } from '../core/rng';
import { compileSpecies, type Species } from '../enemies/species';
import { evolveWorld } from '../evolution/evolution';
import type { Save, WorldState } from '../persistence/save';
import {
  addBlock, bkey, compileVehicle, freshMods, makeVehicle, neighbours, reachable, validCells,
  type Block, type Mods, type Vehicle,
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
  /** previous-step position, for render interpolation */
  px?: number; py?: number;
}
export interface Projectile {
  x: number; y: number; vx: number; vy: number; dmg: number; type: DType; src: string; life: number; r: number;
  pierce: number; burn: number; hits: Enemy[] | null;
  lob?: boolean; sx?: number; sy?: number; tx?: number; ty?: number; t?: number; T?: number; z?: number; aoe?: number;
}
export interface EnemyBullet { x: number; y: number; vx: number; vy: number; dmg: number; life: number; sp: Species | null }
export interface Pickup { x: number; y: number; k: ResKey | 'xp'; amt: number; vx: number; vy: number }
export interface Deposit { x: number; y: number; res: ResKey; amt: number; prog: number; cache?: boolean }
export interface Hazard { x: number; y: number; r: number }
export interface Fx {
  x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number;
  ring?: boolean; r?: number; block?: boolean; rot?: number; vr?: number; text?: string; big?: boolean;
}
export interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; max: number; c: string; w: number; zig?: boolean; glow?: boolean; seed: number }

export type SimEvent =
  | { k: 'toast'; msg: string; ms: number }
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
}

/** Things measured during a run that feed records and trophies. */
export interface RunStats {
  dist: number; idleT: number; hazardT: number; spins: number; mined: number; caches: number;
  blocksLost: number; maxChain: number; crits: number; minCab: number; takenAt120: number;
  maxHit: number; touched: boolean; firstTouchT: number;
}

export interface RunOptions { seed?: number; /** exhibition run: no loot banked, no evolution */ exhibition?: boolean; visual?: boolean; dmgNumbers?: boolean; viewW?: number; viewH?: number }

export class Run {
  readonly save: Save;
  readonly wk: string;
  readonly W: WorldState;
  readonly Wd: WorldDef;
  readonly rng: Rng;
  readonly visual: boolean;
  dmgNumbers: boolean;

  t = 0; level = 1; xp = 0; xpNeed = 7;
  mods: Mods = freshMods();
  lvl: Record<string, number> = {};
  budget = 2; wave = -1; pattern = 'ring'; patAng = 0; breather = false;
  mb1 = false; mb2 = false; boss = false; bossE: Enemy | null = null;
  won = false; over = false; endT = 0; wonPending = false;
  kills = 0; killsBy: Record<DType, number>; loot: Record<ResKey, number>;
  reroll = 1; pendingLevels = 0;
  dmgBy: Record<string, number> = {}; killsSrc: Record<string, number> = {}; peak: Record<string, number> = {};
  taken = 0; maxR = 30; zoom = 1; spawnD = 600; lavaT = 0; hazWarned = false; nextSp: Species | null = null;
  shake = 0;
  result: RunResult | null = null;
  readonly seed: number;
  readonly exhibition: boolean;
  stats: RunStats = { dist: 0, idleT: 0, hazardT: 0, spins: 0, mined: 0, caches: 0, blocksLost: 0, maxChain: 0, crits: 0, minCab: 1, takenAt120: -1, maxHit: 0, touched: false, firstTouchT: -1 };

  V: Vehicle;
  E: Enemy[] = []; PB: Projectile[] = []; EBL: EnemyBullet[] = []; PK: Pickup[] = [];
  FX: Fx[] = []; BEAMS: Beam[] = []; DEP: Deposit[] = []; HZ: Hazard[] = [];
  events: SimEvent[] = [];
  /** input: joystick vector, length 0..1 */
  joy = { x: 0, y: 0 };

  private hash = new Map<number, Enemy[]>();
  private readonly HS = 80;

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
    this.V = makeVehicle(save.build, save.up, this.rng);
    this.recompile();
    for (const sp of this.W.species) { compileSpecies(sp); sp.st = { n: 0, dmg: 0, life: 0 }; }
    this.genMap();
    this.setView(opts.viewW ?? 1024, opts.viewH ?? 768);
  }

  setView(w: number, h: number): void {
    this.zoom = clamp(Math.min(w, h) / 620, 0.72, 1.6);
    this.spawnD = Math.hypot(w, h) / 2 / this.zoom + 70;
  }

  private emit(e: SimEvent) { if (this.visual) this.events.push(e); }
  private toast(msg: string, ms = 1600) { this.emit({ k: 'toast', msg, ms }); }
  private snd(f: number, dur: number, type: OscillatorType, vol: number) { this.emit({ k: 'snd', f, dur, type, vol }); }
  private up(t: string) { return this.save.up[t] || 0; }

  recompile(): void {
    compileVehicle(this.V, this.mods, this.save.up);
    const cnt: Record<string, number> = {};
    for (const b of this.V.list) cnt[b.t] = (cnt[b.t] || 0) + 1;
    for (const t in cnt) this.peak[t] = Math.max(this.peak[t] || 0, cnt[t]);
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
      if (n > 0 && !this.exhibition) { gained[r] = n; save.res[r] += n; }
    }
    let rep = { lines: ['Challenge runs are exhibition matches: no loot is banked and the sector does not evolve.'], children: 0 };
    if (!this.exhibition) {
      W.runs++; save.runs++;
      if (won) { W.wins++; save.wins++; }
      rep = evolveWorld(save, this.wk, this.killsBy, this.rng);
      if (won) W.tier = Math.min(12, W.tier + 1);
    }
    this.snd(won ? 660 : 140, 0.6, won ? 'triangle' : 'sawtooth', 0.05);
    this.result = {
      won, t: this.t, kills: this.kills, level: this.level, gained, report: rep.lines, wk: this.wk,
      dmg: { ...this.dmgBy }, ks: { ...this.killsSrc }, peak: { ...this.peak }, taken: this.taken, newSpecies: rep.children,
      stats: { ...this.stats }, loot: lootTotal, seed: this.seed,
    };
  }

  // ------------------------------------------------------------ director
  private pickSpecies(): Species {
    const ws: Record<string, number> = {};
    for (const s of this.W.species) ws[s.id] = s.pop || 1;
    const id = +this.rng.wpick(ws);
    return this.W.species.find(s => s.id === id) || this.W.species[0];
  }

  private spawnPos(): { x: number; y: number } {
    const r = this.rng, V = this.V;
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
    const c = sp.c, tier = this.W.tier, V = this.V;
    let hpM = (1 + 0.4 * (tier - 1)) * (1 + this.t / 260);
    let sc = 1, spdM = 1, dmgM = 1 + 0.12 * (tier - 1);
    if (bossLv === 1) { hpM *= 10; sc = 1.9; spdM = 0.75; dmgM *= 2.2; }
    if (bossLv === 2) { hpM *= 16 * (1 + 0.15 * (this.W.era - 1)); sc = 2.7; spdM = 0.65; dmgM *= 2.2; }
    const e: Enemy = {
      sp, x, y, vx: 0, vy: 0, h: Math.atan2(V.y - y, V.x - x), hp: c.hp * hpM, max: c.hp * hpM, sc, r: (c.ext + 0.6) * EC * sc,
      speed: c.speed * spdM, melee: c.melee * dmgM, gun: bossLv ? 7 * (1 + 0.12 * (tier - 1)) : c.gun * dmgM, boom: bossLv ? 0 : c.boom * dmgM,
      res: c.res, pref: sp.pref || (bossLv ? 160 : 0), cd: this.rng.range(0.5, 1.8), flash: 0, burn: 0, burnDps: 0, dead: false,
      t0: this.t, bossLv, lastType: 'kinetic', dmgAcc: 0, dmgT: 0, crit: false,
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
    const r = this.rng, V = this.V;
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
    let rate = (0.7 + t / 38) * (0.8 + 0.2 * this.W.tier) * lvlAdj;
    if (this.breather) rate *= 0.35;
    if (this.boss) rate *= 0.3;
    this.budget = Math.min(this.budget + rate * dt, T.budgetCap);
    let guard = 0;
    while (this.E.length < T.maxEnemies && guard++ < 12) {
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

  private credit(src: string | undefined, dmg: number, e: Enemy): void {
    if (!src) return;
    this.dmgBy[src] = (this.dmgBy[src] || 0) + Math.min(dmg, Math.max(0, e.hp));
  }

  private resist(e: Enemy, type: DType) { return Math.min(0.75, (e.res[type] || 0) + (this.W.res[type] || 0)); }

  hitEnemy(e: Enemy, dmg: number, type: DType, src?: string): void {
    if (e.dead) return;
    let crit = false;
    if (this.rng.next() < this.mods.crit) { dmg *= 2; crit = true; }
    dmg *= 1 - this.resist(e, type);
    this.credit(src, dmg, e);
    e.hp -= dmg; e.flash = 0.07; e.lastType = type;
    if (src) e.lastSrc = src;
    if (crit) this.stats.crits++;
    if (dmg > this.stats.maxHit) this.stats.maxHit = dmg;
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
    if (this.dmgNumbers) this.flushDmg(e);
    this.killsBy[e.lastType] = (this.killsBy[e.lastType] || 0) + 1;
    if (e.lastSrc) this.killsSrc[e.lastSrc] = (this.killsSrc[e.lastSrc] || 0) + 1;
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
    if (this.mods.heal) { const b = this.V.list.find(o => o.hp < o.max); if (b) b.hp = Math.min(b.max, b.hp + this.mods.heal); }
    this.shake = Math.max(this.shake, e.bossLv ? 14 : 1.5);
    if (e.bossLv) this.snd(100, 0.8, 'sawtooth', 0.06);
    else if (r.next() < 0.3) this.snd(220, 0.08, 'triangle', 0.02);
    if (e.bossLv === 2 && !this.over) { this.wonPending = true; this.endT = this.t + 1.2; this.toast('APEX DESTROYED', 1800); }
  }

  private dropXP(x: number, y: number, amt: number): void {
    if (this.PK.length > 520) { this.xp += amt * (1 + this.mods.xp); this.checkLevel(); return; }
    this.PK.push({ x, y, k: 'xp', amt, vx: 0, vy: 0 });
  }

  private checkLevel(): void {
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = Math.round(5 + this.level * 4 + this.level * this.level * 0.2);
      this.pendingLevels++;
    }
  }

  private explode(x: number, y: number, r: number, dmg: number, type: DType, src?: string): void {
    this.query(x, y, r + this.maxR, e => { const d = Math.hypot(e.x - x, e.y - y); if (d < r + e.r) this.hitEnemy(e, dmg, type, src); });
    this.ring(x, y, r, DCOL[type]);
    this.burst(x, y, 10, DCOL[type], 180);
    this.shake = Math.max(this.shake, 3);
    this.snd(90, 0.25, 'sawtooth', 0.025);
  }

  private fireWeapons(dt: number): void {
    const s = this.V.s, V = this.V, r = this.rng;
    for (const b of s.weapons) {
      if (b.dead) continue;
      const d = B[b.t], w = d.w!, lv = this.lvl[b.t] || 0;
      b.cd -= dt;
      if (b.cd > 0) continue;
      const range = w.range * (1 + this.mods.range);
      const face = V.h + (d.dir ? (b.r * Math.PI) / 2 : 0);
      const tgt = this.findTarget(b.wx, b.wy, range, face, (w.arc * Math.PI) / 180);
      if (!tgt) { b.cd = 0.08; continue; }
      const U = this.up(b.t);
      const rate = w.rate * (1 + 0.12 * lv) * (1 + 0.05 * U) * (1 + this.mods.rate) * b.syn.rateM * s.powerFactor;
      b.cd = 1 / rate;
      const dmg = w.dmg * (1 + 0.25 * lv) * (1 + 0.15 * U) * (1 + (this.mods.dmg[w.type] || 0)) * b.syn.dmgM;
      const src = b.t;
      const ang = Math.atan2(tgt.y - b.wy, tgt.x - b.wx);
      if (w.beam) {
        this.hitEnemy(tgt, dmg, w.type, src);
        if (this.visual) this.BEAMS.push({ x1: b.wx, y1: b.wy, x2: tgt.x, y2: tgt.y, life: 0.12, max: 0.12, c: DCOL.energy, w: 3, glow: true, seed: r.next() });
        this.emit({ k: 'shot', f: 880 });
      } else if (w.chain) {
        const links = w.chain + b.syn.chain;
        const hit: Enemy[] = [tgt];
        let cur = tgt, px = b.wx, py = b.wy;
        for (let j = 0; j <= links; j++) {
          if (this.visual) {
            this.BEAMS.push({ x1: px, y1: py, x2: cur.x, y2: cur.y, life: 0.16, max: 0.16, c: DCOL.electric, w: 3.5, zig: true, glow: true, seed: r.next() });
            if (this.FX.length < 600) this.burst(cur.x, cur.y, 3, '#e6dcff', 120);
          }
          this.hitEnemy(cur, dmg * (j === 0 ? 1 : T.teslaFalloff), 'electric', src);
          if (j + 1 > this.stats.maxChain) this.stats.maxChain = j + 1;
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
        this.emit({ k: 'shot', f: 520 });
      } else if (w.lob) {
        const TT = 0.85;
        this.PB.push({ lob: true, sx: b.wx, sy: b.wy, tx: tgt.x + tgt.vx * TT * 0.6, ty: tgt.y + tgt.vy * TT * 0.6, t: 0, T: TT, x: b.wx, y: b.wy,
          vx: 0, vy: 0, dmg, type: w.type, src, aoe: w.aoe, life: TT + 0.1, r: 4, pierce: 0, burn: 0, hits: null });
        this.emit({ k: 'shot', f: 160 });
      } else {
        const n = w.pellets || 1;
        for (let i = 0; i < n; i++) {
          const a = ang + r.range(-(w.spread || 0), w.spread || 0);
          const sp = (w.speed || 600) * r.range(0.9, 1.08);
          this.PB.push({ x: b.wx, y: b.wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, type: w.type, src,
            life: w.life || range / (w.speed || 600) + 0.05, r: w.type === 'fire' ? 7 : 3, pierce: w.pierce || 0, burn: w.burn || 0, hits: null });
        }
        this.emit({ k: 'shot', f: w.type === 'fire' ? 200 : 330 });
      }
    }
  }

  private nearestBlock(x: number, y: number): { b: Block | null; d: number } {
    let best: Block | null = null, bd = Infinity;
    for (const b of this.V.list) { const d = (b.wx - x) ** 2 + (b.wy - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return { b: best, d: Math.sqrt(bd) };
  }

  hitPlayer(b: Block | null, dmg: number, sp: Species | null): void {
    if (!b || this.over || b.dead) return;
    const V = this.V;
    dmg *= 1 - this.mods.armor;
    if (B[b.t].cat !== 'armor') {
      let arm: Block | null = null;
      for (const n of neighbours(V, b)) if (B[n.t].cat === 'armor' && (!arm || n.hp > arm.hp)) arm = n;
      if (arm) {
        const tr = dmg * 0.4;
        dmg -= tr; arm.hp -= tr; arm.fl = 0.1;
        if (arm.hp <= 0) this.destroyBlock(arm);
      }
    }
    if (sp) sp.st.dmg += dmg;
    if (b.dead) return;
    this.taken += dmg;
    b.hp -= dmg; b.fl = 0.1; V.flash = 0.08;
    this.shake = Math.max(this.shake, Math.min(8, 1 + dmg * 0.2));
    if (b.hp <= 0) this.destroyBlock(b);
  }

  private destroyBlock(b: Block): void {
    if (b.dead || this.over) return;
    const V = this.V;
    b.dead = true;
    V.list = V.list.filter(o => o !== b);
    V.map.delete(bkey(b.x, b.y));
    this.burst(b.wx, b.wy, 14, B[b.t].color, 200);
    this.shake = Math.max(this.shake, 7);
    this.snd(180, 0.3, 'sawtooth', 0.04);
    this.emit({ k: 'hurt' });
    if (b.t === 'cab') { this.end(false); return; }
    const keep = reachable(V);
    const lost = V.list.filter(o => !keep.has(o));
    this.stats.blocksLost += 1 + lost.length;
    if (lost.length) {
      for (const o of lost) { o.dead = true; V.map.delete(bkey(o.x, o.y)); this.debris(o); }
      V.list = V.list.filter(o => keep.has(o));
      this.toast(lost.length === 1 ? B[lost[0].t].name + ' broke off!' : lost.length + ' blocks broke off!', 1400);
    } else this.toast(B[b.t].name + ' destroyed', 900);
    this.recompile();
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

  // ------------------------------------------------------------ step
  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    if (this.wonPending && this.t >= this.endT) { this.end(true); return; }
    const V = this.V, s = V.s, r = this.rng;
    const haz = this.Wd.hazard;
    const onHaz = this.inHazard(V.x, V.y);

    // movement
    const mag = Math.min(1, Math.hypot(this.joy.x, this.joy.y));
    let fwd = 0;
    const st = this.stats;
    if (mag > 0.05) {
      if (!st.touched) { st.touched = true; st.firstTouchT = this.t; }
      const ta = Math.atan2(this.joy.y, this.joy.x);
      const da = angDiff(V.h, ta);
      const tr = s.turn * dt;
      const turn = clamp(da, -tr, tr);
      V.h += turn;
      st.spins += Math.abs(turn) / TAU;
      fwd = Math.max(0.2, Math.cos(angDiff(V.h, ta)));
    } else st.idleT += dt;
    if (onHaz) st.hazardT += dt;
    if (st.takenAt120 < 0 && this.t >= 120) st.takenAt120 = this.taken;
    const cabB = V.map.get(bkey(0, 0));
    if (cabB) st.minCab = Math.min(st.minCab, cabB.hp / cabB.max);
    let spd = s.speed * mag * fwd;
    let grip = 6;
    if (onHaz && haz === 'mud') spd *= 0.42 + 0.58 * s.trackFrac;
    if (onHaz && haz === 'ice') grip *= 0.18 + 0.82 * s.trackFrac;
    const k = 1 - Math.exp(-grip * dt);
    V.vx += (Math.cos(V.h) * spd - V.vx) * k;
    V.vy += (Math.sin(V.h) * spd - V.vy) * k;
    V.x = clamp(V.x + V.vx * dt, -ARENA + 30, ARENA - 30);
    V.y = clamp(V.y + V.vy * dt, -ARENA + 30, ARENA - 30);
    st.dist += Math.hypot(V.vx, V.vy) * dt;

    // block world positions
    const a = V.h + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const b of V.list) {
      b.wx = V.x + (b.x * ca - b.y * sa) * CS;
      b.wy = V.y + (b.x * sa + b.y * ca) * CS;
      if (b.fl > 0) b.fl -= dt;
    }

    // hazards
    if (onHaz && haz === 'lava') {
      this.lavaT += dt;
      if (!this.hazWarned) { this.hazWarned = true; this.toast(this.Wd.hazardText, 2400); }
      if (this.lavaT >= 0.25) {
        this.lavaT = 0;
        const dmg = 2.5 * (1 - s.hoverFrac);
        if (dmg > 0.2 && V.list.length) this.hitPlayer(r.pick(V.list), dmg, null);
        if (this.over) return;
      }
    } else if (onHaz && !this.hazWarned) { this.hazWarned = true; this.toast(this.Wd.hazardText, 2400); }

    // regen / repair
    for (const b of V.list) {
      const d = B[b.t];
      const hm = 1 + 0.25 * this.up(b.t);
      const heal = this.mods.regen + (d.regen || 0) * hm;
      if (heal) b.hp = Math.min(b.max, b.hp + heal * dt);
      if (d.repair) for (const n of neighbours(V, b)) n.hp = Math.min(n.max, n.hp + d.repair * hm * dt);
    }

    this.director(dt);
    this.buildHash();
    this.fireWeapons(dt);
    if (this.over) return;

    // player projectiles
    const PB = this.PB;
    for (let i = PB.length - 1; i >= 0; i--) {
      const p = PB[i];
      p.life -= dt;
      if (p.lob) {
        p.t! += dt;
        const kk = Math.min(1, p.t! / p.T!);
        p.x = lerp(p.sx!, p.tx!, kk); p.y = lerp(p.sy!, p.ty!, kk); p.z = Math.sin(kk * Math.PI) * 60;
        if (kk >= 1) { this.explode(p.tx!, p.ty!, p.aoe!, p.dmg, p.type, p.src); swapRemove(PB, i); }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      let done = false;
      this.query(p.x, p.y, p.r + this.maxR, e => {
        if (done) return;
        if (p.hits && p.hits.includes(e)) return;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
          this.hitEnemy(e, p.dmg, p.type, p.src);
          if (p.burn) {
            e.burn = 2; e.burnSrc = p.src;
            e.burnDps = Math.max(e.burnDps, p.burn * (1 + 0.15 * this.up(p.src)) * (1 + (this.mods.dmg.fire || 0)));
          }
          if (p.pierce > 0) { p.pierce--; (p.hits || (p.hits = [])).push(e); }
          else done = true;
        }
      });
      if (done || p.life <= 0) swapRemove(PB, i);
    }

    // enemies
    const pr = s.radius;
    for (const e of this.E) {
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.burn > 0) {
        e.burn -= dt; e.lastType = 'fire'; e.lastSrc = e.burnSrc;
        const bd = e.burnDps * dt * (1 - this.resist(e, 'fire'));
        this.credit(e.burnSrc, bd, e);
        e.hp -= bd;
        if (this.dmgNumbers) e.dmgAcc += bd;
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }
      if (this.dmgNumbers && e.dmgAcc > 0 && this.t - e.dmgT > 0.3) this.flushDmg(e);
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
      // contact with the vehicle
      if (d < pr + e.r) {
        const nb = this.nearestBlock(e.x, e.y);
        if (nb.b && nb.d < CS * 0.62 + e.r) {
          if (e.boom > 0) {
            for (const b of V.list.slice()) {
              const bd = Math.hypot(b.wx - e.x, b.wy - e.y);
              if (bd < 50) this.hitPlayer(b, e.boom * (1 - bd / 70), e.sp);
              if (this.over) return;
            }
            this.ring(e.x, e.y, 50, '#ff7a1a');
            this.burst(e.x, e.y, 12, '#ff7a1a', 200);
            e.dead = true;
            e.sp.st.life += this.t - e.t0;
            continue;
          }
          this.hitPlayer(nb.b, e.melee * dt * 0.8, e.sp);
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
            this.EBL.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240, dmg: e.gun, life: 2.2, sp: e.sp });
          }
        }
      }
    }
    this.E = this.E.filter(e => !e.dead);

    // enemy bullets
    const EBL = this.EBL;
    for (let i = EBL.length - 1; i >= 0; i--) {
      const p = EBL[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      let hit = false;
      if (Math.hypot(p.x - V.x, p.y - V.y) < pr + 4) {
        const nb = this.nearestBlock(p.x, p.y);
        if (nb.b && nb.d < CS * 0.62 + 4) { this.hitPlayer(nb.b, p.dmg, p.sp); hit = true; if (this.over) return; }
      }
      if (hit || p.life <= 0) swapRemove(EBL, i);
    }

    // deposits
    const DEP = this.DEP;
    for (let i = DEP.length - 1; i >= 0; i--) {
      const dp = DEP[i];
      if (Math.hypot(dp.x - V.x, dp.y - V.y) < 44 + pr * 0.5) {
        dp.prog += dt / 1.6;
        if (dp.prog >= 1) {
          if (dp.cache) this.stats.caches++; else this.stats.mined++;
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

    // pickups
    const mr = s.magnet, PK = this.PK;
    for (let i = PK.length - 1; i >= 0; i--) {
      const p = PK[i];
      const dx = V.x - p.x, dy = V.y - p.y, d = Math.hypot(dx, dy);
      if (d < mr) {
        const pull = 520 * (1 - d / mr) + 160;
        p.vx += (dx / (d || 1)) * pull * dt * 6;
        p.vy += (dy / (d || 1)) * pull * dt * 6;
      }
      p.vx *= 1 - Math.min(1, 4 * dt); p.vy *= 1 - Math.min(1, 4 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (d < 22 + pr * 0.4) {
        if (p.k === 'xp') { this.xp += p.amt * (1 + this.mods.xp); this.checkLevel(); }
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
    if (V.flash > 0) V.flash -= dt;
  }

  // ------------------------------------------------------------ level-up cards
  makeCards(): Card[] {
    const r = this.rng, V = this.V;
    const cards: Card[] = [];
    const used = new Set<string>();
    const weaponsOn = [...new Set(V.s.weapons.map(b => b.t))];
    const placeable = Object.keys(B).filter(k => k !== 'cab');
    const canPlace = validCells(V.list, this.save.gridR + 1).length > 0;
    let guard = 0;
    while (cards.length < 3 && guard++ < 80) {
      const x = r.next();
      let c: Card;
      if (x < 0.45 && canPlace) {
        const t = r.pick(placeable);
        c = { kind: 'block', t, key: 'b' + t, label: 'New block', title: B[t].name, desc: B[t].desc };
      } else if (x < 0.8 && weaponsOn.length) {
        const t = r.pick(weaponsOn), l = this.lvl[t] || 0;
        c = { kind: 'up', t, key: 'u' + t, label: 'Upgrade', title: B[t].name + ' Mk ' + roman(l + 2), desc: '+25% damage and +12% fire rate for every ' + B[t].name + '.' };
      } else {
        const p = r.pick(PERKS);
        c = { kind: 'perk', p, key: 'p' + p.id, label: 'Perk', title: p.name, desc: p.desc };
      }
      if (used.has(c.key)) continue;
      used.add(c.key);
      cards.push(c);
    }
    const damaged = V.list.some(b => b.hp < b.max * 0.55) || V.list.length < this.save.build.length;
    if (damaged && r.next() < 0.55) cards[cards.length - 1] = { kind: 'repair', key: 'repair', label: 'Repair', title: 'Field repair', desc: 'Restore every block to full HP.' };
    return cards;
  }

  /** Apply a non-block card. Block cards go through placeBlock(). */
  applyCard(c: Card): void {
    if (c.kind === 'up') this.lvl[c.t] = (this.lvl[c.t] || 0) + 1;
    if (c.kind === 'perk') applyPerk(this.mods, c.p);
    if (c.kind === 'repair') for (const b of this.V.list) b.hp = b.max;
    this.recompile();
  }

  placementCells(): [number, number][] { return validCells(this.V.list, this.save.gridR + 1); }

  placeBlock(x: number, y: number, t: string): Block {
    const nb = addBlock(this.V, x, y, t, 0, this.save.up, this.rng);
    nb.cd = 0.2;
    this.recompile();
    this.updateBlockPositions();
    return nb;
  }

  rotateBlock(b: Block): void {
    b.r = (b.r + 1) % 4;
    this.recompile();
  }

  updateBlockPositions(): void {
    const V = this.V, a = V.h + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const b of V.list) { b.wx = V.x + (b.x * ca - b.y * sa) * CS; b.wy = V.y + (b.x * sa + b.y * ca) * CS; }
  }

  consumeLevel(): void { this.pendingLevels = Math.max(0, this.pendingLevels - 1); }
}

export function applyPerk(m: Mods, p: PerkDef): void {
  if (p.stat.startsWith('dmg.')) { const k = p.stat.slice(4); m.dmg[k] = (m.dmg[k] || 0) + p.add; return; }
  const key = p.stat as Exclude<keyof Mods, 'dmg'>;
  m[key] = p.max !== undefined ? Math.min(p.max, m[key] + p.add) : m[key] + p.add;
}
