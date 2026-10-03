// Tiny Web Audio synth. iOS only allows audio after a user gesture, so
// unlock() is called from the first touch.
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let lastShot = 0;

export function unlockAudio(): void {
  if (!ac) {
    try {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (C) { ac = new C(); master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination); }
    } catch { ac = null; }
  }
  if (ac && ac.state === 'suspended') void ac.resume();
}

export function setMuted(m: boolean): void { muted = m; }

export function snd(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.03): void {
  if (!ac || !master || muted) return;
  try {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.45), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* ignore */ }
}

/** Weapon fire: throttled so a dozen guns don't become noise. */
export function shotSnd(f: number): void {
  if (!ac) return;
  const now = ac.currentTime;
  if (now - lastShot < 0.06) return;
  lastShot = now;
  snd(f, 0.06, 'square', 0.012);
}

/** UI blip used by buttons. */
export const uiSnd = (f = 520) => snd(f, 0.08, 'triangle', 0.025);

/** For the music engine: the shared context and master bus (null until unlocked). */
export function audioBus(): { ac: AudioContext; master: GainNode } | null {
  return ac && master ? { ac, master } : null;
}
