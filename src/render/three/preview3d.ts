// Garage preview: the stored build as a 3D model, seen from the in-game camera
// angle, with each weapon's firing arc projected on the floor.
import * as THREE from 'three';
import { B, T } from '../../data';
import type { BuildCell } from '../../vehicle/vehicle';
import { col, Pool } from './pool';
import { groundMaterial, iconAtlas, neonMaterial } from './materials';
import { blockHeight, ICON_TYPES, weaponDetail } from './renderer3d';

const CS = T.cellSize;

export class Preview3D {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 5, 5000);
  private blocks: Pool;
  private barrels: Pool;
  private arcs = new THREE.Group();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview3d';
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.gl.setClearColor(0x000000, 0);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.blocks = new Pool(box, neonMaterial({ atlas: iconAtlas(ICON_TYPES), iconCount: ICON_TYPES.length, edge: 0.1, glow: 1.5, body: 0.3 }), 200, true);
    this.barrels = new Pool(box, neonMaterial({ edge: 0.12, glow: 1.5, body: 0.3 }), 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), groundMaterial(new THREE.Color(0x070a14), new THREE.Color(0x00f0ff)));
    this.scene.add(ground, this.arcs, this.blocks.mesh, this.barrels.mesh);
  }

  render(build: BuildCell[], w: number, h: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    // arcs
    for (const c of [...this.arcs.children]) { this.arcs.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    let reach = 3 * CS;
    for (const b of build) {
      const d = B[b.t], wd = d.w;
      reach = Math.max(reach, Math.hypot(b.x, b.y) * CS + CS);
      if (!wd) continue;
      const face = -Math.PI / 2 + (d.dir ? (b.r * Math.PI) / 2 : 0), half = (wd.arc * Math.PI) / 360;
      const full = wd.arc >= 360;
      const geo = full ? new THREE.RingGeometry(wd.range - 2, wd.range, 64) : new THREE.CircleGeometry(wd.range, 40, -(face + half), half * 2);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col(d.color), transparent: true, opacity: full ? 0.45 : 0.14, depthWrite: false }));
      m.position.set(b.x * CS, 0.5, b.y * CS);
      this.arcs.add(m);
    }

    // blocks (vehicle faces -z, i.e. "Front" is up on screen)
    this.blocks.begin(); this.barrels.begin();
    for (const b of build) {
      const d = B[b.t], r = d.dir ? b.r : 0, yaw = -(r * Math.PI) / 2, hh = blockHeight(b.t);
      const x = b.x * CS, z = b.y * CS;
      this.blocks.push(x, 0, z, yaw, CS * 0.9, hh, CS * 0.9, col(d.color), 1, ICON_TYPES.indexOf(b.t));
      const det = weaponDetail(b.t);
      if (det) this.barrels.push(x - det.fwd * Math.sin(yaw), hh, z - det.fwd * Math.cos(yaw), yaw, det.w, det.h, det.l, col(d.color));
    }
    this.blocks.end(); this.barrels.end();

    // camera framing the vehicle and its arcs
    const pitch = (55 * Math.PI) / 180;
    this.camera.aspect = w / h;
    const tanH = Math.tan((this.camera.fov * Math.PI) / 360);
    reach = Math.max(reach * 2.6, 130);
    const span = reach * 2;
    const dist = Math.max((span * Math.sin(pitch)) / (2 * tanH), span / (2 * tanH * this.camera.aspect));
    this.camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.gl.render(this.scene, this.camera);
  }
}
