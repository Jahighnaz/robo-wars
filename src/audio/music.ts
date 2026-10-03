// "SHOP FLOOR FEVER": a procedural 8-bit soundtrack in the spirit of 90s arcade
// techno. NES-style voices (pulse leads, triangle bass, noise drums) scheduled
// ahead of time on the Web Audio clock. Three moods: menu, run and boss; mood
// changes land on the next bar so the groove never stumbles.
import { audioBus } from './audio';

export type Mood = 'menu' | 'run' | 'boss';

// ---------------------------------------------------------------- song data
// chords: [bass root, triad...] as MIDI notes
const CH: Record<string, number[]> = {
  Am: [33, 57, 60, 64], F: [29, 53, 57, 60], C: [36, 55, 60, 64], G: [31, 55, 59, 62],
  E: [28, 56, 59, 64], Dm: [38, 57, 62, 65], Em: [28, 55, 59, 64],
};
const _ = null;
type Bar = (number | null)[];

// the hook, one bar per chord (8th-note feel)
const HOOK: Bar[] = [
  [76, _, 76, _, 72, _, 74, _, 76, _, 79, _, 76, _, 74, _],
  [72, _, 72, _, 69, _, 72, _, 74, _, 72, _, 69, _, 67, _],
  [67, _, 72, _, 76, _, 72, _, 79, _, 76, _, 72, _, 76, _],
  [74, _, 74, _, 71, _, 74, _, 79, _, 77, _, 76, _, 74, _],
];
// variation: syncopated, an octave up in places
const HOOK_B: Bar[] = [
  [88, _, _, 84, _, _, 86, _, 88, _, 91, _, 88, 86, 84, _],
  [84, _, _, 81, _, _, 84, _, 86, _, 84, _, 81, _, 79, _],
  [79, _, 84, _, 88, _, 84, 88, 91, _, 88, _, 84, _, 88, _],
  [86, _, _, 83, _, _, 86, _, 91, _, 89, _, 88, 86, 83, _],
];
const BOSS_HOOK: Bar[] = [
  [69, _, 69, 72, _, 69, 74, _, 69, _, 69, 76, _, 74, 72, _],
  [67, _, 67, 71, _, 67, 74, _, 67, _, 67, 74, _, 72, 71, _],
  [65, _, 65, 69, _, 65, 72, _, 65, _, 65, 72, _, 71, 69, _],
  [68, _, 68, 71, _, 68, 76, _, 68, 71, 74, 76, 77, 76, 74, 71],
];

interface Song { bpm: number; prog: string[]; form: string[] }
const SONGS: Record<Mood, Song> = {
  menu: { bpm: 112, prog: ['Am', 'F', 'C', 'G'], form: ['M', 'M2'] },
  run: { bpm: 140, prog: ['Am', 'F', 'C', 'G'], form: ['A', 'A', 'B', 'A', 'C', 'B'] },
  boss: { bpm: 150, prog: ['Am', 'G', 'F', 'E'], form: ['X', 'X', 'Y', 'X'] },
};

// ---------------------------------------------------------------- engine
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private on = false;
  private mood: Mood = 'menu';
  private pending: Mood = 'menu';
  private step = 0;     // 16th within the bar
  private bar = 0;      // bar within the section
  private section = 0;  // index into the song form
  private next = 0;     // audio time of the next 16th
  private timer = 0;
  private out: GainNode | null = null;
  private bus: GainNode | null = null; // ducked by the kick (sidechain pump)
  private waves: Record<string, PeriodicWave> = {};
  private noise: AudioBuffer | null = null;
  private vol = 1;

  setEnabled(on: boolean): void {
    this.on = on;
    if (on) this.start(); else this.stop();
  }

  setMood(m: Mood): void { this.pending = m; }

  /** Quieter while paused or on break. */
  setDucked(d: boolean): void {
    this.vol = d ? 0.45 : 1;
    const b = audioBus();
    if (b && this.out) this.out.gain.setTargetAtTime(0.14 * this.vol, b.ac.currentTime, 0.2);
  }

  /** Call after the first touch (iOS only allows audio from a gesture). */
  start(): void {
    if (!this.on || this.timer) return;
    const b = audioBus();
    if (!b) return;
    const { ac, master } = b;
    if (!this.out) this.attach(ac, master);
    this.next = ac.currentTime + 0.08;
    this.step = 0; this.bar = 0; this.section = 0;
    this.mood = this.pending;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  /** Build the voice graph on a context (live, or offline for previews). */
  attach(ac: BaseAudioContext, dest: AudioNode): void {
    this.out = ac.createGain(); this.out.gain.value = 0.14 * this.vol; this.out.connect(dest);
    this.bus = ac.createGain(); this.bus.connect(this.out);
    for (const d of [0.125, 0.25, 0.5]) this.waves[d] = pulseWave(ac, d);
    this.noise = noiseBuffer(ac);
  }

  /** Schedule `seconds` of a mood from time 0 (offline rendering). */
  scheduleOffline(ac: BaseAudioContext, mood: Mood, seconds: number): void {
    this.mood = this.pending = mood;
    this.step = 0; this.bar = 0; this.section = 0; this.next = 0.05;
    while (this.next < seconds) {
      this.play(ac, this.next);
      this.next += 60 / SONGS[this.mood].bpm / 4;
      if (++this.step === 16) { this.step = 0; if (++this.bar === 4) { this.bar = 0; this.section = (this.section + 1) % SONGS[this.mood].form.length; } }
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  private tick(): void {
    const b = audioBus();
    if (!b) return;
    const ac = b.ac;
    if (ac.state !== 'running') return;
    // after a suspension (app in background) do not try to catch up
    if (this.next < ac.currentTime - 0.25) this.next = ac.currentTime + 0.05;
    while (this.next < ac.currentTime + 0.12) {
      this.play(ac, this.next);
      this.next += 60 / SONGS[this.mood].bpm / 4;
      if (++this.step === 16) {
        this.step = 0;
        if (this.pending !== this.mood) { this.mood = this.pending; this.bar = 0; this.section = 0; continue; }
        if (++this.bar === 4) { this.bar = 0; this.section = (this.section + 1) % SONGS[this.mood].form.length; }
      }
    }
  }

  // one 16th-note step of the arrangement
  private play(ac: BaseAudioContext, t: number): void {
    const song = SONGS[this.mood], part = song.form[this.section], s = this.step, bar = this.bar;
    const chord = CH[song.prog[bar]];
    const spb = 60 / song.bpm / 4; // seconds per 16th
    const breakdown = part === 'C' && bar < 2;
    const build = part === 'C' && bar >= 2;

    // --- drums
    if (this.mood === 'menu') {
      if (s === 0 || s === 8) this.kick(ac, t, 0.6);
      if (s % 4 === 2) this.hat(ac, t, 0.05, 0.03);
      if (s === 12 && bar % 2 === 1) this.snare(ac, t, 0.3);
    } else {
      if (!breakdown && s % 4 === 0) this.kick(ac, t, 1);
      if (!breakdown && (s === 4 || s === 12)) this.snare(ac, t, 0.55);
      if (build) this.snare(ac, t, 0.12 + 0.4 * ((bar - 2) * 16 + s) / 32); // snare roll into the drop
      if (!breakdown && s % 4 === 2) this.hat(ac, t, 0.09, 0.09); // open hat on the off-beat
      if (part !== 'A' && s % 2 === 1) this.hat(ac, t, 0.04, 0.025);
      if (this.mood === 'boss' && (s === 14 || s === 15)) this.kick(ac, t, 0.5);
    }

    // --- bass: rolling 16ths that leave room for the kick (triangle, NES style)
    if (this.mood === 'menu') {
      if (s % 4 === 0) this.note(ac, 'triangle', midi(chord[0] + 12), t, spb * 3.5, 0.32);
    } else if (!breakdown) {
      if (s % 4 !== 0) this.note(ac, 'triangle', midi(chord[0] + (s % 4 === 2 ? 24 : 12)), t, spb * 0.9, 0.36);
    }

    // --- arpeggio: chord tones climbing in 16ths (thin pulse)
    const arpOn = this.mood === 'menu' ? s % 2 === 0 : true;
    if (arpOn) {
      const tones = [chord[1], chord[2], chord[3], chord[1] + 12];
      const up = part === 'B' || part === 'Y' ? 12 : 0;
      const n = tones[(this.mood === 'menu' ? s / 2 : s) % 4] + up + (Math.floor(s / 8) % 2 ? 12 : 0);
      this.note(ac, 0.125, midi(n), t, spb * 0.8, this.mood === 'menu' ? 0.07 : 0.06, true);
    }

    // --- pad in the breakdown and the menu: a soft sustained square chord
    if ((breakdown || this.mood === 'menu') && s === 0) {
      for (const n of chord.slice(1)) this.note(ac, 0.5, midi(n), t, spb * 15, 0.035, true);
    }

    // --- stabs on the off-beats in B
    if ((part === 'B' || part === 'Y') && (s === 6 || s === 14)) {
      for (const n of chord.slice(1)) this.note(ac, 0.25, midi(n + 12), t, spb * 0.7, 0.04, true);
    }

    // --- lead
    let lead: Bar | null = null;
    if (part === 'A' || (part === 'M2')) lead = HOOK[bar];
    else if (part === 'B') lead = HOOK_B[bar];
    else if (part === 'X' || part === 'Y') lead = BOSS_HOOK[bar];
    else if (build) lead = null;
    if (lead) {
      const n = lead[s];
      if (n) {
        let len = 1;
        while (s + len < 16 && lead[s + len] === null && len < 3) len++;
        this.note(ac, 0.25, midi(n), t, spb * len * 0.92, this.mood === 'menu' ? 0.07 : 0.085, true, true);
      }
    }
  }

  // ---------------------------------------------------------------- voices
  private note(ac: BaseAudioContext, wave: OscillatorType | number, f: number, t: number, dur: number, vol: number, bus = false, vibrato = false): void {
    const o = ac.createOscillator(), g = ac.createGain();
    if (typeof wave === 'number') o.setPeriodicWave(this.waves[wave]); else o.type = wave;
    o.frequency.setValueAtTime(f, t);
    if (vibrato && dur > 0.2) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 6; lg.gain.value = f * 0.012;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start(t + 0.12); lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.01, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus ? this.bus! : this.out!);
    o.start(t); o.stop(t + dur + 0.03);
  }

  private kick(ac: BaseAudioContext, t: number, vol: number): void {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(0.9 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.out!);
    o.start(t); o.stop(t + 0.2);
    // sidechain pump: everything else ducks under the kick
    const bg = this.bus!.gain;
    bg.cancelScheduledValues(t);
    bg.setValueAtTime(0.35, t);
    bg.linearRampToValueAtTime(1, t + 0.13);
  }

  private snare(ac: BaseAudioContext, t: number, vol: number): void {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(f); f.connect(g); g.connect(this.out!);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.15);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    og.gain.setValueAtTime(vol * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og); og.connect(this.out!); o.start(t); o.stop(t + 0.08);
  }

  private hat(ac: BaseAudioContext, t: number, vol: number, dur: number): void {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus!);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
}

/** Pulse wave with a given duty cycle, like the NES square channels. */
function pulseWave(ac: BaseAudioContext, duty: number): PeriodicWave {
  const N = 48, real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return ac.createPeriodicWave(real, imag);
}

/** Crunchy sample-and-hold noise (lower effective rate = more 8-bit). */
function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  const len = ac.sampleRate;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) { if (i % 3 === 0) v = Math.random() * 2 - 1; d[i] = v; }
  return buf;
}

export const music = new Music();

/** Render a preview of a mood to a 16-bit WAV (debugging / sharing). */
export async function renderPreview(mood: Mood, seconds: number): Promise<ArrayBuffer> {
  const sr = 44100;
  const ac = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
  const m = new Music();
  m.attach(ac, ac.destination);
  m.scheduleOffline(ac, mood, seconds - 0.3);
  const buf = await ac.startRendering();
  const d = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, d.length * 2, true);
  let peak = 0.0001;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, (d[i] / peak) * 0.9)) * 32767, true);
  return out.buffer;
}
