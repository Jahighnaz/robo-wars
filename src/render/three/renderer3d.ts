// 2.5D renderer: real 3D scene (Three.js) seen through a locked, tilted camera
// that follows the vehicle. The simulation stays 2D: sim (x, y) maps to world (x, z).
// Text, joystick and markers are drawn on a 2D overlay canvas on top.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { B, DCOL, EB, RES, T, type DType } from '../../data';
import { clamp, lerp, TAU } from '../../core/math';
import type { Run } from '../../sim/run';
import { col, Pool } from './pool';
import { decalMaterial, glowMaterial, groundMaterial, hazardTexture, iconAtlas, neonMaterial, radialTexture, ringTexture, sawTexture } from './materials';
import { Bobblehead } from './charles';

const CS = T.cellSize;
const EC = T.enemyCell;
const ARENA = T.arena;
export const ICON_TYPES = Object.keys(B);

export interface JoyView { active: boolean; ox: number; oy: number; x: number; y: number; radius: number }
export interface Interp { alpha: number; vx: number; vy: number; vh: number }
export interface RenderOpts { arcs: boolean; shake: boolean; bloom: boolean; joy: JoyView; showHint: boolean }

/** Block heights by category (world units). */
export function blockHeight(t: string): number {
  const c = B[t].cat;
  return t === 'cab' ? 17 : c === 'armor' ? 15 : c === 'weapon' ? 12 : c === 'prop' ? 8 : 11;
}

/** Barrel / turret details on top of weapon blocks, in block-local space (forward = -z). */
export function weaponDetail(t: string): { w: number; h: number; l: number; fwd: number } | null {
  switch (t) {
    case 'cannon': return { w: 4, h: 4, l: 13, fwd: 7 };
    case 'shotgun': return { w: 6, h: 3, l: 6, fwd: 5 };
    case 'laser': return { w: 2.6, h: 2.6, l: 17, fwd: 9 };
    case 'flamer': return { w: 7, h: 5, l: 8, fwd: 6 };
    case 'tesla': return { w: 6, h: 14, l: 6, fwd: 0 };
    case 'mortar': return { w: 4, h: 14, l: 4, fwd: 0 };
    default: return null;
  }
}

const tmpV = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

export class Renderer3D {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 50, 9000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ov: CanvasRenderingContext2D;
  private ovCanvas: HTMLCanvasElement;
  dpr = 1; vw = 800; vh = 600;
  private time = 0;
  private pitch = (58 * Math.PI) / 180;
  private dist = 900;

  // materials shared with the garage preview
  readonly atlas: THREE.Texture;
  private blockMat: THREE.ShaderMaterial;
  private neon: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private ground: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private walls: THREE.Mesh[] = [];
  private skyline: Pool;
  private runRef: Run | null = null;
  private hazards: THREE.Mesh[] = [];
  private hazardMats: THREE.MeshBasicMaterial[] = [];

  // dynamic pools
  private pBlocks: Pool; private pBarrels: Pool; private pEnemy: Pool; private pDeposit: Pool;
  private pXp: Pool; private pRes: Pool; private pShot: Pool; private pEnemyShot: Pool; private pBeam: Pool;
  private pSpark: Pool; private pDebris: Pool; private pGlow: Pool; private pRing: Pool; private pSaw: Pool;
  private charles: Bobblehead;

  constructor(cv: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x05060b, 1);
    this.ovCanvas = overlay;
    this.ov = overlay.getContext('2d')!;
    this.composer = new EffectComposer(this.gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.35, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.atlas = iconAtlas(ICON_TYPES);
    this.blockMat = neonMaterial({ atlas: this.atlas, iconCount: ICON_TYPES.length, edge: 0.09, body: 0.3 });
    this.neon = neonMaterial({ edge: 0.12 });
    this.skyMat = neonMaterial({ edge: 0.025, glow: 0.9, body: 0.08 });

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // origin at the base, so y = ground contact
    const cbox = new THREE.BoxGeometry(1, 1, 1);
    const octa = new THREE.OctahedronGeometry(1, 0);
    const ball = new THREE.IcosahedronGeometry(1, 1);
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);

    const radial = radialTexture(), ring = ringTexture();
    this.pBlocks = new Pool(box, this.blockMat, 200, true);
    this.pBarrels = new Pool(box, this.neon, 200);
    this.pEnemy = new Pool(box, this.neon, 2600);
    this.pDeposit = new Pool(octa, this.neon, 80);
    this.pXp = new Pool(octa, glowMaterial(2.4), 800);
    this.pRes = new Pool(cbox, glowMaterial(2.0), 800);
    this.pShot = new Pool(cbox, glowMaterial(2.2), 1000);
    this.pEnemyShot = new Pool(ball, glowMaterial(2.6), 500);
    this.pBeam = new Pool(cbox, glowMaterial(3.2), 400);
    this.pSpark = new Pool(cbox, glowMaterial(2.6), 900);
    this.pDebris = new Pool(cbox, this.neon, 120);
    this.pGlow = new Pool(flat, decalMaterial(radial, 1.0), 2600);
    this.pRing = new Pool(flat, decalMaterial(ring, 1.6), 300);
    this.pSaw = new Pool(flat, decalMaterial(sawTexture(), 1.5), 500);
    this.charles = new Bobblehead();
    this.scene.add(this.charles.sprite);
    for (const p of [this.pSaw, this.pGlow, this.pRing, this.pBlocks, this.pBarrels, this.pEnemy, this.pDeposit, this.pXp, this.pRes,
      this.pShot, this.pEnemyShot, this.pBeam, this.pSpark, this.pDebris]) this.scene.add(p.mesh);
    this.pGlow.mesh.renderOrder = 1; this.pRing.mesh.renderOrder = 2;

    // ground + arena walls + skyline
    this.groundMat = groundMaterial(new THREE.Color(0x05060b), new THREE.Color(0x00f0ff));
    const gplane = new THREE.PlaneGeometry(ARENA * 2 + 4000, ARENA * 2 + 4000);
    gplane.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(gplane, this.groundMat);
    this.ground.renderOrder = -1;
    this.scene.add(this.ground);
    const wallMat = neonMaterial({ edge: 0.06, glow: 2.6, body: 0.35 });
    wallMat.uniforms.uColor.value = new THREE.Color('#ff2bd6');
    const wallH = 46, th = 14;
    for (const [x, z, w, d] of [[0, -ARENA, ARENA * 2 + th, th], [0, ARENA, ARENA * 2 + th, th], [-ARENA, 0, th, ARENA * 2], [ARENA, 0, th, ARENA * 2]]) {
      const m = new THREE.Mesh(box, wallMat);
      m.scale.set(w, wallH, d); m.position.set(x, 0, z);
      this.walls.push(m); this.scene.add(m);
    }
    this.skyline = new Pool(box, this.skyMat, 900);
    this.scene.add(this.skyline.mesh);
    this.buildSkyline();
  }

  get glowOn(): boolean { return this._bloom; }
  private _bloom = true;

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = window.innerWidth || 800;
    this.vh = window.innerHeight || 600;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.vw, this.vh, false);
    this.composer.setPixelRatio(Math.min(this.dpr, 1.5));
    this.composer.setSize(this.vw, this.vh);
    this.bloom.resolution.set(this.vw / 2, this.vh / 2);
    this.ovCanvas.width = Math.round(this.vw * this.dpr);
    this.ovCanvas.height = Math.round(this.vh * this.dpr);
    this.camera.aspect = this.vw / this.vh;
    // keep roughly 660 world units across the short screen axis at the vehicle
    const span = 580, tanH = Math.tan((this.camera.fov * Math.PI) / 360);
    this.dist = this.camera.aspect >= 1 ? (span * Math.sin(this.pitch)) / (2 * tanH) : span / (2 * tanH * this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  private buildSkyline(): void {
    let seed = 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const palette = ['#00f0ff', '#ff2bd6', '#8a5cff', '#00f0ff', '#3d5cff'].map(h => new THREE.Color(h));
    this.skyline.begin();
    for (let i = 0; i < 900; i++) {
      const side = i % 4, along = (rnd() * 2 - 1) * (ARENA + 900), out = ARENA + 70 + rnd() * 1100;
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? -out : out;
      const z = side === 0 ? -out : side === 1 ? out : along;
      const w = 50 + rnd() * 110, d = 50 + rnd() * 110, h = 40 + rnd() * rnd() * 520;
      this.skyline.push(x, 0, z, 0, w, h, d, palette[Math.floor(rnd() * palette.length)], 0.5 + rnd() * 0.6);
    }
    this.skyline.end();
  }

  /** Per-run static scenery: world colours and hazard zones. Also sets the spawn distance. */
  private setupRun(run: Run): void {
    this.runRef = run;
    for (const m of this.hazards) this.scene.remove(m);
    for (const m of this.hazardMats) { m.map?.dispose(); m.dispose(); }
    this.hazards = []; this.hazardMats = [];
    const th = run.Wd.theme;
    this.groundMat.uniforms.uBg.value.set(th.bg);
    this.groundMat.uniforms.uGrid.value.set(th.grid);
    this.gl.setClearColor(new THREE.Color(th.bg), 1);
    const tex = hazardTexture(th.haz, th.hazEdge, run.Wd.hazard);
    const circle = new THREE.CircleGeometry(1, 48);
    circle.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: run.Wd.hazard === 'lava' ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.hazardMats.push(mat);
    for (const z of run.HZ) {
      const m = new THREE.Mesh(circle, mat);
      m.scale.set(z.r, 1, z.r); m.position.set(z.x, 0.6, z.y); m.renderOrder = 0;
      this.hazards.push(m); this.scene.add(m);
    }
    this.configureSpawn(run);
  }

  /** Enemies should appear just outside the visible ground area (it is larger at the top with a tilted camera). */
  configureSpawn(run: Run): void {
    this.placeCamera(0, 0, 0, 0);
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    let far = 0;
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
      if (ray.ray.intersectPlane(plane, hit)) far = Math.max(far, Math.hypot(hit.x, hit.z));
      else far = Math.max(far, 1100);
    }
    run.spawnD = clamp(far + 70, 450, 1100);
  }

  private placeCamera(tx: number, tz: number, sx: number, sz: number): void {
    this.camera.position.set(tx + sx, Math.sin(this.pitch) * this.dist, tz + sz + Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(tx + sx, 0, tz + sz);
    this.camera.updateMatrixWorld();
  }

  private toScreen(x: number, z: number, y = 0): [number, number, boolean] {
    tmpV.set(x, y, z).project(this.camera);
    return [(tmpV.x * 0.5 + 0.5) * this.vw, (-tmpV.y * 0.5 + 0.5) * this.vh, tmpV.z < 1 && Math.abs(tmpV.x) <= 1.02 && Math.abs(tmpV.y) <= 1.02];
  }

  // ---------------------------------------------------------------- frame
  draw(run: Run | null, ip: Interp, opts: RenderOpts, dt: number): void {
    this.time += dt;
    const g = this.ov;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ovCanvas.width, this.ovCanvas.height);
    if (!run) {
      this.runRef = null;
      this.gl.setClearColor(0x05060b, 1);
      this.gl.clear();
      return;
    }
    if (this.runRef !== run) this.setupRun(run);
    this._bloom = opts.bloom;
    const glowK = opts.bloom ? 1 : 0.6;
    this.blockMat.uniforms.uGlow.value = 1.7 * glowK;
    this.neon.uniforms.uGlow.value = 1.8 * glowK;

    const a = ip.alpha, V = run.V;
    const vx = ip.vx, vy = ip.vy;
    const shk = opts.shake ? run.shake : 0;
    this.placeCamera(vx, vy, shk ? (Math.random() * 2 - 1) * shk : 0, shk ? (Math.random() * 2 - 1) * shk : 0);
    this.groundMat.uniforms.uCam.value.set(vx, 0, vy);
    const lavaPulse = run.Wd.hazard === 'lava' ? 0.8 + 0.2 * Math.sin(this.time * 2.4) : 1;
    for (const m of this.hazardMats) m.opacity = lavaPulse;

    // view culling radius around the camera target
    const cullR = run.spawnD + 120;
    const vis = (x: number, y: number) => Math.abs(x - vx) < cullR && Math.abs(y - vy) < cullR;

    for (const p of [this.pBlocks, this.pBarrels, this.pEnemy, this.pDeposit, this.pXp, this.pRes, this.pShot,
      this.pEnemyShot, this.pBeam, this.pSpark, this.pDebris, this.pGlow, this.pRing, this.pSaw]) p.begin();

    // ---- deposits
    for (const dp of run.DEP) {
      if (!vis(dp.x, dp.y)) continue;
      const c = col(RES[dp.res].color), s = dp.cache ? 13 : 9;
      const bob = Math.sin(this.time * 2 + dp.x) * 2;
      this.pDeposit.push(dp.x, 10 + s + bob, dp.y, this.time * 0.8 + dp.x, s, s * 1.5, s, c);
      if (dp.cache) this.pRing.push(dp.x, 1.2, dp.y, this.time, 56, 1, 56, c, 0.8);
      this.pGlow.push(dp.x, 1, dp.y, 0, s * 7, 1, s * 7, c, 0.5);
    }

    // ---- pickups
    for (const p of run.PK) {
      if (!vis(p.x, p.y)) continue;
      if (p.k === 'xp') {
        const s = 3 + Math.min(3, p.amt * 0.35);
        this.pXp.push(p.x, 7 + Math.sin(this.time * 4 + p.x) * 1.5, p.y, this.time * 3, s, s * 1.4, s, col('#00f0ff'));
        this.pGlow.push(p.x, 1, p.y, 0, s * 6, 1, s * 6, col('#00f0ff'), 0.45);
      } else {
        const c = col(RES[p.k].color);
        this.pRes.push(p.x, 6, p.y, this.time * 2 + p.x, 6, 6, 6, c);
        this.pGlow.push(p.x, 1, p.y, 0, 26, 1, 26, c, 0.45);
      }
    }

    // ---- player vehicle
    this.charles.hide();
    const phi = ip.vh + Math.PI / 2, cp = Math.cos(phi), sp = Math.sin(phi);
    const ug = V.s.radius * 4.2;
    this.pGlow.push(vx, 0.8, vy, 0, ug, 1, ug, col('#00c8ff'), 0.3);
    for (const b of V.list) {
      const d = B[b.t];
      const lx = b.x * CS, ly = b.y * CS;
      const wx = vx + lx * cp - ly * sp, wz = vy + lx * sp + ly * cp;
      const r = d.dir ? b.r : 0;
      const yaw = -(phi + (r * Math.PI) / 2);
      const h = blockHeight(b.t);
      const hpf = clamp(b.hp / b.max, 0, 1);
      const flick = hpf < 0.3 && Math.sin(this.time * 18) > 0;
      const c = b.fl > 0 ? WHITE : flick ? col('#ff2e63') : col(d.color);
      const k = b.fl > 0 ? 0.75 : 0.45 + 0.55 * hpf;
      this.pBlocks.push(wx, 0, wz, yaw, CS * 0.9, h * (0.75 + 0.25 * hpf), CS * 0.9, c, k, ICON_TYPES.indexOf(b.t));
      const det = weaponDetail(b.t);
      if (det) {
        const ox = wx - det.fwd * Math.sin(yaw), oz = wz - det.fwd * Math.cos(yaw);
        this.pBarrels.push(ox, h, oz, yaw, det.w, det.h, det.l, c, k);
      }
      if (d.hover) this.pGlow.push(wx, 0.9, wz, 0, 34, 1, 34, col('#2ef2c8'), 0.7);
      if (b.t === 'shotgun') this.pSaw.push(wx, h + 3.5, wz, this.time * 9, 15, 1, 15, c, k);
      if (b.t === 'cab') this.charles.update(wx, h, wz, ip.vh, V, dt, this.time);
    }

    // ---- enemies
    for (const e of run.E) {
      const ex = e.px !== undefined ? lerp(e.px, e.x, a) : e.x;
      const ey = e.py !== undefined ? lerp(e.py, e.y, a) : e.y;
      if (!vis(ex, ey)) continue;
      const ephi = e.h + Math.PI / 2, ec = Math.cos(ephi), es = Math.sin(ephi), yaw = -ephi;
      const cell = EC * e.sc;
      for (const cl of e.sp.cells) {
        const lx = cl[0] * cell, ly = cl[1] * cell;
        const t = cl[2];
        const h = (t === 'core' ? 12 : t === 'plate' || t === 'reactive' || t === 'fireplate' || t === 'insul' ? 9 : t === 'spike' ? 5 : 7) * e.sc;
        this.pEnemy.push(ex + lx * ec - ly * es, 0, ey + lx * es + ly * ec, yaw, cell * 0.88, h, cell * 0.88, e.flash > 0 ? WHITE : col(EB[t].color), e.flash > 0 ? 1.4 : 1);
        if (t === 'spike') {
          // a sharp tip pointing forward
          const fx = ex + lx * ec - (ly - cell * 0.55) * es, fz = ey + lx * es + (ly - cell * 0.55) * ec;
          this.pEnemy.push(fx, 0, fz, yaw + Math.PI / 4, cell * 0.38, h * 1.2, cell * 0.38, col(EB.spike.color));
        }
      }
      const hr = e.r * 2.6 + 8;
      this.pGlow.push(ex, 0.5, ey, 0, hr, 1, hr, col(e.burn > 0 ? '#ff6a2a' : '#ff1f4b'), e.burn > 0 ? 0.7 : 0.3);
      if (e.bossLv) this.pRing.push(ex, 1.5, ey, this.time, (e.r + 12) * 2, 1, (e.r + 12) * 2, col('#ff2e63'), 0.6 + 0.4 * Math.sin(this.time * 6));
    }

    // ---- enemy bullets
    for (const p of run.EBL) {
      if (!vis(p.x, p.y)) continue;
      this.pEnemyShot.push(p.x, 9, p.y, 0, 4.2, 4.2, 4.2, col('#ff2e63'));
      this.pGlow.push(p.x, 1, p.y, 0, 34, 1, 34, col('#ff2e63'), 0.7);
    }

    // ---- player projectiles
    for (const p of run.PB) {
      if (!vis(p.x, p.y)) continue;
      if (p.lob) {
        const c = col(DCOL.explosive);
        this.pEnemyShot.push(p.x, 10 + (p.z || 0) * 1.4, p.y, 0, 5.5, 5.5, 5.5, c, 1.2);
        this.pRing.push(p.tx!, 1.3, p.ty!, 0, p.aoe! * 1.1, 1, p.aoe! * 1.1, c, 0.35);
        this.pGlow.push(p.x, 1, p.y, 0, 30, 1, 30, c, 0.4);
      } else if (p.type === 'fire') {
        // hot glue: a pale molten blob that sags toward the floor
        const age = 0.55 - Math.max(0, p.life);
        const s = p.r * (0.9 + age * 1.6);
        this.pEnemyShot.push(p.x, Math.max(2, 9 - age * 14), p.y, 0, s * 0.55, s * 0.4, s * 0.55, col('#fff1a8'), 0.9);
        this.pGlow.push(p.x, 1, p.y, 0, s * 3.2, 1, s * 3.2, col('#ffd166'), clamp(p.life * 2.2, 0.15, 1));
      } else if (p.src === 'shotgun') {
        this.pSaw.push(p.x, 9, p.y, this.time * 30 + p.x, 12, 1, 12, col('#ffc08a'), 1.1);
      } else if (p.src === 'cannon') {
        // framing nail: long thin shank
        this.pShot.push(p.x, 9, p.y, -Math.atan2(p.vy, p.vx), 11, 1.3, 1.3, col('#e6f0ff'), 1.1);
      } else {
        const len = Math.hypot(p.vx, p.vy) * 0.03;
        this.pShot.push(p.x, 9, p.y, -Math.atan2(p.vy, p.vx), len, 2.4, 2.4, col(DCOL[p.type as DType]));
      }
    }

    // ---- beams (laser + tesla chains), each segment a stretched glowing box
    for (const bm of run.BEAMS) {
      const k = clamp(bm.life / bm.max, 0, 1);
      const pts: [number, number][] = [[bm.x1, bm.y1]];
      if (bm.zig) for (let i = 1; i < 5; i++) { const t = i / 5; pts.push([lerp(bm.x1, bm.x2, t) + (Math.random() - 0.5) * 16, lerp(bm.y1, bm.y2, t) + (Math.random() - 0.5) * 16]); }
      pts.push([bm.x2, bm.y2]);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const len = Math.hypot(x2 - x1, y2 - y1);
        this.pBeam.push((x1 + x2) / 2, 11, (y1 + y2) / 2, -Math.atan2(y2 - y1, x2 - x1), len, bm.w * 0.9, bm.w * 0.9, col(bm.c), k);
      }
    }

    // ---- fx
    for (const f of run.FX) {
      if (f.text || !vis(f.x, f.y)) continue;
      const k = clamp(f.life / f.max, 0, 1);
      if (f.ring) this.pRing.push(f.x, 2, f.y, 0, f.r! * 2 * (1.2 - k * 0.5), 1, f.r! * 2 * (1.2 - k * 0.5), col(f.c), k * 1.2);
      else if (f.block) {
        const up = Math.max(0, Math.sin((1 - k) * Math.PI)) * 30;
        this.pDebris.push(f.x, up, f.y, f.rot || 0, f.s * 0.8, f.s * 0.6, f.s * 0.8, col(f.c), k);
      } else {
        const up = 6 + (1 - k) * 22;
        this.pSpark.push(f.x, up, f.y, f.x, f.s, f.s, f.s, col(f.c), k);
      }
    }

    for (const p of [this.pBlocks, this.pBarrels, this.pEnemy, this.pDeposit, this.pXp, this.pRes, this.pShot,
      this.pEnemyShot, this.pBeam, this.pSpark, this.pDebris, this.pGlow, this.pRing, this.pSaw]) p.end();

    if (opts.bloom) this.composer.render();
    else this.gl.render(this.scene, this.camera);

    this.drawOverlay(run, vx, vy, ip.vh, opts);
  }

  // ---------------------------------------------------------------- overlay (2D)
  private drawOverlay(run: Run, vx: number, vy: number, vh: number, opts: RenderOpts): void {
    const g = this.ov, VW = this.vw, VH = this.vh;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // firing arcs at the start of a run (projected onto the ground)
    const arcA = opts.arcs ? clamp((9 - run.t) / 3, 0, 1) * 0.9 : 0;
    if (arcA > 0) {
      const phi = vh + Math.PI / 2, cp = Math.cos(phi), sp = Math.sin(phi);
      for (const b of run.V.s.weapons) {
        const d = B[b.t], w = d.w!;
        const bx = vx + (b.x * CS) * cp - (b.y * CS) * sp, by = vy + (b.x * CS) * sp + (b.y * CS) * cp;
        const range = w.range * (1 + run.mods.range), face = vh + (d.dir ? (b.r * Math.PI) / 2 : 0), half = (w.arc * Math.PI) / 360;
        g.beginPath();
        const full = w.arc >= 360, n = 28;
        if (!full) { const [sx, sy] = this.toScreen(bx, by, 1); g.moveTo(sx, sy); }
        for (let i = 0; i <= n; i++) {
          const an = full ? (i / n) * TAU : face - half + (i / n) * half * 2;
          const [sx, sy] = this.toScreen(bx + Math.cos(an) * range, by + Math.sin(an) * range, 1);
          g.lineTo(sx, sy);
        }
        g.closePath();
        g.globalAlpha = arcA * 0.13; g.fillStyle = d.color; g.fill();
        g.globalAlpha = arcA * 0.6; g.strokeStyle = d.color; g.lineWidth = 1.5; g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]);
      }
      g.globalAlpha = 1;
    }

    // deposit mining progress
    for (const dp of run.DEP) {
      if (dp.prog <= 0) continue;
      const [sx, sy, on] = this.toScreen(dp.x, dp.y, 2);
      if (!on) continue;
      g.strokeStyle = '#ffffff'; g.lineWidth = 4;
      g.beginPath(); g.arc(sx, sy, 26, -Math.PI / 2, -Math.PI / 2 + dp.prog * TAU); g.stroke();
    }

    // mini-boss HP bars
    for (const e of run.E) {
      if (!e.isMini) continue;
      const [sx, sy, on] = this.toScreen(e.x, e.y, 30 * e.sc);
      if (!on) continue;
      const w = 64;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(sx - w / 2, sy - 14, w, 6);
      g.fillStyle = '#ff2e63'; g.fillRect(sx - w / 2, sy - 14, w * clamp(e.hp / e.max, 0, 1), 6);
    }

    // damage numbers
    g.textAlign = 'center';
    for (const f of run.FX) {
      if (!f.text) continue;
      const [sx, sy, on] = this.toScreen(f.x, f.y, 26 + (1 - f.life / f.max) * 30);
      if (!on) continue;
      g.globalAlpha = Math.min(1, (f.life / f.max) * 2);
      g.font = `700 ${f.big ? 19 : 14}px Orbitron, sans-serif`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(f.text, sx, sy);
      g.fillStyle = f.c; g.fillText(f.text, sx, sy);
    }
    g.globalAlpha = 1;

    // damage vignette
    const V = run.V;
    if (V.flash > 0) {
      const gr = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
      gr.addColorStop(0, 'rgba(255,30,80,0)'); gr.addColorStop(1, `rgba(255,30,80,${clamp(V.flash * 5, 0, 0.5)})`);
      g.fillStyle = gr; g.fillRect(0, 0, VW, VH);
    }

    // off-screen markers: bosses and supply caches
    const arrow = (wx: number, wy: number, c: string, size: number) => {
      const [sx, sy, on] = this.toScreen(wx, wy, 0);
      if (on && sx > 0 && sx < VW && sy > 0 && sy < VH) return;
      const [cx, cy] = this.toScreen(vx, vy, 0);
      const an = Math.atan2(sy - cy, sx - cx);
      const ex = clamp(cx + Math.cos(an) * 2000, 34, VW - 34), ey = clamp(cy + Math.sin(an) * 2000, 100, VH - 80);
      g.save(); g.translate(ex, ey); g.rotate(an);
      g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(size, 0); g.lineTo(-size * 0.6, -size * 0.65); g.lineTo(-size * 0.3, 0); g.lineTo(-size * 0.6, size * 0.65); g.closePath(); g.fill();
      g.restore();
    };
    for (const e of run.E) if (e.bossLv) arrow(e.x, e.y, '#ff2e63', e.bossLv === 2 ? 20 : 15);
    for (const dp of run.DEP) if (dp.cache) arrow(dp.x, dp.y, RES[dp.res].color, 13);

    // joystick / first-run coach
    const j = opts.joy;
    if (j.active) {
      g.strokeStyle = 'rgba(0,240,255,0.45)'; g.lineWidth = 2;
      g.beginPath(); g.arc(j.ox, j.oy, j.radius, 0, TAU); g.stroke();
      g.setLineDash([3, 7]); g.beginPath(); g.arc(j.ox, j.oy, j.radius * 0.5, 0, TAU); g.stroke(); g.setLineDash([]);
      const kx = j.ox + j.x * j.radius, ky = j.oy + j.y * j.radius;
      g.fillStyle = 'rgba(200,253,255,0.9)'; g.shadowColor = '#00f0ff'; g.shadowBlur = 24;
      g.beginPath(); g.arc(kx, ky, 18, 0, TAU); g.fill(); g.shadowBlur = 0;
    } else if (opts.showHint) {
      const t = (this.time % 2) / 2, hx = VW / 2, hy = VH * 0.72;
      g.globalAlpha = 0.9;
      g.strokeStyle = 'rgba(0,240,255,0.5)'; g.lineWidth = 2;
      g.beginPath(); g.arc(hx, hy, 70, 0, TAU); g.stroke();
      const kx = hx + Math.sin(t * TAU) * 50, ky = hy - Math.abs(Math.cos(t * TAU)) * 30;
      g.fillStyle = 'rgba(200,253,255,0.85)';
      g.beginPath(); g.arc(kx, ky, 18, 0, TAU); g.fill();
      g.font = '700 18px Orbitron, sans-serif'; g.fillStyle = '#c8fdff'; g.shadowColor = '#00f0ff'; g.shadowBlur = 14;
      g.fillText('TOUCH & DRAG ANYWHERE TO DRIVE', hx, hy + 110);
      g.shadowBlur = 0;
      g.font = '500 15px "Chakra Petch", sans-serif'; g.fillStyle = 'rgba(220,230,255,0.75)';
      g.fillText('Weapons fire on their own, in the direction they face', hx, hy + 136);
      g.globalAlpha = 1;
    }
  }
}
