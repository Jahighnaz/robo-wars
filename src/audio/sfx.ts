// Board sounds, ported from the Robo Rally projection board's WebAudio engine.
import { audioBus, isMuted } from './audio';

function tone(o: { type?: OscillatorType; f0?: number; f1?: number; dur?: number; vol?: number; delay?: number }): void {
  const b = audioBus();
  if (!b || isMuted()) return;
  const { ac, master } = b;
  const { type = 'sawtooth', f0 = 1600, f1 = 300, dur = 0.18, vol = 0.2, delay = 0 } = o;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(f0, 1), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

let noise: AudioBuffer | null = null;
function noiseBurst(o: { dur?: number; vol?: number; f?: number; delay?: number }): void {
  const b = audioBus();
  if (!b || isMuted()) return;
  const { ac, master } = b;
  const { dur = 0.4, vol = 0.4, f = 800, delay = 0 } = o;
  const t = ac.currentTime + delay;
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource(); src.buffer = noise;
  const flt = ac.createBiquadFilter(); flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f * 4, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(f / 4, 40), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t, Math.random() * 0.3, dur + 0.05);
}

export const sfx = {
  laser: (i = 0) => { tone({ type: 'sawtooth', f0: 1900 - i * 90, f1: 220, dur: 0.2, vol: 0.14 }); noiseBurst({ dur: 0.1, vol: 0.08, f: 1600 }); },
  boardLaser: () => tone({ type: 'square', f0: 950, f1: 140, dur: 0.28, vol: 0.11 }),
  charge: () => { tone({ type: 'sine', f0: 380, f1: 1500, dur: 0.45, vol: 0.14 }); tone({ type: 'sine', f0: 760, f1: 3000, dur: 0.45, vol: 0.06, delay: 0.05 }); },
  fall: () => tone({ type: 'sine', f0: 700, f1: 70, dur: 0.7, vol: 0.2 }),
  gear: () => { tone({ type: 'triangle', f0: 160, f1: 230, dur: 0.3, vol: 0.1 }); noiseBurst({ dur: 0.15, vol: 0.04, f: 300 }); },
  push: () => noiseBurst({ dur: 0.2, vol: 0.16, f: 450 }),
  belt: () => tone({ type: 'triangle', f0: 130, f1: 95, dur: 0.3, vol: 0.07 }),
  step: () => tone({ type: 'square', f0: 220, f1: 160, dur: 0.05, vol: 0.04 }),
  turn: () => tone({ type: 'triangle', f0: 300, f1: 420, dur: 0.07, vol: 0.05 }),
  hit: () => noiseBurst({ dur: 0.18, vol: 0.18, f: 900 }),
  shield: () => { tone({ type: 'sine', f0: 1200, f1: 2400, dur: 0.25, vol: 0.1 }); },
  rocket: () => { tone({ type: 'sawtooth', f0: 280, f1: 900, dur: 0.3, vol: 0.12 }); noiseBurst({ dur: 0.25, vol: 0.08, f: 1400 }); },
  boom: (big = false) => { noiseBurst({ dur: big ? 0.8 : 0.55, vol: big ? 0.45 : 0.35, f: 500 }); tone({ type: 'sine', f0: 180, f1: 40, dur: big ? 0.8 : 0.55, vol: 0.28 }); },
  emp: () => { tone({ type: 'sine', f0: 1400, f1: 55, dur: 0.9, vol: 0.2 }); tone({ type: 'square', f0: 130, f1: 40, dur: 0.9, vol: 0.08 }); },
  tele: () => { tone({ type: 'sine', f0: 300, f1: 1900, dur: 0.35, vol: 0.13 }); tone({ type: 'sine', f0: 600, f1: 2600, dur: 0.35, vol: 0.07, delay: 0.06 }); },
  over: () => { tone({ type: 'sawtooth', f0: 180, f1: 950, dur: 0.5, vol: 0.16 }); noiseBurst({ dur: 0.7, vol: 0.4, f: 900, delay: 0.3 }); },
  register: () => tone({ type: 'square', f0: 660, f1: 640, dur: 0.06, vol: 0.05 }),
  buy: () => { tone({ type: 'triangle', f0: 520, f1: 1040, dur: 0.18, vol: 0.1 }); tone({ type: 'triangle', f0: 780, f1: 1560, dur: 0.2, vol: 0.08, delay: 0.09 }); },
  heal: () => tone({ type: 'sine', f0: 600, f1: 900, dur: 0.2, vol: 0.08 }),
  pick: () => { noiseBurst({ dur: 0.12, vol: 0.25, f: 2200 }); tone({ type: 'square', f0: 140, f1: 90, dur: 0.1, vol: 0.12 }); },
};
