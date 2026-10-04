// The arena in 3D: a locked, tilted tabletop camera over the factory floor.
// Static board art (floor, belts, pits, pads, panels) is painted once into a
// canvas texture; walls, crates, the antenna, energy cubes, gears and belt
// chevrons are meshes on top. Robots are animated billboards: each chassis
// moves its own way (walks, rolls on treads or wheels, slides on its saw
// skirt, inches along swinging a pickaxe). Names and hull pips go on the 2D
// overlay canvas. Grid (r, c) maps to world (x, z) with CELL units per tile.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { cellAt, DIRS, OPP, type Board } from '../../robo/board';
import { R } from '../../robo/data';
import type { Match, MatchEvent } from '../../robo/match';
import { col, Pool } from './pool';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { robotModel, yawFor, type RobotModel } from './models';
import { decalMaterial, glowMaterial, groundMaterial, neonMaterial, radialTexture, ringTexture, sawTexture } from './materials';

export const CELL = 10;
const ROBOT_H = 19;
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type MoveKind = 'walk' | 'treads' | 'wheels' | 'slide' | 'crawl';

interface View {
  sprite: THREE.Sprite;
  arm: THREE.Sprite | null;
  x: number; z: number; // displayed position, world
  lx: number; lz: number; // last position (for motion)
  moving: number; // 0..1
  flash: number; swing: number; recoil: number;
  fall: number; // >0 while falling into a pit / off the edge
  shown: boolean;
  dirX: number;
  /** the 3D model once loaded (the drawing is the fallback until then) */
  model: RobotModel | null;
  yaw: number; spin: number;
}

interface Fx { kind: 'beam' | 'rocket' | 'ring' | 'flash' | 'spark' | 'column' | 'text'; t: number; max: number; a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; w: number; text?: string; vx?: number; vy?: number; vz?: number }

const ROBOT_TEX: Record<string, string> = { clank: 'robots/clank.png', bruiser: 'robots/bruiser.png', roller: 'robots/roller.png', whirl: 'robots/whirl.png', picks: 'robots/picks-body.png' };
const ARM_TEX = 'robots/picks-arm.png';
/** pickaxe arm pivot in the 512 px image (where the arm meets the body) */
const ARM_PIVOT = { x: 255 / 512, y: 1 - 315 / 512 };

const texCache = new Map<string, THREE.Texture>();
export function robotTexture(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = new THREE.TextureLoader().load(path);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(path, t);
  }
  return t;
}

/** Unlit colour pushed above 1 so the bloom picks it up (k = brightness). */
const hot = (hex: string, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** Chevron strip for belts: scrolls along +v (the belt's direction once the plane is rotated). */
function chevronTexture(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.strokeStyle = color; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = color; g.shadowBlur = 6;
  for (const y of [14, 46]) { g.beginPath(); g.moveTo(16, y + 10); g.lineTo(32, y - 4); g.lineTo(48, y + 10); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function gearTexture(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.translate(64, 64);
  g.fillStyle = color; g.strokeStyle = '#0d0f12'; g.lineWidth = 2;
  for (let i = 0; i < 10; i++) { g.save(); g.rotate((i * TAU) / 10); g.fillRect(-6, -60, 12, 18); g.restore(); }
  g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.fillStyle = '#20252c'; g.fill();
  g.lineWidth = 7; g.strokeStyle = color; g.stroke();
  g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fillStyle = color; g.fill();
  g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 28, -0.6, 1.6); g.stroke();
  g.beginPath(); g.arc(0, 0, 28, 2.5, 4.7); g.stroke();
  return new THREE.CanvasTexture(c);
}

function arrowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(32, 4); g.lineTo(54, 34); g.lineTo(40, 34); g.lineTo(40, 40); g.lineTo(24, 40); g.lineTo(24, 34); g.lineTo(10, 34); g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}

/** Paint the static board: floor, pits, belt beds, pads, wrenches, push panels. */
function boardTexture(b: Board): THREE.CanvasTexture {
  const P = 64;
  const [c, g] = canvas(b.cols * P, b.rows * P);
  for (const cell of b.cells) {
    const x = cell.c * P, y = cell.r * P;
    g.fillStyle = (cell.r + cell.c) % 2 ? '#10141b' : '#0d1117';
    g.fillRect(x, y, P, P);
    g.strokeStyle = 'rgba(0,240,255,0.10)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, P - 2, P - 2);
    // rivets
    g.fillStyle = 'rgba(160,175,190,0.22)';
    for (const [rx, ry] of [[7, 7], [P - 7, 7], [7, P - 7], [P - 7, P - 7]]) { g.beginPath(); g.arc(x + rx, y + ry, 2, 0, TAU); g.fill(); }
    if (cell.type === 'pit') {
      // hazard-striped rim around a black hole (bright enough to read, under the bloom threshold)
      g.save(); g.beginPath(); g.rect(x + 2, y + 2, P - 4, P - 4); g.clip();
      g.fillStyle = '#141414'; g.fillRect(x, y, P, P);
      g.fillStyle = '#b07400';
      for (let k = -P; k < P * 2; k += 14) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k + 7, y); g.lineTo(x + k + 7 - P, y + P); g.lineTo(x + k - P, y + P); g.closePath(); g.fill(); }
      g.restore();
      const gr = g.createRadialGradient(x + P / 2, y + P / 2, 2, x + P / 2, y + P / 2, P * 0.5);
      gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#010101'); gr.addColorStop(1, '#1d1206');
      g.fillStyle = gr; g.fillRect(x + 10, y + 10, P - 20, P - 20);
    }
    if (cell.type === 'conv') {
      g.fillStyle = cell.kind === 'b' ? 'rgba(20,60,110,0.75)' : 'rgba(25,80,30,0.75)';
      g.fillRect(x + 3, y + 3, P - 6, P - 6);
      if (cell.turn) {
        g.strokeStyle = '#ffffff55'; g.lineWidth = 3;
        g.beginPath(); g.arc(x + P / 2, y + P / 2, P * 0.32, 0, TAU); g.stroke();
      }
    }
    if (cell.type === 'energy') {
      g.fillStyle = '#2a2610'; g.fillRect(x + 6, y + 6, P - 12, P - 12);
      g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, P - 12, P - 12);
    }
    if (cell.type === 'wrench') {
      g.fillStyle = '#0f2a18'; g.fillRect(x + 4, y + 4, P - 8, P - 8);
      g.strokeStyle = '#5dff8a'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + 20, y + 44); g.lineTo(x + 42, y + 22); g.stroke();
      g.beginPath(); g.arc(x + 44, y + 20, 8, 0.8, 5.2); g.stroke();
    }
    if (cell.start) {
      g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 3; g.strokeRect(x + 8, y + 8, P - 16, P - 16);
      g.fillStyle = 'rgba(0,240,255,0.6)'; g.font = 'bold 22px Orbitron, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(cell.start), x + P / 2, y + P / 2 + 1);
    }
    if (cell.pusher) {
      const s = cell.pusher.side;
      g.save(); g.translate(x + P / 2, y + P / 2); g.rotate((s * Math.PI) / 2);
      g.fillStyle = '#ffd400'; g.fillRect(-P / 2 + 6, -P / 2 + 4, P - 12, 12);
      g.fillStyle = '#111'; g.font = 'bold 10px Orbitron, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(cell.pusher.ph.join(' '), 0, -P / 2 + 10);
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Arena3D {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 1, 2000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ov: CanvasRenderingContext2D;
  dpr = 1; vw = 800; vh = 600;
  time = 0;
  bloomOn = true;

  private board: Board | null = null;
  private boardGroup = new THREE.Group();
  private belts: { mesh: THREE.Mesh; cell: { r: number; c: number } }[] = [];
  private gears: { mesh: THREE.Mesh; dir: number; spin: number }[] = [];
  private cubes: { mesh: THREE.Mesh; idx: number }[] = [];
  private chevG = chevronTexture('#7dff4a');
  private chevB = chevronTexture('#3fc9ff');
  private antennaTip: THREE.Mesh | null = null;
  private antennaPulse = 0;
  private views: View[] = [];
  private rings: Pool; private arrows: Pool; private saws: Pool; private beams: Pool; private glows: Pool; private sparks: Pool; private fxRings: Pool;
  private fx: Fx[] = [];
  private shake = 0;
  /** tiles to highlight (teleport targeting), as cell indices */
  highlight: Set<number> | null = null;
  localId = -1;

  constructor(cv: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    this.gl.setClearColor(0x05060b, 1);
    this.ov = overlay.getContext('2d')!;
    this.composer = new EffectComposer(this.gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.4, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // light for the robot models (the neon board is unlit and ignores it)
    const pmrem = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(-60, 140, 90);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a1030, 0.55), key);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), groundMaterial(new THREE.Color(0x05060b), new THREE.Color(0xff2bd6)));
    ground.position.y = -6;
    this.scene.add(ground, this.boardGroup);

    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const cbox = new THREE.BoxGeometry(1, 1, 1);
    this.rings = new Pool(flat, decalMaterial(ringTexture(), 1.5), 16);
    this.arrows = new Pool(flat, decalMaterial(arrowTexture(), 1.6), 32);
    this.saws = new Pool(flat, decalMaterial(sawTexture(), 1.2), 16);
    this.beams = new Pool(cbox, glowMaterial(3, true), 200);
    this.glows = new Pool(flat, decalMaterial(radialTexture(), 1.4), 200);
    this.sparks = new Pool(cbox, glowMaterial(2.6), 400);
    this.fxRings = new Pool(flat, decalMaterial(ringTexture(), 1.8), 60);
    for (const p of [this.glows, this.rings, this.saws, this.arrows, this.fxRings, this.beams, this.sparks]) this.scene.add(p.mesh);
    this.glows.mesh.renderOrder = 1; this.rings.mesh.renderOrder = 2; this.arrows.mesh.renderOrder = 2;
  }

  // ------------------------------------------------------------ coordinates
  wx(c: number): number { return (c + 0.5) * CELL - (this.board!.cols * CELL) / 2; }
  wz(r: number): number { return (r + 0.5) * CELL - (this.board!.rows * CELL) / 2; }
  /** fractional grid point (row, col as in beam ends) → world */
  private wp(p: [number, number], y = 6): THREE.Vector3 {
    const b = this.board!;
    return new THREE.Vector3(p[1] * CELL - (b.cols * CELL) / 2, y, p[0] * CELL - (b.rows * CELL) / 2);
  }

  /** Screen point → board cell (for teleport targeting). */
  pick(clientX: number, clientY: number): { r: number; c: number } | null {
    if (!this.board) return null;
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const b = this.board;
    const c = Math.floor((hit.x + (b.cols * CELL) / 2) / CELL), r = Math.floor((hit.z + (b.rows * CELL) / 2) / CELL);
    return cellAt(b, r, c) ? { r, c } : null;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = w; this.vh = h;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * this.dpr * 0.5, h * this.dpr * 0.5);
    const ov = this.ov.canvas;
    ov.width = Math.round(w * this.dpr); ov.height = Math.round(h * this.dpr);
    ov.style.width = w + 'px'; ov.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Fit the whole board in view, leaving room for the HUD at the top and the cards at the bottom. */
  private frame(): void {
    const b = this.board;
    const W = (b ? b.cols : 16) * CELL + 14, D = (b ? b.rows : 11) * CELL + 14;
    const pitch = (54 * Math.PI) / 180;
    const fov = (this.camera.fov * Math.PI) / 180;
    const usable = 1 - (150 + 70) / Math.max(400, this.vh); // HUD bands
    const hByW = W / this.camera.aspect;
    const needH = Math.max(D * Math.sin(pitch) + 16, hByW) / Math.max(0.45, usable);
    const dist = needH / (2 * Math.tan(fov / 2));
    const lift = ((150 - 70) / 2 / Math.max(400, this.vh)) * needH; // shift the board up a little
    this.camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist + lift * 0.3);
    this.camera.lookAt(0, 0, lift * 0.3);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ board
  setBoard(m: Match): void {
    this.board = m.board;
    const b = m.board;
    for (const c of [...this.boardGroup.children]) this.boardGroup.remove(c);
    this.belts = []; this.gears = []; this.cubes = [];
    for (const v of this.views) { this.scene.remove(v.sprite); if (v.arm) this.scene.remove(v.arm); if (v.model) this.scene.remove(v.model.root); }
    this.views = [];
    this.fx = [];

    const W = b.cols * CELL, D = b.rows * CELL;
    // slab with the painted board on top
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 6, D + 4), neonMaterial({ edge: 0.02, glow: 2.4, body: 0.2 }));
    (slab.material as THREE.ShaderMaterial).uniforms.uColor.value = new THREE.Color('#00c8ff');
    slab.position.y = -3.01;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: boardTexture(b) }));
    top.position.y = 0.01;
    this.boardGroup.add(slab, top);

    const flat = new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86).rotateX(-Math.PI / 2);
    this.buildBelts(flat);
    const gTex = { cw: gearTexture('#39c95c'), ccw: gearTexture('#ff4b3a') };
    for (const cell of b.cells) {
      const x = this.wx(cell.c), z = this.wz(cell.r);
      if (cell.gear) {
        const g = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: gTex[cell.gear], transparent: true }));
        g.position.set(x, 0.05, z);
        this.boardGroup.add(g);
        this.gears.push({ mesh: g, dir: cell.gear === 'cw' ? -1 : 1, spin: 0 });
      }
      if (cell.type === 'energy') {
        const cube = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 3.2), hot('#ffd400', 1.1));
        cube.position.set(x, 3.2, z);
        this.boardGroup.add(cube);
        this.cubes.push({ mesh: cube, idx: cell.r * b.cols + cell.c });
      }
      if (cell.type === 'crate') {
        const m = neonMaterial({ edge: 0.08, glow: 2.2, body: 0.45 });
        m.uniforms.uColor.value = new THREE.Color('#ff8a2a');
        const crate = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.86, CELL * 0.75, CELL * 0.86), m);
        crate.position.set(x, CELL * 0.375, z);
        this.boardGroup.add(crate);
      }
      // walls on cell edges
      for (let s = 0; s < 4; s++) {
        if (!cell.walls[s]) continue;
        // a low steel wall with a glowing cap (yellow, red for a laser mount, amber for a push panel)
        const wm = neonMaterial({ edge: 0.16, glow: 1.5, body: 0.75 });
        wm.uniforms.uColor.value = new THREE.Color(cell.emit === s ? '#ff2b2b' : cell.pusher?.side === s ? '#ff9a1a' : '#d8b000');
        const horiz = s === 0 || s === 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(horiz ? CELL : 1.4, 4.5, horiz ? 1.4 : CELL), wm);
        wall.position.set(x + DIRS[s].dc * CELL * 0.5, 2.25, z + DIRS[s].dr * CELL * 0.5);
        this.boardGroup.add(wall);
        if (cell.emit === s) {
          const em = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), hot('#ff2b2b', 1.4));
          em.position.set(x + DIRS[s].dc * CELL * 0.36, 4.5, z + DIRS[s].dr * CELL * 0.36);
          this.boardGroup.add(em);
        }
      }
    }
    // standing board-laser beams (faint), as drawn on the reference board
    for (const em of b.emitters) {
      const ray = m.ray(em.r, em.c, OPP(em.emit!), null, false);
      const a = this.wp([em.r + 0.5 + DIRS[em.emit!].dr * 0.5, em.c + 0.5 + DIRS[em.emit!].dc * 0.5], 4.5), e = this.wp(ray.end, 4.5);
      const len = a.distanceTo(e);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, len), new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 0.35 }));
      beam.position.copy(a).lerp(e, 0.5);
      beam.lookAt(e);
      this.boardGroup.add(beam);
    }
    // priority antenna
    const ax = this.wx(b.antenna.c), az = this.wz(b.antenna.r);
    const am = neonMaterial({ edge: 0.1, glow: 2, body: 0.5 });
    am.uniforms.uColor.value = new THREE.Color('#9aa4b0');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 3, 16), am);
    base.position.set(ax, 1.5, az);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 11, 8), am);
    mast.position.set(ax, 8, az);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), hot('#39c95c', 1.2));
    tip.position.set(ax, 14, az);
    this.antennaTip = tip;
    this.boardGroup.add(base, mast, tip);

    // robots
    for (const rb of m.robots) {
      const mat = new THREE.SpriteMaterial({ map: robotTexture(ROBOT_TEX[rb.chassis] ?? ROBOT_TEX.clank), transparent: true, alphaTest: 0.2 });
      const sp = new THREE.Sprite(mat);
      sp.center.set(0.5, 0);
      sp.renderOrder = 3;
      this.scene.add(sp);
      let arm: THREE.Sprite | null = null;
      if (rb.chassis === 'picks') {
        arm = new THREE.Sprite(new THREE.SpriteMaterial({ map: robotTexture(ARM_TEX), transparent: true, alphaTest: 0.2 }));
        arm.center.set(ARM_PIVOT.x, ARM_PIVOT.y);
        arm.renderOrder = 4;
        this.scene.add(arm);
      }
      const x = this.wx(rb.c), z = this.wz(rb.r);
      const view: View = { sprite: sp, arm, x, z, lx: x, lz: z, moving: 0, flash: 0, swing: 0, recoil: 0, fall: 0, shown: rb.alive, dirX: 0, model: null, yaw: yawFor(rb.d), spin: 0 };
      this.views.push(view);
      const views = this.views;
      void robotModel(rb.chassis, CELL * 1.4).then(md => {
        if (!md || this.views !== views) return; // a new board was set meanwhile
        view.model = md;
        this.scene.add(md.root);
      });
    }
    this.frame();
  }

  private buildBelts(flat: THREE.PlaneGeometry): void {
    const b = this.board!;
    for (const x of this.belts) this.boardGroup.remove(x.mesh);
    this.belts = [];
    for (const cell of b.cells) {
      if (cell.type !== 'conv') continue;
      const mesh = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: cell.kind === 'b' ? this.chevB : this.chevG, transparent: true, depthWrite: false }));
      mesh.position.set(this.wx(cell.c), 0.04, this.wz(cell.r));
      // texture "up" (-v) is the arrow tip; plane rotated so the arrow points along the belt
      mesh.rotation.y = -(cell.dir * Math.PI) / 2;
      this.boardGroup.add(mesh);
      this.belts.push({ mesh, cell });
    }
  }

  // ------------------------------------------------------------ events → effects
  onEvents(m: Match, evs: MatchEvent[]): void {
    for (const e of evs) {
      switch (e.k) {
        case 'beam': {
          const kind = e.kind;
          const w = kind === 'over' ? 2.2 : kind === 'rail' ? 1.3 : e.dbl ? 1.1 : 0.7;
          this.fx.push({ kind: 'beam', t: 0, max: kind === 'over' ? 0.7 : 0.5, a: this.wp(e.from), b: this.wp(e.to), color: new THREE.Color(kind === 'board' ? '#ff2b2b' : e.color), w });
          if (kind === 'over') this.shake = Math.max(this.shake, 1.4);
          break;
        }
        case 'rocket': {
          const a = this.wp(e.from), b = this.wp(e.to);
          this.fx.push({ kind: 'rocket', t: 0, max: Math.max(0.15, a.distanceTo(b) / 160), a, b, color: new THREE.Color('#ffb03a'), w: 1.4 });
          break;
        }
        case 'blast': {
          const p = new THREE.Vector3(this.wx(e.c), 3, this.wz(e.r));
          this.fx.push({ kind: 'ring', t: 0, max: 0.6, a: p, b: p, color: new THREE.Color(e.color), w: e.size * CELL * 1.3 });
          this.fx.push({ kind: 'flash', t: 0, max: 0.35, a: p, b: p, color: new THREE.Color('#ffd27a'), w: e.size * CELL });
          this.burst(p, 18, e.color, 40);
          this.shake = Math.max(this.shake, e.size > 2 ? 2.2 : 1.2);
          break;
        }
        case 'hit': {
          const v = this.views[e.id];
          if (!v) break;
          v.flash = 0.35;
          const p = new THREE.Vector3(v.x, ROBOT_H * 0.45, v.z);
          this.burst(p, 8, '#ffffff', 30);
          this.floater(p, '-' + e.n, '#ff5a6e');
          break;
        }
        case 'shield': {
          const v = this.views[e.id];
          if (v) this.fx.push({ kind: 'ring', t: 0, max: 0.45, a: new THREE.Vector3(v.x, 5, v.z), b: new THREE.Vector3(), color: new THREE.Color('#5ec8ff'), w: CELL * 1.2 });
          break;
        }
        case 'fall': { const v = this.views[e.id]; if (v) v.fall = 0.001; break; }
        case 'wreck': {
          const v = this.views[e.id];
          if (!v) break;
          const p = new THREE.Vector3(v.x, 4, v.z);
          this.fx.push({ kind: 'ring', t: 0, max: 0.7, a: p, b: p, color: new THREE.Color('#ff8a2a'), w: CELL * 2 });
          this.fx.push({ kind: 'flash', t: 0, max: 0.4, a: p, b: p, color: new THREE.Color('#ffd27a'), w: CELL * 1.6 });
          this.burst(p, 26, m.robots[e.id].color, 55);
          v.shown = false;
          this.shake = Math.max(this.shake, 1.6);
          break;
        }
        case 'respawn': {
          const v = this.views[e.id], rb = m.robots[e.id];
          if (!v) break;
          v.x = v.lx = this.wx(rb.c); v.z = v.lz = this.wz(rb.r); v.fall = 0; v.shown = true;
          this.fx.push({ kind: 'column', t: 0, max: 0.6, a: new THREE.Vector3(v.x, 0, v.z), b: new THREE.Vector3(), color: new THREE.Color(rb.color), w: CELL * 0.8 });
          break;
        }
        case 'tele': {
          const v = this.views[e.id], rb = m.robots[e.id];
          if (!v) break;
          this.fx.push({ kind: 'column', t: 0, max: 0.6, a: new THREE.Vector3(this.wx(e.from[1]), 0, this.wz(e.from[0])), b: new THREE.Vector3(), color: new THREE.Color('#9fe8ff'), w: CELL * 0.8 });
          v.x = v.lx = this.wx(rb.c); v.z = v.lz = this.wz(rb.r);
          this.fx.push({ kind: 'column', t: 0, max: 0.6, a: new THREE.Vector3(v.x, 0, v.z), b: new THREE.Vector3(), color: new THREE.Color('#9fe8ff'), w: CELL * 0.8 });
          break;
        }
        case 'emp': {
          const p = new THREE.Vector3(this.wx(e.c), 2, this.wz(e.r));
          this.fx.push({ kind: 'ring', t: 0, max: 0.9, a: p, b: p, color: new THREE.Color('#7fd7ff'), w: e.radius * 2 * CELL });
          break;
        }
        case 'energy': { const v = this.views[e.id]; if (v) this.floater(new THREE.Vector3(v.x, ROBOT_H, v.z), '+' + e.n + ' ⚡', '#ffd400'); break; }
        case 'heal': { const v = this.views[e.id]; if (v) this.floater(new THREE.Vector3(v.x, ROBOT_H, v.z), '+1', '#5dff8a'); break; }
        case 'pick': { const v = this.views[e.id]; if (v) v.swing = 0.45; break; }
        case 'reverse': this.buildBelts(new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86).rotateX(-Math.PI / 2)); break;
        case 'gear': for (const g of this.gears) g.spin = 0.4; break;
        case 'register': this.antennaPulse = 1; break;
        case 'buy': { const v = this.views[e.id]; if (v) this.fx.push({ kind: 'column', t: 0, max: 0.5, a: new THREE.Vector3(v.x, 0, v.z), b: new THREE.Vector3(), color: new THREE.Color('#ffd400'), w: CELL * 0.6 }); break; }
        default: break;
      }
    }
  }

  private burst(p: THREE.Vector3, n: number, color: string, sp: number): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, up = Math.random();
      this.fx.push({ kind: 'spark', t: 0, max: 0.35 + Math.random() * 0.35, a: p.clone(), b: p.clone(), color: c, w: 0.5 + Math.random() * 0.6, vx: Math.cos(a) * sp * (0.4 + Math.random()), vy: up * sp * 0.9, vz: Math.sin(a) * sp * (0.4 + Math.random()) });
    }
  }
  private floater(p: THREE.Vector3, text: string, color: string): void {
    this.fx.push({ kind: 'text', t: 0, max: 1, a: p.clone(), b: p, color: new THREE.Color(color), w: 0, text });
  }

  // ------------------------------------------------------------ frame
  render(m: Match, dt: number): void {
    if (!this.board) return;
    this.time += dt;
    const b = this.board, t = this.time;

    // belts scroll, gears turn, cubes bob
    // chevrons point to +v; scrolling the offset down moves the pattern along the arrow
    this.chevG.offset.y = 1 - ((t * 0.9) % 1);
    this.chevB.offset.y = 1 - ((t * 1.8) % 1);
    for (const g of this.gears) {
      const sp = g.spin > 0 ? 4 : 0.35;
      g.spin = Math.max(0, g.spin - dt);
      g.mesh.rotation.y += g.dir * sp * dt;
    }
    for (const cube of this.cubes) {
      const drained = m.drained.has(cube.idx);
      cube.mesh.rotation.y += dt * (drained ? 0.3 : 1.4);
      cube.mesh.position.y = 3.2 + Math.sin(t * 2 + cube.idx) * 0.6;
      (cube.mesh.material as THREE.MeshBasicMaterial).color.set('#ffd400').multiplyScalar(drained ? 0.18 : 1.1);
      const s = drained ? 0.6 : 1;
      cube.mesh.scale.setScalar(s);
    }
    if (this.antennaTip) {
      this.antennaPulse = Math.max(0, this.antennaPulse - dt * 3);
      (this.antennaTip.material as THREE.MeshBasicMaterial).color.set('#39c95c').multiplyScalar(1 + Math.sin(t * 3) * 0.2 + this.antennaPulse * 2.5);
    }

    // robots
    this.rings.begin(); this.arrows.begin(); this.saws.begin(); this.glows.begin();
    const sights: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Color; k: number }[] = [];
    const speed = CELL / R.match.stepTime;
    m.robots.forEach((rb, i) => {
      const v = this.views[i];
      if (!v) return;
      const tx = this.wx(rb.c), tz = this.wz(rb.r);
      if (rb.alive && !v.shown && v.fall === 0) { v.x = tx; v.z = tz; v.shown = true; }
      // chase the grid position at walking speed (snap if it is far: belts at the edge etc.)
      const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
      if (d > CELL * 4) { v.x = tx; v.z = tz; }
      else if (d > 0.01) { const k = Math.min(1, (speed * dt) / d); v.x += dx * k; v.z += dz * k; }
      const mv = Math.hypot(v.x - v.lx, v.z - v.lz) / Math.max(dt, 1e-3);
      v.moving = lerp(v.moving, mv > 1 ? 1 : 0, Math.min(1, dt * 12));
      if (Math.abs(v.x - v.lx) > 0.01) v.dirX = Math.sign(v.x - v.lx);
      v.lx = v.x; v.lz = v.z;
      v.flash = Math.max(0, v.flash - dt);
      v.swing = Math.max(0, v.swing - dt);
      v.recoil = Math.max(0, v.recoil - dt);

      let visible = v.shown || v.fall > 0;
      let fallK = 0;
      if (v.fall > 0) {
        v.fall += dt;
        fallK = Math.min(1, v.fall / 0.7);
        if (fallK >= 1) { v.fall = 0; v.shown = false; visible = false; }
      }
      if (!rb.alive && v.fall === 0) visible = false;
      const pose = this.pose(R.chassis[rb.chassis].move as MoveKind, t + i * 1.7, v);
      const sp = v.sprite, mat = sp.material as THREE.SpriteMaterial;
      sp.visible = visible;
      const scale = (1 - fallK * 0.85);
      const h = ROBOT_H * scale;
      const facing = rb.d;
      const flip = facing === 3 ? -1 : 1;
      sp.scale.set(h * pose.sx * flip, h * pose.sy, 1);
      sp.position.set(v.x + pose.dx, pose.dy - fallK * 9, v.z + 1.5);
      mat.rotation = pose.rot;
      const guard = rb.guardT > 0 && Math.sin(t * 30) > 0;
      const back = facing === 0 ? 0.72 : 1;
      mat.color.setRGB(
        (v.flash > 0 ? 2.2 : 1.12) * back,
        (v.flash > 0 ? 0.6 : 1.12) * back * (rb.jamT > 0 ? 1.3 : 1),
        (v.flash > 0 ? 0.6 : 1.12) * back * (rb.jamT > 0 ? 1.6 : 1));
      mat.opacity = guard ? 0.45 : 1;
      if (v.model) {
        sp.visible = false;
        if (v.arm) v.arm.visible = false;
        this.poseModel(v, rb.chassis, facing, pose, visible, fallK, scale, rb.guardT > 0 && Math.sin(t * 30) > 0, rb.jamT > 0, dt);
      } else if (v.arm) {
        v.arm.visible = visible;
        v.arm.scale.copy(sp.scale);
        // the pivot sits partway up the body; follow the body's pose
        const px = (ARM_PIVOT.x - 0.5) * h * pose.sx * flip, py = ARM_PIVOT.y * h * pose.sy;
        v.arm.position.set(sp.position.x + px * Math.cos(pose.rot) - py * Math.sin(pose.rot), sp.position.y + px * Math.sin(pose.rot) + py * Math.cos(pose.rot), sp.position.z + 0.05);
        const swing = v.swing > 0 ? Math.sin((1 - v.swing / 0.45) * Math.PI) * 0.9 : 0;
        (v.arm.material as THREE.SpriteMaterial).rotation = pose.rot + (Math.sin(t * 3) * 0.08 + pose.arm - swing) * flip;
        (v.arm.material as THREE.SpriteMaterial).color.copy(mat.color);
        (v.arm.material as THREE.SpriteMaterial).opacity = mat.opacity;
      }
      if (!visible) return;
      // floor ring in the player colour, a facing arrow, glow and (for Whirl) a spinning saw
      const c = col(rb.color);
      const ring = CELL * (i === this.localId ? 1.05 : 0.95);
      this.glows.push(v.x, 0.12, v.z, 0, CELL * 1.4, 1, CELL * 1.4, c, i === this.localId ? 0.55 : 0.35);
      this.rings.push(v.x, 0.15, v.z, t * (i === this.localId ? 1.2 : 0.5), ring, 1, ring, c, 1);
      // a big facing arrow just past the tile edge, pulsing for your own robot
      const mine = i === this.localId, pulse = mine ? 1 + Math.sin(t * 5) * 0.12 : 1;
      const reach = facing === 0 ? 1.15 : 0.78; // facing away: clear the sprite
      const ax = v.x + DIRS[facing].dc * CELL * reach, az = v.z + DIRS[facing].dr * CELL * reach;
      this.arrows.push(ax, 0.22, az, -(facing * Math.PI) / 2, CELL * 0.78 * pulse, 1, CELL * 0.78 * pulse, c, mine ? 2.6 : 2);
      this.arrows.push(v.x + DIRS[facing].dc * CELL * 0.3, 0.21, v.z + DIRS[facing].dr * CELL * 0.3, -(facing * Math.PI) / 2, CELL * 0.45, 1, CELL * 0.45, c, 0.9);
      // laser sight: where this robot's laser will go at the next register
      if (rb.alive) {
        const rail = rb.passive.includes('rail');
        const end = rail ? m.rayAll(rb.r, rb.c, facing, rb).end : m.ray(rb.r, rb.c, facing, rb).end;
        sights.push({ a: new THREE.Vector3(v.x + DIRS[facing].dc * CELL * 0.5, 0.7, v.z + DIRS[facing].dr * CELL * 0.5), b: this.wp(end, 0.7), c, k: mine ? 0.55 : 0.22 });
      }
      if (R.chassis[rb.chassis].move === 'slide') this.saws.push(v.x, 0.25, v.z, t * (6 + v.moving * 18), CELL * 0.95, 1, CELL * 0.95, col('#bfe9ff'), 0.6);
      if (rb.passive.includes('shield') && rb.shieldUp) this.rings.push(v.x, 0.3, v.z, -t, CELL * 1.25, 1, CELL * 1.25, col('#5ec8ff'), 0.6);
    });
    this.rings.end(); this.arrows.end(); this.saws.end();

    // effects
    this.beams.begin(); this.sparks.begin(); this.fxRings.begin();
    for (const sg of sights) {
      const len = sg.a.distanceTo(sg.b);
      if (len < 0.5) continue;
      const mid = sg.a.clone().lerp(sg.b, 0.5);
      this.beams.push(mid.x, mid.y, mid.z, Math.atan2(sg.b.x - sg.a.x, sg.b.z - sg.a.z), 0.28, 0.08, len, sg.c, sg.k);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.max;
      if (k >= 1) { this.fx.splice(i, 1); continue; }
      if (f.kind === 'beam') {
        const len = f.a.distanceTo(f.b), mid = f.a.clone().lerp(f.b, 0.5);
        const yaw = Math.atan2(f.b.x - f.a.x, f.b.z - f.a.z);
        const w = f.w * (1 - k * 0.6);
        this.beams.push(mid.x, mid.y, mid.z, yaw, w, w, len, f.color, 1.6 * (1 - k));
        this.beams.push(mid.x, mid.y, mid.z, yaw, w * 0.35, w * 0.35, len, col('#ffffff'), 2 * (1 - k));
        this.glows.push(f.b.x, 0.3, f.b.z, 0, CELL * 0.9, 1, CELL * 0.9, f.color, 1 - k);
      } else if (f.kind === 'rocket') {
        const p = f.a.clone().lerp(f.b, k);
        const yaw = Math.atan2(f.b.x - f.a.x, f.b.z - f.a.z);
        this.beams.push(p.x, p.y, p.z, yaw, 1.4, 1.4, 3.2, f.color, 2);
        this.glows.push(p.x, 0.3, p.z, 0, CELL * 0.6, 1, CELL * 0.6, f.color, 0.8);
        if (Math.random() < 0.6) this.burst(p, 1, '#ff8a2a', 8);
      } else if (f.kind === 'ring') {
        const s = f.w * (0.2 + k * 0.8);
        this.fxRings.push(f.a.x, 0.4, f.a.z, 0, s, 1, s, f.color, 1.6 * (1 - k));
      } else if (f.kind === 'flash') {
        const s = f.w * (0.6 + k);
        this.glows.push(f.a.x, 0.5, f.a.z, 0, s, 1, s, f.color, 2 * (1 - k));
      } else if (f.kind === 'column') {
        for (let j = 0; j < 6; j++) {
          const y = (j / 6) * 22 * (0.3 + k);
          this.beams.push(f.a.x, y, f.a.z, t * 3 + j, f.w * (1 - k) * 0.5, 0.4, f.w * (1 - k) * 0.5, f.color, 1.4 * (1 - k));
        }
      } else if (f.kind === 'spark') {
        f.vy! -= 120 * dt;
        f.b.x += f.vx! * dt; f.b.y = Math.max(0.2, f.b.y + f.vy! * dt); f.b.z += f.vz! * dt;
        const s = f.w * (1 - k);
        this.sparks.push(f.b.x, f.b.y, f.b.z, k * 5, s, s, s, f.color, 1.5);
      } else if (f.kind === 'text') {
        f.b.y = f.a.y + k * 6;
      }
    }
    this.beams.end(); this.sparks.end(); this.fxRings.end(); this.glows.end();

    // camera shake (small: it is a tabletop)
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 4);
    this.scene.position.set((Math.random() - 0.5) * sh, 0, (Math.random() - 0.5) * sh);

    this.bloom.enabled = this.bloomOn;
    if (this.bloomOn) this.composer.render(); else this.gl.render(this.scene, this.camera);
    this.drawOverlay(m);
    void b;
  }

  /** Place and animate a robot's 3D model: turn to face, the chassis motion, falls and hit flashes. */
  private poseModel(v: View, chassis: string, facing: number, pose: { dx: number; dy: number; rot: number; sx: number; sy: number; arm: number }, visible: boolean, fallK: number, scale: number, blink: boolean, jammed: boolean, dt: number): void {
    const md = v.model!;
    md.root.visible = visible && !blink;
    if (!visible) return;
    // turn smoothly to the facing (shortest way round)
    let d = yawFor(facing) - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.yaw += d * Math.min(1, dt * 12);
    md.root.position.set(v.x, pose.dy * 0.6 - fallK * 9, v.z);
    md.root.rotation.y = v.yaw;
    // Whirl spins on its drill while it moves, then settles facing forward
    if (chassis === 'whirl') {
      if (v.moving > 0.2) v.spin += dt * 14 * v.moving;
      else v.spin += Math.atan2(Math.sin(-v.spin), Math.cos(-v.spin)) * Math.min(1, dt * 6);
    }
    const b = md.body;
    b.rotation.set(
      v.moving * (chassis === 'wheels' ? 0.12 : chassis === 'treads' ? -0.06 : 0.04) + (v.swing > 0 ? Math.sin((1 - v.swing / 0.45) * Math.PI) * 0.45 : 0) + v.recoil * 0.6,
      v.spin,
      pose.rot * 1.3);
    b.scale.set(scale * pose.sx, scale * pose.sy, scale * pose.sx);
    // hit flash red, EMP jam blue
    const er = v.flash > 0 ? 0.9 * (v.flash / 0.35) : 0, eb = jammed ? 0.35 + Math.sin(this.time * 12) * 0.15 : 0;
    for (const m of md.mats) m.emissive.setRGB(er, eb * 0.6, eb);
  }

  /** Per-chassis motion: an offset, rotation and squash for the billboard. */
  private pose(kind: MoveKind, t: number, v: View): { dx: number; dy: number; rot: number; sx: number; sy: number; arm: number } {
    const mv = v.moving;
    switch (kind) {
      case 'walk': { // three stubby legs: a stomping waddle
        const ph = t * 11;
        return { dx: 0, dy: Math.abs(Math.sin(ph)) * 1.6 * mv + Math.sin(t * 2) * 0.15, rot: Math.sin(ph) * 0.09 * mv + Math.sin(t * 1.3) * 0.015, sx: 1 + (1 - Math.abs(Math.sin(ph))) * 0.04 * mv, sy: 1 - (1 - Math.abs(Math.sin(ph))) * 0.04 * mv, arm: 0 };
      }
      case 'treads': { // heavy rumble, rocks back when it sets off
        const rumble = Math.sin(t * 47) * 0.18 * mv + Math.sin(t * 31) * 0.05;
        return { dx: 0, dy: rumble + 0.05, rot: -v.dirX * 0.05 * mv + Math.sin(t * 23) * 0.006 * mv, sx: 1, sy: 1 + Math.sin(t * 2) * 0.01, arm: 0 };
      }
      case 'wheels': { // bouncy, leans into the direction it rolls
        const b = Math.abs(Math.sin(t * 15)) * 0.9 * mv;
        return { dx: 0, dy: b + Math.sin(t * 2.2) * 0.12, rot: -v.dirX * 0.14 * mv + Math.sin(t * 1.7) * 0.03 * (1 - mv), sx: 1, sy: 1 - b * 0.02, arm: 0 };
      }
      case 'slide': { // hovers on its spinning saw skirt
        return { dx: Math.sin(t * 26) * 0.12 * mv, dy: 1.2 + Math.sin(t * 3) * 0.6, rot: Math.sin(t * 2.4) * 0.03 - v.dirX * 0.06 * mv, sx: 1, sy: 1, arm: 0 };
      }
      case 'crawl': { // inchworm squash and stretch, the pickaxe pumping
        const ph = t * 9, s = Math.sin(ph) * 0.09 * mv;
        return { dx: 0, dy: Math.max(0, Math.sin(ph)) * 0.4 * mv, rot: 0, sx: 1 + s, sy: 1 - s, arm: Math.sin(ph) * 0.25 * mv };
      }
    }
  }

  private project(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().add(this.scene.position).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.vw, y: (-v.y * 0.5 + 0.5) * this.vh };
  }

  private drawOverlay(m: Match): void {
    const g = this.ov, d = this.dpr;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, this.vw, this.vh);
    // teleport targets
    if (this.highlight && this.board) {
      for (const idx of this.highlight) {
        const r = Math.floor(idx / this.board.cols), c = idx % this.board.cols;
        const corners = [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]].map(([a, b2]) => this.project(new THREE.Vector3(this.wx(c) + a * CELL, 0.3, this.wz(r) + b2 * CELL)));
        g.beginPath(); corners.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        g.fillStyle = 'rgba(159,232,255,0.18)'; g.fill();
        g.strokeStyle = 'rgba(159,232,255,0.8)'; g.lineWidth = 1.5; g.stroke();
      }
    }
    // name tags and hull pips
    g.textAlign = 'center';
    m.robots.forEach((rb, i) => {
      const v = this.views[i];
      if (!v || !rb.alive || !v.shown) return;
      const p = this.project(new THREE.Vector3(v.x, (v.model ? v.model.height + 4 : ROBOT_H + 2.5), v.z + (v.model ? 0 : 1.5)));
      const w = Math.min(64, 6 * rb.maxHp);
      g.font = '600 11px "Chakra Petch", sans-serif';
      g.fillStyle = rb.color;
      g.shadowColor = '#000'; g.shadowBlur = 4;
      g.fillText(rb.name + (i === this.localId ? ' (you)' : ''), p.x, p.y - 8);
      g.shadowBlur = 0;
      const pw = w / rb.maxHp;
      for (let k = 0; k < rb.maxHp; k++) {
        g.fillStyle = k < rb.hp ? (rb.hp <= 3 ? '#ff3b5c' : '#5dff8a') : 'rgba(255,255,255,0.15)';
        g.fillRect(p.x - w / 2 + k * pw + 0.5, p.y - 2, pw - 1, 4);
      }
      if (rb.jamT > 0) { g.fillStyle = '#7fd7ff'; g.font = '700 10px Orbitron, sans-serif'; g.fillText('JAMMED', p.x, p.y + 12); }
    });
    // floating numbers
    for (const f of this.fx) {
      if (f.kind !== 'text') continue;
      const p = this.project(f.b);
      g.globalAlpha = 1 - f.t / f.max;
      g.font = '700 14px Orbitron, sans-serif';
      g.fillStyle = '#' + f.color.getHexString();
      g.shadowColor = '#000'; g.shadowBlur = 5;
      g.fillText(f.text!, p.x, p.y);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    }
  }
}
