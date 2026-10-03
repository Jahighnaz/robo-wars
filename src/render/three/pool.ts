import * as THREE from 'three';

/** Fixed-capacity InstancedMesh that is refilled every frame. */
export class Pool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly m: Float32Array;
  private readonly c: Float32Array;
  private readonly icon: Float32Array | null;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number, withIcon = false) {
    const g = withIcon ? geo.clone() : geo;
    let icon: Float32Array | null = null;
    if (withIcon) {
      icon = new Float32Array(cap).fill(-1);
      g.setAttribute('aIcon', new THREE.InstancedBufferAttribute(icon, 1));
    }
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    this.c = this.mesh.instanceColor.array as Float32Array;
    this.icon = icon;
  }

  begin(): void { this.n = 0; }

  /** Scale (sx,sy,sz), then rotate yaw around Y, then translate to (x,y,z). */
  push(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, col: THREE.Color, k = 1, icon = -1): void {
    if (this.n >= this.cap) return;
    const i = this.n++, o = i * 16, cs = Math.cos(yaw), sn = Math.sin(yaw), m = this.m;
    m[o] = sx * cs; m[o + 1] = 0; m[o + 2] = -sx * sn; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = sz * sn; m[o + 9] = 0; m[o + 10] = sz * cs; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    const c = this.c, p = i * 3;
    c[p] = col.r * k; c[p + 1] = col.g * k; c[p + 2] = col.b * k;
    if (this.icon) this.icon[i] = icon;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.icon) (this.mesh.geometry.getAttribute('aIcon') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

const cache = new Map<string, THREE.Color>();
/** Cached THREE.Color from a hex string (sRGB → linear handled by three). */
export function col(hex: string): THREE.Color {
  let c = cache.get(hex);
  if (!c) { c = new THREE.Color(hex); cache.set(hex, c); }
  return c;
}
