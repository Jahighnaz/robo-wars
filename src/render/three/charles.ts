// Captain Charles: an 8-direction pixel-art billboard riding on the cab like a
// bobblehead. The frame follows the truck's heading relative to the locked camera,
// and a damped spring makes him wobble when the truck accelerates, turns or gets hit.
import * as THREE from 'three';
import type { Vehicle } from '../../vehicle/vehicle';

const FRAMES = 8;
const HEIGHT = 62; // world units, deliberately oversized like a bobblehead
const ASPECT = 143.5 / 171; // one frame of public/charles/sheet.png

export function charlesTexture(onLoad?: () => void): THREE.Texture {
  const tex = new THREE.TextureLoader().load('charles/sheet.png', onLoad);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.repeat.set(1 / FRAMES, 1);
  return tex;
}

/**
 * Sheet frames, as drawn: 0 faces the viewer, then clockwise in 45° steps
 * (2 = facing screen-right, 4 = back, 6 = facing screen-left).
 * Sim heading h: 0 = screen-right, π/2 = toward the camera.
 */
export function frameFor(heading: number): number {
  const deg = ((Math.PI / 2 - heading) * 180) / Math.PI;
  return (((Math.round(deg / 45) % FRAMES) + FRAMES) % FRAMES);
}

export function charlesSprite(tex: THREE.Texture): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.35 });
  mat.color.setScalar(1.35); // lift him above the dark scene so he reads next to the neon
  const s = new THREE.Sprite(mat);
  s.center.set(0.5, 0.03); // pivot at the shoulders' base, so he wobbles from below
  s.scale.set(HEIGHT * ASPECT, HEIGHT, 1);
  s.renderOrder = 3;
  return s;
}

export class Bobblehead {
  readonly sprite: THREE.Sprite;
  private tex: THREE.Texture;
  private bx = 0; private bz = 0; private bvx = 0; private bvz = 0;
  private by = 0; private bvy = 0;
  private lvx = 0; private lvy = 0; private lastFlash = 0;

  constructor() {
    this.tex = charlesTexture();
    this.sprite = charlesSprite(this.tex);
    this.sprite.visible = false;
  }

  hide(): void { this.sprite.visible = false; }

  update(x: number, top: number, z: number, heading: number, V: Vehicle, dt: number, time: number): void {
    const s = this.sprite;
    s.visible = true;
    this.tex.offset.x = frameFor(heading) / FRAMES;
    if (dt > 0 && dt < 0.1) {
      // the head lags behind the truck's acceleration
      const ax = (V.vx - this.lvx) / dt, az = (V.vy - this.lvy) / dt;
      const k = 85, c = 6.5, push = 0.012;
      this.bvx += (-k * this.bx - c * this.bvx - ax * push) * dt;
      this.bvz += (-k * this.bz - c * this.bvz - az * push) * dt;
      this.bx = Math.max(-9, Math.min(9, this.bx + this.bvx * dt));
      this.bz = Math.max(-9, Math.min(9, this.bz + this.bvz * dt));
      // a hit makes him bounce
      if (V.flash > this.lastFlash + 0.02) this.bvy -= 60;
      this.bvy += (-130 * this.by - 7 * this.bvy) * dt;
      this.by = Math.max(-10, Math.min(10, this.by + this.bvy * dt));
    }
    this.lvx = V.vx; this.lvy = V.vy; this.lastFlash = V.flash;
    const idle = Math.sin(time * 3.1) * 0.8;
    s.position.set(x + this.bx + idle, top + Math.max(0, -this.by) * 0.25, z + this.bz);
    const mat = s.material as THREE.SpriteMaterial;
    mat.rotation = -(this.bx + idle) * 0.035;
    const squash = 1 + this.by * 0.012;
    s.scale.set(HEIGHT * ASPECT * (2 - squash), HEIGHT * squash, 1);
  }
}
