// Floating one-finger joystick: appears where the thumb lands.
export const JOY_RADIUS = 70;
const DEAD = 0.08;

export class Joystick {
  active = false; id = -1; ox = 0; oy = 0; x = 0; y = 0;
  readonly radius = JOY_RADIUS;
  everUsed = false;
  private keys: Record<string, boolean> = {};

  constructor(el: HTMLElement, private enabled: () => boolean, onFirstTouch: () => void) {
    el.addEventListener('pointerdown', e => {
      onFirstTouch();
      if (!this.enabled() || this.active) return;
      this.active = true; this.id = e.pointerId; this.ox = e.clientX; this.oy = e.clientY; this.x = 0; this.y = 0;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('pointermove', e => {
      if (!this.active || e.pointerId !== this.id) return;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const len = Math.hypot(dx, dy), max = this.radius;
      if (len > max) { this.ox = e.clientX - (dx / len) * max; this.oy = e.clientY - (dy / len) * max; dx = (dx / len) * max; dy = (dy / len) * max; }
      if (Math.hypot(dx, dy) / max < DEAD) { this.x = 0; this.y = 0; }
      else { this.x = dx / max; this.y = dy / max; this.everUsed = true; }
      e.preventDefault();
    }, { passive: false });
    const end = (e: PointerEvent) => { if (e.pointerId === this.id) this.release(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    document.addEventListener('keydown', e => { this.keys[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }

  release(): void { this.active = false; this.x = 0; this.y = 0; this.id = -1; }

  /** Returns the drive vector; keyboard (WASD/arrows) works for desktop testing. */
  read(): { x: number; y: number } {
    if (this.active) return { x: this.x, y: this.y };
    const k = this.keys;
    const x = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
    const y = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0);
    const l = Math.hypot(x, y);
    if (l) this.everUsed = true;
    return { x: l ? x / l : 0, y: l ? y / l : 0 };
  }
}
