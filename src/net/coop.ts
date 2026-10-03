// Co-op wire format. The host runs the real simulation; clients get compact
// snapshots (Int16 arrays) about 12 times a second and render a "mirror" Run
// that is never stepped, only smoothed and extrapolated between snapshots.
import { B, DTYPES, RES_KEYS, T, type Cell, type DType, type ResKey } from '../data';
import { angDiff, TAU } from '../core/math';
import { compileSpecies, type Species } from '../enemies/species';
import { defaultSave } from '../persistence/save';
import { Run, type Card, type Enemy, type Hazard, type PlayerSpec, type Projectile, type RunResult } from '../sim/run';
import { compileVehicle, freshMods, makeVehicle, type BuildCell } from '../vehicle/vehicle';

export const SNAP_HZ = 12;
const TYPES = Object.keys(B);
const VERSION = 3;

export interface SpeciesWire { id: number; name: string; cells: Cell[]; pref: number; spd: number }

export interface CoopStart {
  wk: string; seed: number; specs: PlayerSpec[]; species: SpeciesWire[]; hz: Hazard[]; tier: number; era: number;
}

export type CoopMsg =
  | { k: 'coop_lobby'; open: boolean; wk: string; host: string; hostPid: string; members: string[] }
  | { k: 'coop_join'; spec: PlayerSpec }
  | { k: 'coop_unjoin'; pid: string }
  | { k: 'coop_start'; s: CoopStart }
  | { k: 'snap'; buf: ArrayBuffer }
  | { k: 'in'; pid: string; x: number; y: number }
  | { k: 'cards'; pid: string; cards: Card[] }
  | { k: 'pick'; pid: string; i: number }
  | { k: 'ev'; msg: string; ms: number; pid?: string }
  | { k: 'coop_end'; results: Record<string, RunResult> }
  | { k: 'coop_quit'; pid: string };

/** Message kinds only the host needs; the crew host does not relay them. */
export const HOST_ONLY = new Set(['coop_join', 'coop_unjoin', 'in', 'pick', 'coop_quit']);

export function startInfo(run: Run): CoopStart {
  return {
    wk: run.wk, seed: run.seed, tier: run.W.tier, era: run.W.era,
    specs: run.players.map(p => ({ pid: p.pid, name: p.name, build: p.build, up: p.up, gridR: p.gridR, color: p.color })),
    species: run.W.species.map(s => ({ id: s.id, name: s.name, cells: s.cells, pref: s.pref, spd: s.spd })),
    hz: run.HZ,
  };
}

// ------------------------------------------------------------------ encode (host)
const I = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

export function encodeSnapshot(run: Run): ArrayBuffer {
  const out: number[] = [];
  const spIdx = new Map(run.W.species.map((s, i) => [s, i]));
  const boss = run.bossE && !run.bossE.dead ? run.bossE : null;
  out.push(VERSION, I(run.t * 10), run.wave, run.breather ? 1 : 0, run.level, I(run.xp), I(run.xpNeed), I(run.kills),
    boss ? boss.id % 32000 : -1, boss ? I((boss.hp / boss.max) * 1000) : 0, I(run.shake * 10), run.over ? 1 : 0);
  for (const r of RES_KEYS) out.push(I(run.loot[r]));
  // players
  out.push(run.players.length);
  for (const p of run.players) {
    const V = p.V;
    out.push(p.alive ? 1 : 0, p.gone ? 1 : 0, I(V.x), I(V.y), I(V.h * 1000), I(V.vx), I(V.vy), I(V.flash * 100), I(p.respawnT * 10), p.pendingCards, I(p.kills), V.list.length);
    for (const b of V.list) out.push(b.x, b.y, TYPES.indexOf(b.t), b.r, I((b.hp / b.max) * 1000), b.fl > 0 ? 1 : 0);
  }
  // enemies
  out.push(run.E.length);
  for (const e of run.E) {
    const flags = (e.flash > 0 ? 1 : 0) | (e.burn > 0 ? 2 : 0) | (e.bossLv === 1 ? 4 : 0) | (e.bossLv === 2 ? 8 : 0) | (e.isMini ? 16 : 0);
    out.push(e.id % 32000, spIdx.get(e.sp) ?? 0, I(e.x), I(e.y), I(e.h * 1000), I(e.vx), I(e.vy), I((e.hp / e.max) * 1000), flags);
  }
  // player projectiles (cap to keep packets small)
  const pb = run.PB.length > 400 ? run.PB.slice(-400) : run.PB;
  out.push(pb.length);
  for (const p of pb) {
    if (p.lob) out.push(1, I(p.x), I(p.y), I(p.z || 0), I(p.aoe || 0), TYPES.indexOf(p.src), DTYPES.indexOf(p.type), I(p.tx!), I(p.ty!));
    else out.push(0, I(p.x), I(p.y), I(p.vx), I(p.vy), TYPES.indexOf(p.src), DTYPES.indexOf(p.type), I(p.life * 1000), I(p.r));
  }
  out.push(run.EBL.length);
  for (const b of run.EBL) out.push(I(b.x), I(b.y), I(b.vx), I(b.vy));
  const pk = run.PK.length > 500 ? run.PK.slice(-500) : run.PK;
  out.push(pk.length);
  for (const p of pk) out.push(I(p.x), I(p.y), p.k === 'xp' ? 0 : RES_KEYS.indexOf(p.k) + 1, I(p.amt));
  out.push(run.DEP.length);
  for (const d of run.DEP) out.push(I(d.x), I(d.y), RES_KEYS.indexOf(d.res), I(d.prog * 1000), d.cache ? 1 : 0);
  out.push(run.BEAMS.length);
  for (const b of run.BEAMS) out.push(I(b.x1), I(b.y1), I(b.x2), I(b.y2), b.zig ? 1 : 0, I(b.life * 1000), I(b.max * 1000));
  return new Int16Array(out).buffer;
}

// ------------------------------------------------------------------ mirror (client)
interface Target { x: number; y: number; h: number; vx: number; vy: number }

export class Mirror {
  readonly run: Run;
  private species: Species[];
  private enemies = new Map<number, Enemy>();
  private targets = new Map<object, Target>();
  private sig: string[] = [];
  last = 0;

  constructor(s: CoopStart, myPid: string, view: { w: number; h: number }) {
    const save = defaultSave();
    const W = save.worlds[s.wk];
    W.tier = s.tier; W.era = s.era;
    W.species = s.species.map(w => {
      const sp = { id: w.id, name: w.name, cells: w.cells, pref: w.pref, spd: w.spd, pop: 1, born: 0, st: { n: 0, dmg: 0, life: 0 } } as Species;
      compileSpecies(sp);
      return sp;
    });
    this.species = W.species;
    const [first, ...rest] = s.specs;
    save.build = first.build; save.up = first.up; save.gridR = first.gridR;
    const run = new Run(save, s.wk, { seed: s.seed, visual: true, exhibition: true, pid: first.pid, name: first.name, crew: rest, viewW: view.w, viewH: view.h });
    run.players[0].color = first.color ?? run.players[0].color;
    run.HZ = s.hz;
    run.DEP = [];
    run.local = Math.max(0, run.players.findIndex(p => p.pid === myPid));
    this.run = run;
  }

  apply(buf: ArrayBuffer): void {
    const a = new Int16Array(buf);
    let i = 0;
    const n = () => a[i++];
    if (n() !== VERSION) return;
    const run = this.run;
    this.last = performance.now();
    const t = n() / 10;
    if (Math.abs(t - run.t) > 0.5) run.t = t; else run.t += (t - run.t) * 0.5;
    const wave = n(); if (wave !== run.wave) run.wave = wave;
    run.breather = n() === 1; run.level = n(); run.xp = n(); run.xpNeed = n(); run.kills = n();
    const bossId = n(), bossHp = n() / 1000;
    run.shake = Math.max(run.shake * 0.5, n() / 10);
    const over = n() === 1;
    for (const r of RES_KEYS) run.loot[r as ResKey] = n();

    // players
    const np = n();
    for (let k = 0; k < np; k++) {
      const p = run.players[k];
      const alive = n() === 1, gone = n() === 1;
      const x = n(), y = n(), h = n() / 1000, vx = n(), vy = n(), flash = n() / 100;
      const respawnT = n() / 10, pending = n(), kills = n();
      const nb = n();
      const cells: (BuildCell & { hp: number; fl: number })[] = [];
      for (let j = 0; j < nb; j++) cells.push({ x: n(), y: n(), t: TYPES[n()] || 'armor', r: n(), hp: n() / 1000, fl: n() });
      if (!p) continue;
      p.alive = alive; p.gone = gone; p.respawnT = respawnT; p.pendingCards = pending; p.kills = kills;
      const sig = cells.map(c => c.x + ',' + c.y + c.t + c.r).join('|');
      if (sig !== this.sig[k]) {
        // composition changed: rebuild the truck model
        const keep = { x: p.V.x, y: p.V.y, h: p.V.h, vx: p.V.vx, vy: p.V.vy };
        const fresh = this.sig[k] === undefined;
        p.V = makeVehicle(cells, p.up);
        compileVehicle(p.V, freshMods(), p.up);
        if (!fresh) Object.assign(p.V, keep); else Object.assign(p.V, { x, y, h, vx, vy });
        this.sig[k] = sig;
      }
      p.V.list.forEach((b, j) => { b.hp = cells[j].hp * b.max; b.fl = cells[j].fl ? 0.1 : 0; });
      p.V.flash = Math.max(p.V.flash, flash);
      const tgt = { x, y, h, vx, vy };
      if (Math.hypot(p.V.x - x, p.V.y - y) > 200) Object.assign(p.V, tgt); // teleport (respawn)
      this.targets.set(p, tgt);
    }

    // enemies
    const ne = n();
    const seen = new Set<number>();
    for (let k = 0; k < ne; k++) {
      const id = n(), si = n(), x = n(), y = n(), h = n() / 1000, vx = n(), vy = n(), hp = n() / 1000, fl = n();
      seen.add(id);
      let e = this.enemies.get(id);
      const bossLv = fl & 8 ? 2 : fl & 4 ? 1 : 0;
      if (!e) {
        const sp = this.species[si] || this.species[0];
        const sc = bossLv === 2 ? 2.7 : bossLv === 1 ? 1.9 : 1;
        e = { sp, x, y, vx, vy, h, hp: hp * 100, max: 100, sc, r: (sp.c.ext + 0.6) * T.enemyCell * sc, speed: 0, melee: 0, gun: 0, boom: 0, res: {},
          pref: 0, cd: 0, flash: 0, burn: 0, burnDps: 0, dead: false, t0: 0, bossLv, lastType: 'kinetic', dmgAcc: 0, dmgT: 0, crit: false,
          id, lastO: 0, burnO: 0, isMini: !!(fl & 16) } as Enemy;
        this.enemies.set(id, e);
      }
      e.hp = hp * e.max; e.flash = fl & 1 ? 0.07 : 0; e.burn = fl & 2 ? 0.5 : 0;
      this.targets.set(e, { x, y, h, vx, vy });
    }
    for (const [id, e] of this.enemies) {
      if (seen.has(id)) continue;
      this.enemies.delete(id);
      this.targets.delete(e);
      if (e.hp <= e.max * 0.15 || e.bossLv) this.burst(e.x, e.y, e.bossLv ? 40 : 7, '#ff1f4b', e.bossLv ? 260 : 140);
    }
    run.E = [...this.enemies.values()];
    run.bossE = bossId >= 0 ? this.enemies.get(bossId) ?? null : null;
    if (run.bossE) run.bossE.hp = bossHp * run.bossE.max;

    // projectiles
    const oldLobs = run.PB.filter(p => p.lob);
    const npb = n();
    const PB: Projectile[] = [];
    for (let k = 0; k < npb; k++) {
      const lob = n() === 1;
      if (lob) {
        const x = n(), y = n(), z = n(), aoe = n(), src = TYPES[n()], type = DTYPES[n()] as DType, tx = n(), ty = n();
        PB.push({ lob: true, x, y, z, aoe, src, type, tx, ty, vx: 0, vy: 0, dmg: 0, life: 1, r: 4, pierce: 0, burn: 0, hits: null, o: 0 });
      } else {
        const x = n(), y = n(), vx = n(), vy = n(), src = TYPES[n()], type = DTYPES[n()] as DType, life = n() / 1000, r = n();
        PB.push({ x, y, vx, vy, src, type, life, r, dmg: 0, pierce: 0, burn: 0, hits: null, o: 0 });
      }
    }
    // a mortar shell that vanished has landed: show the blast
    for (const o of oldLobs) if (!PB.some(p => p.lob && p.tx === o.tx && p.ty === o.ty)) {
      run.FX.push({ ring: true, x: o.tx!, y: o.ty!, r: o.aoe || 60, vx: 0, vy: 0, life: 0.3, max: 0.3, c: '#d07dff', s: 0 });
      this.burst(o.tx!, o.ty!, 10, '#d07dff', 180);
    }
    run.PB = PB;
    const neb = n();
    run.EBL = [];
    for (let k = 0; k < neb; k++) run.EBL.push({ x: n(), y: n(), vx: n(), vy: n(), dmg: 0, life: 1, sp: null });
    const npk = n();
    run.PK = [];
    for (let k = 0; k < npk; k++) { const x = n(), y = n(), kk = n(), amt = n(); run.PK.push({ x, y, k: kk === 0 ? 'xp' : RES_KEYS[kk - 1], amt, vx: 0, vy: 0 }); }
    const nd = n();
    run.DEP = [];
    for (let k = 0; k < nd; k++) { const x = n(), y = n(), r = n(), prog = n() / 1000, cache = n() === 1; run.DEP.push({ x, y, res: RES_KEYS[r], prog, cache, amt: 0 }); }
    const nbm = n();
    run.BEAMS = [];
    for (let k = 0; k < nbm; k++) {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n(), zig = n() === 1, life = n() / 1000, max = n() / 1000;
      run.BEAMS.push({ x1, y1, x2, y2, zig, life, max, glow: true, c: zig ? '#9fd0ff' : '#ff3b5c', w: zig ? 3.5 : 3, seed: 0 });
    }
    if (over) run.over = true;
  }

  private burst(x: number, y: number, cnt: number, c: string, sp: number) {
    const FX = this.run.FX;
    if (FX.length > 600) return;
    for (let i = 0; i < cnt; i++) {
      const a = Math.random() * TAU, v = (0.2 + Math.random() * 0.8) * sp;
      FX.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, max: 0.6, c, s: 2 + Math.random() * 2.5 });
    }
  }

  /** Between snapshots: predict the local truck, extrapolate everything else, ease toward the host's truth. */
  advance(dt: number, joy: { x: number; y: number }): void {
    const run = this.run;
    if (!run.over) run.t += dt;
    const k = 1 - Math.exp(-10 * dt);
    for (const p of run.players) {
      const tg = this.targets.get(p);
      const V = p.V;
      if (!tg || !p.alive) continue;
      if (p.idx === run.local) {
        Run.drive(V, joy, dt, run.inHazard(V.x, V.y), run.Wd.hazard);
        V.x += (tg.x - V.x) * k * 0.6; V.y += (tg.y - V.y) * k * 0.6;
        V.h += angDiff(V.h, tg.h) * k * 0.5;
        tg.x += tg.vx * dt; tg.y += tg.vy * dt;
      } else {
        tg.x += tg.vx * dt; tg.y += tg.vy * dt;
        V.x += (tg.x - V.x) * k; V.y += (tg.y - V.y) * k;
        V.h += angDiff(V.h, tg.h) * k;
        V.vx = tg.vx; V.vy = tg.vy;
      }
      run.updateBlockPositions(p);
      if (V.flash > 0) V.flash -= dt;
      for (const b of V.list) if (b.fl > 0) b.fl -= dt;
    }
    for (const e of run.E) {
      const tg = this.targets.get(e);
      if (!tg) continue;
      tg.x += tg.vx * dt; tg.y += tg.vy * dt;
      e.x += (tg.x - e.x) * k; e.y += (tg.y - e.y) * k;
      e.vx = tg.vx; e.vy = tg.vy;
      e.h += angDiff(e.h, tg.h) * k;
      if (e.flash > 0) e.flash -= dt;
    }
    for (const p of run.PB) if (!p.lob) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (const b of run.EBL) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const b of run.BEAMS) b.life -= dt;
    const FX = run.FX;
    for (let i = FX.length - 1; i >= 0; i--) {
      const f = FX[i];
      f.life -= dt;
      if (!f.ring) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; }
      if (f.life <= 0) { FX[i] = FX[FX.length - 1]; FX.pop(); }
    }
    if (run.shake > 0) run.shake = Math.max(0, run.shake - 30 * dt);
  }
}
