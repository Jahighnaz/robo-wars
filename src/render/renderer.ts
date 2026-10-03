// Neon canvas renderer. Reads simulation state, never changes it.
// Everything with a glow is pre-rendered once into sprite canvases, because
// per-frame shadowBlur is too slow on mobile GPUs.
import { B, DCOL, EB, RES, T, type DType } from '../data';
import { clamp, lerp, TAU } from '../core/math';
import type { Run } from '../sim/run';
import type { Species } from '../enemies/species';
import { iconPath } from './icons';

const CS = T.cellSize;
const EC = T.enemyCell;
const ARENA = T.arena;
const SPR = 4; // sprite pixels per world unit

export interface JoyView { active: boolean; ox: number; oy: number; x: number; y: number; radius: number }
export interface Interp { alpha: number; vx: number; vy: number; vh: number }
export interface RenderOpts { arcs: boolean; shake: boolean; joy: JoyView; showHint: boolean }

type Canvas = HTMLCanvasElement;

function mkCanvas(w: number, h: number): [Canvas, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d')!];
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Chamfered (cut-corner) square: the cyberpunk block silhouette.
function chamfer(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, cut: number) {
  const h = s / 2;
  g.beginPath();
  g.moveTo(cx - h + cut, cy - h); g.lineTo(cx + h - cut, cy - h); g.lineTo(cx + h, cy - h + cut);
  g.lineTo(cx + h, cy + h - cut); g.lineTo(cx + h - cut, cy + h); g.lineTo(cx - h + cut, cy + h);
  g.lineTo(cx - h, cy + h - cut); g.lineTo(cx - h, cy - h + cut);
  g.closePath();
}

export class Renderer {
  readonly cv: Canvas;
  private ctx: CanvasRenderingContext2D;
  dpr = 1; vw = 800; vh = 600;
  private cache = new Map<string, Canvas>();
  private time = 0;

  constructor(cv: Canvas) {
    this.cv = cv;
    this.ctx = cv.getContext('2d', { alpha: false })!;
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = window.innerWidth || 800;
    this.vh = window.innerHeight || 600;
    this.cv.width = Math.round(this.vw * this.dpr);
    this.cv.height = Math.round(this.vh * this.dpr);
  }

  // ---------------------------------------------------------------- sprites
  private sprite(key: string, make: () => Canvas): Canvas {
    let c = this.cache.get(key);
    if (!c) { c = make(); this.cache.set(key, c); }
    return c;
  }

  /** Soft radial glow dot, drawn additively. */
  private glow(color: string): Canvas {
    return this.sprite('g' + color, () => {
      const [c, g] = mkCanvas(64, 64);
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, hexA(color, 1)); gr.addColorStop(0.25, hexA(color, 0.55)); gr.addColorStop(1, hexA(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return c;
    });
  }

  /** Player block sprite: dark chamfered plate, neon edge, glyph. Rotation r baked in. */
  private blockSprite(t: string, r: number, flash: boolean): Canvas {
    return this.sprite(`b${t}${r}${flash ? 'f' : ''}`, () => {
      const d = B[t];
      const S = CS * SPR, P = S * 0.35, W = S + P * 2;
      const [c, g] = mkCanvas(W, W);
      const cx = W / 2, cy = W / 2;
      const col = flash ? '#ffffff' : d.color;
      chamfer(g, cx, cy, S * 0.94, S * 0.2);
      g.fillStyle = flash ? '#ffffff' : '#0a0d16';
      g.fill();
      g.fillStyle = hexA(d.color, t === 'cab' ? 0.32 : 0.16);
      g.fill();
      g.shadowColor = col; g.shadowBlur = S * 0.22;
      g.lineWidth = S * 0.07; g.strokeStyle = col;
      g.stroke();
      g.shadowBlur = S * 0.12;
      g.save();
      g.translate(cx, cy);
      g.rotate((r * Math.PI) / 2);
      const k = (S * 0.62) / 24;
      g.scale(k, k); g.translate(-12, -12);
      g.lineWidth = 2.2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = flash ? '#0a0d16' : col;
      g.stroke(iconPath(t));
      g.restore();
      if (d.dir) {
        // facing notch on the edge the weapon fires through
        g.save(); g.translate(cx, cy); g.rotate((r * Math.PI) / 2);
        g.fillStyle = col; g.shadowBlur = S * 0.3;
        g.beginPath(); g.moveTo(-S * 0.16, -S * 0.5); g.lineTo(S * 0.16, -S * 0.5); g.lineTo(0, -S * 0.68); g.closePath(); g.fill();
        g.restore();
      }
      return c;
    });
  }

  /** Enemy sprite for a species at a given scale; rendered facing up (-y). */
  private enemySprite(sp: Species, sc: number, flash: boolean): Canvas {
    return this.sprite(`e${sp.id}_${sc}${flash ? 'f' : ''}_${sp.cells.length}`, () => {
      const cell = EC * sc * SPR;
      const ext = sp.c.ext + 1;
      const W = (ext * 2 + 1) * cell + cell;
      const [c, g] = mkCanvas(W, W);
      const o = W / 2;
      for (const cl of sp.cells) {
        const d = EB[cl[2]];
        const col = flash ? '#ffffff' : d.color;
        const x = o + cl[0] * cell, y = o + cl[1] * cell;
        g.shadowColor = col; g.shadowBlur = cell * 0.35;
        chamfer(g, x, y, cell * 0.9, cell * 0.22);
        g.fillStyle = flash ? '#ffffff' : '#12070c';
        g.fill();
        g.fillStyle = hexA(d.color, 0.5); g.fill();
        g.lineWidth = cell * 0.13; g.strokeStyle = col; g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = col; g.strokeStyle = col;
        const k = cell * 0.22;
        switch (cl[2]) {
          case 'core': g.beginPath(); g.arc(x, y, k * 1.05, 0, TAU); g.fill(); break;
          case 'spike': g.beginPath(); g.moveTo(x - k, y + k * 0.6); g.lineTo(x, y - k * 1.6); g.lineTo(x + k, y + k * 0.6); g.closePath(); g.fill(); break;
          case 'gun': g.fillRect(x - k * 0.4, y - k * 1.8, k * 0.8, k * 2.2); break;
          case 'boomer': g.beginPath(); g.arc(x, y, k * 0.9, 0, TAU); g.lineWidth = cell * 0.08; g.stroke(); g.fillRect(x - k * 0.2, y - k * 1.6, k * 0.4, k * 0.8); break;
          case 'thruster': g.beginPath(); g.moveTo(x - k, y - k * 0.4); g.lineTo(x + k, y - k * 0.4); g.lineTo(x, y + k * 1.2); g.closePath(); g.fill(); break;
          default: g.lineWidth = cell * 0.07; g.beginPath(); g.moveTo(x - k, y - k); g.lineTo(x + k, y + k); g.moveTo(x + k, y - k); g.lineTo(x - k, y + k); g.stroke();
        }
      }
      return c;
    });
  }

  private hazardSprite(color: string, edge: string, kind: string): Canvas {
    return this.sprite('h' + kind + color, () => {
      const W = 256, [c, g] = mkCanvas(W, W), o = W / 2;
      const gr = g.createRadialGradient(o, o, 0, o, o, o);
      gr.addColorStop(0, hexA(color, kind === 'ice' ? 0.22 : 0.5));
      gr.addColorStop(0.85, hexA(color, kind === 'ice' ? 0.16 : 0.32));
      gr.addColorStop(1, hexA(color, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(o, o, o, 0, TAU); g.fill();
      g.strokeStyle = hexA(edge, 0.55); g.lineWidth = 3; g.setLineDash([10, 8]);
      g.beginPath(); g.arc(o, o, o * 0.9, 0, TAU); g.stroke(); g.setLineDash([]);
      // texture
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      if (kind === 'ice') {
        g.strokeStyle = hexA(edge, 0.35); g.lineWidth = 1.5;
        for (let i = 0; i < 9; i++) {
          let x = o + (rnd() - 0.5) * o, y = o + (rnd() - 0.5) * o;
          g.beginPath(); g.moveTo(x, y);
          for (let j = 0; j < 4; j++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); }
          g.stroke();
        }
      } else {
        for (let i = 0; i < 28; i++) {
          const a = rnd() * TAU, rr = rnd() * o * 0.75;
          g.fillStyle = hexA(kind === 'lava' ? '#ffd27a' : edge, kind === 'lava' ? 0.3 : 0.16);
          g.beginPath(); g.arc(o + Math.cos(a) * rr, o + Math.sin(a) * rr, 3 + rnd() * 9, 0, TAU); g.fill();
        }
      }
      return c;
    });
  }

  // ---------------------------------------------------------------- frame
  draw(run: Run | null, ip: Interp, opts: RenderOpts, dt: number): void {
    const ctx = this.ctx, cv = this.cv;
    this.time += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!run) { ctx.fillStyle = '#05060b'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
    const th = run.Wd.theme;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);

    const a = ip.alpha;
    const vx = ip.vx, vy = ip.vy, vh = ip.vh;
    const z = run.zoom * this.dpr;
    const shk = opts.shake ? run.shake : 0;
    const shx = shk ? (Math.random() * 2 - 1) * shk : 0, shy = shk ? (Math.random() * 2 - 1) * shk : 0;
    const cx = vx + shx, cy = vy + shy;
    ctx.setTransform(z, 0, 0, z, cv.width / 2 - cx * z, cv.height / 2 - cy * z);
    const hw = cv.width / z / 2, hh = cv.height / z / 2;
    const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
    const vis = (x: number, y: number, m: number) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;

    // grid
    const gs = 64;
    ctx.lineWidth = 1 / run.zoom;
    ctx.strokeStyle = hexA(th.grid, 0.07);
    ctx.beginPath();
    for (let gx = Math.floor(x0 / gs) * gs; gx < x1; gx += gs) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
    for (let gy = Math.floor(y0 / gs) * gs; gy < y1; gy += gs) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
    ctx.stroke();
    ctx.strokeStyle = hexA(th.grid, 0.16);
    ctx.lineWidth = 1.6 / run.zoom;
    ctx.beginPath();
    const gm = gs * 4;
    for (let gx = Math.floor(x0 / gm) * gm; gx < x1; gx += gm) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
    for (let gy = Math.floor(y0 / gm) * gm; gy < y1; gy += gm) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
    ctx.stroke();

    // hazards
    const hs = this.hazardSprite(th.haz, th.hazEdge, run.Wd.hazard);
    const pulse = run.Wd.hazard === 'lava' ? 0.85 + 0.15 * Math.sin(this.time * 2.4) : 1;
    ctx.globalAlpha = pulse;
    for (const zn of run.HZ) if (vis(zn.x, zn.y, zn.r)) ctx.drawImage(hs, zn.x - zn.r, zn.y - zn.r, zn.r * 2, zn.r * 2);
    ctx.globalAlpha = 1;

    // arena border
    ctx.setLineDash([28, 18]);
    ctx.strokeStyle = hexA('#ff2bd6', 0.25); ctx.lineWidth = 16; ctx.strokeRect(-ARENA, -ARENA, ARENA * 2, ARENA * 2);
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 4; ctx.strokeRect(-ARENA, -ARENA, ARENA * 2, ARENA * 2);
    ctx.setLineDash([]);

    // deposits
    for (const dp of run.DEP) {
      if (!vis(dp.x, dp.y, 50)) continue;
      const c = RES[dp.res].color;
      const rr = dp.cache ? 17 : 12;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.glow(c), dp.x - rr * 2.6, dp.y - rr * 2.6, rr * 5.2, rr * 5.2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(dp.x, dp.y); ctx.rotate(this.time * 0.5);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      ctx.closePath();
      ctx.fillStyle = hexA(c, 0.22); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
      ctx.rotate(-this.time * 1.1);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, -rr * 0.55); ctx.lineTo(rr * 0.38, 0); ctx.lineTo(0, rr * 0.55); ctx.lineTo(-rr * 0.38, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (dp.cache) {
        ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(dp.x, dp.y, 27, this.time, this.time + TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if (dp.prog > 0) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(dp.x, dp.y, 22, -Math.PI / 2, -Math.PI / 2 + dp.prog * TAU); ctx.stroke();
      }
    }

    // pickups (additive glow)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of run.PK) {
      if (!vis(p.x, p.y, 12)) continue;
      if (p.k === 'xp') {
        const s = 9 + Math.min(8, p.amt);
        ctx.drawImage(this.glow('#00f0ff'), p.x - s, p.y - s, s * 2, s * 2);
      } else {
        ctx.drawImage(this.glow(RES[p.k].color), p.x - 12, p.y - 12, 24, 24);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of run.PK) {
      if (!vis(p.x, p.y, 12)) continue;
      if (p.k === 'xp') {
        const s = 2.6 + Math.min(3, p.amt * 0.4);
        ctx.fillStyle = '#c8fdff';
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s * 1.3); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s * 1.3); ctx.lineTo(p.x - s, p.y); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = RES[p.k].color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-3.6, -3.6, 7.2, 7.2); ctx.restore();
      }
    }

    // firing arcs (teaching aid at the start of a run)
    const arcA = opts.arcs ? clamp((9 - run.t) / 3, 0, 1) * 0.9 : 0;
    if (arcA > 0) this.drawArcs(run, vx, vy, vh, arcA);

    // player under-glow
    const V = run.V;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    const gr = V.s.radius * 2.3;
    ctx.drawImage(this.glow('#00c8ff'), vx - gr, vy - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // enemies: a red halo under every hostile keeps them readable at any zoom
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4;
    const halo = this.glow('#ff1f4b');
    for (const e of run.E) {
      if (!vis(e.x, e.y, e.r * 2.4)) continue;
      const hr = e.r * 2.4 + 6;
      ctx.drawImage(halo, e.x - hr, e.y - hr, hr * 2, hr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const e of run.E) {
      const ex = e.px !== undefined ? lerp(e.px, e.x, a) : e.x;
      const ey = e.py !== undefined ? lerp(e.py, e.y, a) : e.y;
      if (!vis(ex, ey, e.r + 6)) continue;
      const spr = this.enemySprite(e.sp, e.sc, e.flash > 0);
      const s = spr.width / SPR;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(e.h + Math.PI / 2);
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
      ctx.restore();
      if (e.burn > 0) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        ctx.drawImage(this.glow('#ff5e3a'), ex - e.r * 1.6, ey - e.r * 1.6, e.r * 3.2, e.r * 3.2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (e.bossLv) {
        // boss halo + HP bar
        ctx.strokeStyle = hexA('#ff2e63', 0.5 + 0.3 * Math.sin(this.time * 6)); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ex, ey, e.r + 8, 0, TAU); ctx.stroke();
        if (e.isMini) {
          const w = 56;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(ex - w / 2, ey - e.r - 16, w, 5);
          ctx.fillStyle = '#ff2e63'; ctx.fillRect(ex - w / 2, ey - e.r - 16, w * clamp(e.hp / e.max, 0, 1), 5);
        }
      }
    }

    // enemy bullets: hot pink with a white core, always readable
    ctx.globalCompositeOperation = 'lighter';
    const eg = this.glow('#ff2e63');
    for (const p of run.EBL) if (vis(p.x, p.y, 12)) ctx.drawImage(eg, p.x - 13, p.y - 13, 26, 26);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffe3ec';
    for (const p of run.EBL) if (vis(p.x, p.y, 6)) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.fill(); }

    // player projectiles
    ctx.globalCompositeOperation = 'lighter';
    for (const p of run.PB) {
      if (!vis(p.x, p.y, 80)) continue;
      if (p.lob) {
        ctx.strokeStyle = hexA(DCOL.explosive, 0.55); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(p.tx!, p.ty!, p.aoe! * 0.55, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        const yy = p.y - (p.z || 0);
        ctx.drawImage(this.glow(DCOL.explosive), p.x - 12, yy - 12, 24, 24);
      } else if (p.type === 'fire') {
        const s = p.r * (1.6 + (0.55 - Math.max(0, p.life)) * 2.2);
        ctx.globalAlpha = clamp(p.life * 2.2, 0.15, 0.9);
        ctx.drawImage(this.glow('#ff6a2a'), p.x - s, p.y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
      } else {
        const col = DCOL[p.type as DType];
        ctx.strokeStyle = col; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); ctx.stroke();
      }
    }

    // beams
    for (const b of run.BEAMS) {
      const k = clamp(b.life / b.max, 0, 1);
      const pts: [number, number][] = [[b.x1, b.y1]];
      if (b.zig) for (let i = 1; i < 5; i++) { const t = i / 5; pts.push([lerp(b.x1, b.x2, t) + (Math.random() - 0.5) * 14, lerp(b.y1, b.y2, t) + (Math.random() - 0.5) * 14]); }
      pts.push([b.x2, b.y2]);
      const line = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); };
      ctx.globalAlpha = k * 0.35; ctx.strokeStyle = b.c; ctx.lineWidth = b.w * 3.2; line();
      ctx.globalAlpha = k; ctx.strokeStyle = b.c; ctx.lineWidth = b.w; line();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; line();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // vehicle
    ctx.save(); ctx.translate(vx, vy); ctx.rotate(vh + Math.PI / 2);
    const bs = (CS * SPR * 1.7) / SPR;
    for (const b of V.list) {
      const d = B[b.t];
      const spr = this.blockSprite(b.t, d.dir ? b.r : 0, b.fl > 0);
      const px = b.x * CS, py = b.y * CS;
      ctx.drawImage(spr, px - bs / 2, py - bs / 2, bs, bs);
      const hpf = b.hp / b.max;
      if (hpf < 0.999) {
        const low = hpf < 0.3 && Math.sin(this.time * 18) > 0;
        ctx.fillStyle = low ? 'rgba(255,40,80,0.45)' : 'rgba(5,6,12,0.6)';
        ctx.fillRect(px - CS * 0.45, py - CS * 0.45 + CS * 0.9 * hpf, CS * 0.9, CS * 0.9 * (1 - hpf));
      }
    }
    ctx.restore();

    // fx
    for (const f of run.FX) {
      if (!vis(f.x, f.y, 60)) continue;
      const k = clamp(f.life / f.max, 0, 1);
      if (f.text) {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.font = `700 ${f.big ? 17 : 12}px Orbitron, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.c; ctx.fillText(f.text, f.x, f.y);
      } else if (f.ring) {
        ctx.globalAlpha = k;
        ctx.strokeStyle = f.c; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r! * (1.2 - k * 0.5), 0, TAU); ctx.stroke();
      } else if (f.block) {
        ctx.globalAlpha = k;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot || 0);
        ctx.strokeStyle = f.c; ctx.lineWidth = 2; ctx.strokeRect(-f.s / 2, -f.s / 2, f.s, f.s);
        ctx.restore();
      } else {
        ctx.globalAlpha = k;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = f.c; ctx.fillRect(f.x - f.s / 2, f.y - f.s / 2, f.s, f.s);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;

    // ---------------- screen space
    const dpr = this.dpr, VW = this.vw, VH = this.vh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (V.flash > 0) {
      const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
      g.addColorStop(0, 'rgba(255,30,80,0)'); g.addColorStop(1, `rgba(255,30,80,${clamp(V.flash * 5, 0, 0.5)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
    }
    // off-screen indicators: bosses (red) and supply caches (resource colour)
    const zoom = run.zoom;
    const arrow = (wx: number, wy: number, col: string, size: number) => {
      const sx = (wx - cx) * zoom + VW / 2, sy = (wy - cy) * zoom + VH / 2;
      if (sx > 0 && sx < VW && sy > 0 && sy < VH) return;
      const an = Math.atan2(sy - VH / 2, sx - VW / 2);
      const ex = clamp(sx, 34, VW - 34), ey = clamp(sy, 100, VH - 80);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(an);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.6, -size * 0.65); ctx.lineTo(-size * 0.3, 0); ctx.lineTo(-size * 0.6, size * 0.65); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    for (const e of run.E) if (e.bossLv) arrow(e.x, e.y, '#ff2e63', e.bossLv === 2 ? 20 : 15);
    for (const dp of run.DEP) if (dp.cache) arrow(dp.x, dp.y, RES[dp.res].color, 13);

    // joystick
    const j = opts.joy;
    if (j.active) {
      ctx.strokeStyle = 'rgba(0,240,255,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(j.ox, j.oy, j.radius, 0, TAU); ctx.stroke();
      ctx.setLineDash([3, 7]); ctx.beginPath(); ctx.arc(j.ox, j.oy, j.radius * 0.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      const kx = j.ox + j.x * j.radius, ky = j.oy + j.y * j.radius;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glow('#00f0ff'), kx - 44, ky - 44, 88, 88);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(200,253,255,0.9)';
      ctx.beginPath(); ctx.arc(kx, ky, 18, 0, TAU); ctx.fill();
    } else if (opts.showHint) {
      // first-run coach: a pulsing touch point with a drag trail
      const t = (this.time % 2) / 2;
      const hx = VW / 2, hy = VH * 0.72;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = 'rgba(0,240,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 70, 0, TAU); ctx.stroke();
      const kx = hx + Math.sin(t * TAU) * 50, ky = hy - Math.abs(Math.cos(t * TAU)) * 30;
      ctx.fillStyle = 'rgba(200,253,255,0.85)';
      ctx.beginPath(); ctx.arc(kx, ky, 18, 0, TAU); ctx.fill();
      ctx.font = '700 18px Orbitron, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#c8fdff'; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 14;
      ctx.fillText('TOUCH & DRAG ANYWHERE TO DRIVE', hx, hy + 110);
      ctx.shadowBlur = 0;
      ctx.font = '500 15px "Chakra Petch", sans-serif'; ctx.fillStyle = 'rgba(220,230,255,0.75)';
      ctx.fillText('Weapons fire on their own, in the direction they face', hx, hy + 136);
      ctx.globalAlpha = 1;
    }
  }

  private drawArcs(run: Run, vx: number, vy: number, vh: number, alpha: number): void {
    const ctx = this.ctx;
    const a = vh + Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const b of run.V.s.weapons) {
      const d = B[b.t], w = d.w!;
      const bx = vx + (b.x * ca - b.y * sa) * CS, by = vy + (b.x * sa + b.y * ca) * CS;
      const range = w.range * (1 + run.mods.range);
      const face = vh + (d.dir ? (b.r * Math.PI) / 2 : 0);
      const half = (w.arc * Math.PI) / 360;
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      if (w.arc >= 360) ctx.arc(bx, by, range, 0, TAU);
      else { ctx.moveTo(bx, by); ctx.arc(bx, by, range, face - half, face + half); ctx.closePath(); }
      ctx.fill();
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = d.color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  /** Small static preview of a build (used by the garage). */
  static drawBuildPreview(cv: HTMLCanvasElement, build: { x: number; y: number; t: string; r: number }[], showArcs: boolean): void {
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    let maxRange = 0;
    for (const b of build) { const w = B[b.t].w; if (w && showArcs) maxRange = Math.max(maxRange, w.range); }
    const span = Math.max(4 * CS, maxRange + 4 * CS);
    const k = Math.min(W, H) / (span * 2);
    g.save(); g.translate(W / 2, H / 2); g.scale(k, k);
    if (showArcs) for (const b of build) {
      const d = B[b.t], w = d.w;
      if (!w) continue;
      const face = -Math.PI / 2 + (d.dir ? (b.r * Math.PI) / 2 : 0), half = (w.arc * Math.PI) / 360;
      const bx = b.x * CS, by = b.y * CS;
      g.globalAlpha = 0.13; g.fillStyle = d.color;
      g.beginPath();
      if (w.arc >= 360) g.arc(bx, by, w.range, 0, TAU);
      else { g.moveTo(bx, by); g.arc(bx, by, w.range, face - half, face + half); g.closePath(); }
      g.fill();
      g.globalAlpha = 0.6; g.strokeStyle = d.color; g.lineWidth = 1.5 / k; g.setLineDash([5 / k, 5 / k]); g.stroke(); g.setLineDash([]);
    }
    g.globalAlpha = 1;
    for (const b of build) {
      const d = B[b.t];
      chamfer(g, b.x * CS, b.y * CS, CS * 0.92, CS * 0.2);
      g.fillStyle = '#0a0d16'; g.fill();
      g.fillStyle = hexA(d.color, 0.3); g.fill();
      g.strokeStyle = d.color; g.lineWidth = 1.4; g.stroke();
    }
    g.restore();
  }
}

