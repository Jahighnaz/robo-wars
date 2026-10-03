// Screens, HUD and the main loop. Owns the save and the current run.
import { B, DNAME, DTYPES, PLACEABLE, RES, RES_KEYS, T, WORLDS, WORLD_KEYS, type Cost, type ResKey } from '../data';
import { angDiff, clamp, fmtTime, lerp, roman } from '../core/math';
import { describeSpecies } from '../enemies/species';
import { Run, type Card, type RunResult } from '../sim/run';
import { Renderer3D } from '../render/three/renderer3d';
import { Preview3D } from '../render/three/preview3d';
import { iconSvg } from '../render/icons';
import { Joystick } from '../input/joystick';
import { setMuted, shotSnd, snd, uiSnd, unlockAudio } from '../audio/audio';
import { defaultSave, exportCode, importCode, type Save, type Settings } from '../persistence/save';
import { persist } from '../persistence/storage';
import {
  compileVehicle, freshMods, makeVehicle, removeFromBuild, validCells,
  type Block, type BuildCell,
} from '../vehicle/vehicle';
import { $, el, gem } from './dom';
import { accumulate, addChallengeEntry, challengeScore, exportCard, importCard, publicProfile, type Challenge, type Profile } from '../meta/profile';
import { applyRun, fmtRecord, standings, type RecordDef } from '../meta/records';
import { evaluate, TIER_ORDER, TROPHIES, type TrophyDef } from '../meta/trophies';
import { cleanCode, Crew, newCrewCode, type CrewMsg } from '../net/crew';

type Mode = 'hub' | 'garage' | 'run' | 'cards' | 'place' | 'pause' | 'debrief' | 'menu';
const STEP = 1 / 60;
const PERK_ICON = 'M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5Z';

interface GridItem { x: number; y: number; t: string; r: number; hp?: number; max?: number }

export class App {
  save: Save;
  run: Run | null = null;
  mode: Mode = 'hub';
  private ui = $('ui');
  private renderer: Renderer3D;
  private preview: Preview3D | null = null;
  private joy: Joystick;
  private acc = 0;
  private last = 0;
  private hudT = 0;
  private levelFlash = -1;
  private endTimer = -1;
  private prev = { x: 0, y: 0, h: 0 };
  private toastTimer = 0;
  // garage state
  private gTool: string | null = null;
  private gSel: BuildCell | null = null;
  private gTab: 'workshop' | 'craft' = 'workshop';
  private gFresh: BuildCell | null = null;
  // social
  private crew: Crew;
  private screen = '';
  private activeChallenge: Challenge | null = null;
  private pauseAt = 0;
  private trophyQueue: TrophyDef[] = [];
  private trophyShowing = false;
  private crewWasOnline = false;
  private joinCode = '';

  constructor(save: Save) {
    this.save = save;
    setMuted(save.muted);
    const cv = $<HTMLCanvasElement>('cv');
    this.renderer = new Renderer3D(cv, $<HTMLCanvasElement>('ov'));
    this.crew = new Crew(() => publicProfile(this.profile), m => this.onCrewMsg(m), () => this.onCrewChange());
    this.joy = new Joystick(cv, () => this.mode === 'run', unlockAudio);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'run') this.showPause(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'p') { if (this.mode === 'run') this.showPause(); else if (this.mode === 'pause') this.resume(); }
    });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('pointerdown', unlockAudio, { capture: true });
    $('pauseBtn').addEventListener('click', () => this.showPause());
    this.onResize();
    this.showHub();
    requestAnimationFrame(t => this.frame(t));
  }

  private get settings(): Settings { return this.save.settings!; }
  private store() { persist(this.save); }

  private onResize() {
    this.renderer.resize();
    if (this.run) { this.run.setView(this.renderer.vw, this.renderer.vh); this.renderer.configureSpawn(this.run); }
    if (this.mode === 'garage') this.showGarage(true);
  }

  // ================================================================ loop
  private frame(now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const run = this.run;
    let alpha = 1;
    if (run && this.mode === 'run' && !run.over) {
      const v = this.joy.read();
      run.joy.x = v.x; run.joy.y = v.y;
      const scale = this.levelFlash > 0 ? 0.2 : 1;
      this.acc += dt * scale;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        this.snapshot(run);
        run.update(STEP);
        this.acc -= STEP;
        n++;
        if (run.over) break;
      }
      if (n >= 6) this.acc = 0;
      alpha = clamp(this.acc / STEP, 0, 1);
      if (!run.over && run.pendingLevels > 0) {
        if (this.levelFlash < 0) { this.levelFlash = 0.45; snd(880, 0.25, 'triangle', 0.04); this.toast('LEVEL UP', 700); }
        else {
          this.levelFlash -= dt;
          if (this.levelFlash <= 0) { this.levelFlash = -1; this.acc = 0; this.showCards(); }
        }
      }
    }
    if (run) {
      this.drainEvents(run);
      if (run.over && run.result && this.endTimer < 0 && this.mode !== 'debrief') this.endTimer = run.won ? 1.0 : 1.3;
      if (this.endTimer >= 0) {
        this.endTimer -= dt;
        if (this.endTimer < 0) this.finishRun(run.result!);
      }
    }
    const V = run?.V;
    const ip = V
      ? { alpha, vx: lerp(this.prev.x, V.x, alpha), vy: lerp(this.prev.y, V.y, alpha), vh: this.prev.h + angDiff(this.prev.h, V.h) * alpha }
      : { alpha: 1, vx: 0, vy: 0, vh: 0 };
    const showRun = run && (this.mode === 'run' || this.mode === 'cards' || this.mode === 'place' || this.mode === 'pause' || (this.mode !== 'debrief' && run.over));
    this.renderer.draw(showRun ? run : null, ip, {
      arcs: this.settings.arcs, shake: this.settings.shake, bloom: this.settings.bloom,
      joy: { active: this.joy.active && this.mode === 'run', ox: this.joy.ox, oy: this.joy.oy, x: this.joy.x, y: this.joy.y, radius: this.joy.radius },
      showHint: this.mode === 'run' && !this.joy.everUsed && this.save.runs < 3,
    }, dt);
    this.hudT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; if (run && (this.mode === 'run' || this.mode === 'pause')) this.updateHUD(); }
    requestAnimationFrame(t => this.frame(t));
  }

  private snapshot(run: Run) {
    this.prev.x = run.V.x; this.prev.y = run.V.y; this.prev.h = run.V.h;
    for (const e of run.E) { e.px = e.x; e.py = e.y; }
  }

  private drainEvents(run: Run) {
    for (const ev of run.events) {
      if (ev.k === 'toast') this.toast(ev.msg, ev.ms);
      else if (ev.k === 'snd') snd(ev.f, ev.dur, ev.type, ev.vol);
      else if (ev.k === 'shot') shotSnd(ev.f);
    }
    run.events.length = 0;
  }

  // ================================================================ HUD
  toast(msg: string, ms = 1600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), ms);
  }

  private updateHUD() {
    const G = this.run!;
    const RUN_LEN = T.runLength;
    const ht = $('hTime');
    ht.textContent = G.t < RUN_LEN ? fmtTime(RUN_LEN - G.t) : 'BOSS';
    ht.classList.toggle('boss', G.t >= RUN_LEN);
    $('hWave').textContent = G.t < RUN_LEN ? (G.breather ? 'BREATHER' : 'WAVE ' + (G.wave + 1)) : 'DESTROY THE APEX';
    $('xpbar').style.width = (clamp(G.xp / G.xpNeed, 0, 1) * 100).toFixed(1) + '%';
    $('hLvl').textContent = 'LV ' + G.level;
    $('hKills').textContent = G.kills + ' KILLS';
    const cab = G.V.list.find(b => b.t === 'cab');
    const cf = cab ? clamp(cab.hp / cab.max, 0, 1) : 0;
    const cb = $('cabbar');
    cb.style.width = (cf * 100).toFixed(1) + '%';
    cb.classList.toggle('low', cf < 0.3);
    const lootEl = $('hLoot');
    lootEl.replaceChildren(...RES_KEYS.filter(r => G.loot[r] > 0).map(r => el('div', { class: 'lootchip' }, gem(RES[r].color), String(G.loot[r]))));
    const bb = $('bossbar');
    if (G.bossE && !G.bossE.dead) {
      bb.classList.add('on');
      $('bossname').textContent = 'APEX ' + G.bossE.sp.name.toUpperCase();
      $('bossfill').style.width = (clamp(G.bossE.hp / G.bossE.max, 0, 1) * 100).toFixed(1) + '%';
    } else bb.classList.remove('on');
  }

  // ================================================================ modes
  private setMode(m: Mode) {
    this.mode = m;
    const inRun = m === 'run';
    $('hud').classList.toggle('off', !(m === 'run' || m === 'pause'));
    if (inRun) { this.ui.className = 'hidden'; this.ui.replaceChildren(); }
    else this.joy.release();
    if (m !== 'run' && m !== 'pause') $('bossbar').classList.remove('on');
  }

  private show(cls: string, ...nodes: Node[]) {
    this.ui.className = cls;
    this.ui.replaceChildren(...nodes);
    this.ui.scrollTop = 0;
  }

  private resume() {
    if (this.pauseAt && performance.now() - this.pauseAt > 120000) this.award('long_pause');
    this.pauseAt = 0;
    this.acc = 0;
    this.setMode('run');
  }

  private startRun(wk: string, challenge: Challenge | null = null) {
    unlockAudio();
    this.activeChallenge = challenge;
    const opts = { visual: true, dmgNumbers: this.settings.dmgNumbers, viewW: this.renderer.vw, viewH: this.renderer.vh };
    if (challenge) {
      // fair fight: everyone drives the same stock truck on the same map, and nothing is banked
      const scratch = defaultSave();
      scratch.settings = this.save.settings;
      this.run = new Run(scratch, wk, { ...opts, seed: challenge.seed, exhibition: true });
    } else this.run = new Run(this.save, wk, opts);
    this.renderer.configureSpawn(this.run);
    this.snapshot(this.run);
    this.acc = 0; this.levelFlash = -1; this.endTimer = -1;
    this.setMode('run');
    this.updateHUD();
    const W = this.run.W;
    this.toast(challenge ? 'CHALLENGE · ' + WORLDS[wk].name.toUpperCase() + ' · STOCK TRUCK' : WORLDS[wk].name.toUpperCase() + ' · TIER ' + W.tier + ' · GEN ' + W.gen, 2600);
    if (!this.save.seenHelp) { this.save.seenHelp = true; this.store(); }
  }

  // ================================================================ shared bits
  private resChips(res: Partial<Record<ResKey, number>>, filterZero = false) {
    return el('div', { class: 'resbar' }, RES_KEYS.filter(r => !filterZero || (res[r] || 0) > 0).map(r =>
      el('div', { class: 'res' }, gem(RES[r].color), RES[r].name, el('b', null, String(res[r] || 0)))));
  }
  private costChips(cost: Cost) {
    return el('div', { class: 'cost' }, (Object.keys(cost) as ResKey[]).map(r =>
      el('span', { class: (this.save.res[r] || 0) < (cost[r] || 0) ? 'short' : '' }, gem(RES[r].color), cost[r] + ' ' + RES[r].name)));
  }
  private canAfford(cost: Cost) { for (const r in cost) if ((this.save.res[r as ResKey] || 0) < (cost[r as ResKey] || 0)) return false; return true; }
  private pay(cost: Cost) { for (const r in cost) this.save.res[r as ResKey] -= cost[r as ResKey] || 0; }
  private up(t: string) { return this.save.up[t] || 0; }

  private blockIcon(t: string, size = 26, rot = 0) {
    return el('span', { html: iconSvg(t, B[t].color, size, rot), style: 'display:grid;place-items:center' });
  }

  private gridView(list: GridItem[], rlim: number, opts: { valid: [number, number][]; fresh?: GridItem | null; sel?: GridItem | null; maxW: number; onTap: (x: number, y: number, b: GridItem | null) => void }) {
    const n = rlim * 2 + 1;
    const csz = Math.floor(clamp((opts.maxW - 34) / n - 4, 34, 76));
    const valid = new Set(opts.valid.map(c => c[0] + ',' + c[1]));
    const g = el('div', { class: 'bgrid', style: `grid-template-columns:repeat(${n},${csz}px);--cs:${csz}px` });
    for (let y = -rlim; y <= rlim; y++) for (let x = -rlim; x <= rlim; x++) {
      const b = list.find(o => o.x === x && o.y === y);
      let cell: HTMLButtonElement;
      if (b) {
        const d = B[b.t];
        cell = el('button', {
          class: 'cell blk' + (b.t === 'cab' ? ' cab' : '') + (opts.fresh === b ? ' fresh' : '') + (opts.sel === b ? ' sel' : ''),
          style: `--bc:${d.color}`,
          'aria-label': d.name + (d.dir ? ', facing ' + ['forward', 'right', 'back', 'left'][b.r] : ''),
          onclick: () => opts.onTap(x, y, b),
          html: iconSvg(b.t, d.color, 24, d.dir ? b.r * 90 : 0),
        });
        if (d.dir) cell.append(el('span', { class: 'rot' }, '⟳'));
        if (b.max && b.hp !== undefined && b.hp < b.max) cell.append(el('span', { class: 'hpb' }, el('i', { style: 'width:' + Math.max(0, (b.hp / b.max) * 100) + '%' })));
      } else {
        const ok = valid.has(x + ',' + y);
        cell = el('button', { class: 'cell' + (ok ? ' valid' : ''), 'aria-label': ok ? 'Place here' : 'Empty', onclick: () => opts.onTap(x, y, null) });
      }
      g.append(cell);
    }
    return el('div', null, el('div', { class: 'fwd' }, 'Front'), el('div', { class: 'gridwrap' }, g));
  }

  // ================================================================ hub
  showHub() {
    this.run = null;
    this.setMode('hub');
    const s = this.save;
    const worlds = WORLD_KEYS.map(k => {
      const Wd = WORLDS[k], W = s.worlds[k];
      const maxw = Math.max(...Object.values(Wd.res).map(v => v || 0));
      const resist = DTYPES.filter(t => W.res[t] > 0).map(t => DNAME[t] + ' ' + Math.round(W.res[t] * 100) + '%');
      return el('div', { class: 'panel world', style: `--acc:${Wd.theme.accent}` },
        el('div', { class: 'bandimg' }),
        k === 'rust' && s.runs === 0 ? el('div', { class: 'badge' }, 'START HERE') : null,
        el('div', null, el('div', { class: 'kicker', style: `color:${Wd.theme.accent}` }, Wd.tag), el('h3', { class: 'wname' }, Wd.name)),
        el('div', { class: 'statline' },
          el('span', { class: 'stat' }, 'TIER ', el('b', null, String(W.tier))),
          el('span', { class: 'stat' }, 'GEN ', el('b', null, String(W.gen))),
          el('span', { class: 'stat' }, 'ERA ', el('b', null, String(W.era))),
          el('span', { class: 'stat' }, 'WINS ', el('b', null, W.wins + '/' + W.runs))),
        el('div', { class: 'meta' }, Wd.hazardText),
        el('div', { class: 'profile' }, (Object.keys(Wd.res) as ResKey[]).map(r => el('div', { class: 'prow' }, el('span', { class: 'lbl' }, RES[r].name),
          el('span', { class: 'bar', style: `color:${RES[r].color};background:${RES[r].color};width:${Math.max(4, ((Wd.res[r] || 0) / maxw) * 130)}px` })))),
        resist.length ? el('div', { class: 'meta', style: 'color:var(--red)' }, 'Adapted resistances: ' + resist.join(', ') + '.') : null,
        el('details', null, el('summary', null, W.species.length + ' living species'),
          el('div', { class: 'species' }, W.species.map(sp => el('div', null, el('b', null, sp.name), ' · gen ' + sp.born + ' · ' + describeSpecies(sp))))),
        W.log && W.log.length ? el('details', null, el('summary', null, 'Last evolution report'), el('div', { class: 'species' }, W.log.map(l => el('div', null, l)))) : null,
        el('button', { class: 'btn primary big', style: 'margin-top:auto', onclick: () => this.startRun(k) }, 'Launch ▸'));
    });
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'hub-head' },
        el('div', null,
          el('div', { class: 'kicker' }, 'Build · Survive · Tinker'),
          el('h1', { class: 'logo', 'data-text': 'CHARLES//PROJECTS' }, 'CHARLES', el('span', { class: 'slash', onclick: () => this.egg('slash') }, '//'), el('span', { class: 'evo' }, 'PROJECTS')),
          el('div', { class: 'stat', style: 'font-size:12px;display:inline-block;margin-top:14px' }, 'RUNS ', el('b', null, String(s.runs)), ' · WINS ', el('b', null, String(s.wins)), ' · SPECIES FOUND ', el('b', null, String(s.discovered)))),
        el('div', { class: 'captain' },
          el('img', { src: 'charles/portrait.png', alt: 'Captain Charles', draggable: 'false', onclick: (e: Event) => this.tapCharles(e.currentTarget as HTMLElement) }),
          el('div', null, el('div', { class: 'kicker' }, 'Captain'), el('div', { class: 'cname' }, 'Charles'), el('div', { class: 'meta', style: 'margin-top:6px' }, 'Driver: ', el('b', null, this.profile.name))))),
      el('p', { class: 'sub' }, "Captain Charles drives a workshop truck built from blocks. Bolt on nailguns, saw launchers, hot glue, laser and plasma cutters, survive five minutes of waves and scrap the apex. Every sector evolves against the way you build."),
      this.resChips(s.res),
      el('div', { class: 'nav' },
        el('button', { class: 'btn', onclick: () => { uiSnd(); this.gSel = null; this.gTool = null; this.showGarage(); } }, el('span', { html: iconSvg('cab', 'currentColor', 18) }), 'Garage'),
        el('button', { class: 'btn ghost', onclick: () => this.showHelp() }, 'How to play'),
        el('button', { class: 'btn', onclick: () => this.showCrew() }, 'Crew & records'),
        el('button', { class: 'btn', onclick: () => this.showTrophies() }, 'Trophies ' + this.trophyCount() + '/' + TROPHIES.length),
        el('button', { class: 'btn ghost', onclick: () => this.showSettings() }, 'Settings & backup')),
      el('h2', null, 'Choose a sector'),
      el('div', { class: 'worlds' }, worlds)));
  }

  // ================================================================ help
  private showHelp() {
    uiSnd();
    this.setMode('menu');
    const step = (n: string, acc: string, title: string, text: string, icon: string) =>
      el('div', { class: 'panel step', style: `--acc:${acc}` },
        el('div', { class: 'row' }, el('div', { class: 'num' }, n), el('span', { html: iconSvg(icon, acc, 30) })),
        el('h3', null, title), el('p', null, text));
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'kicker' }, 'Field manual'),
      el('h1', null, 'How to play'),
      el('div', { class: 'steps', style: 'margin-top:22px' },
        step('01', '#00f0ff', 'Drive', 'Touch anywhere and drag. Charles steers the truck toward your thumb. Let go to coast. That is the only control.', 'wheel'),
        step('02', '#ffd166', 'Aim by building', 'Every tool fires on its own, but only inside its arc. A nailgun facing backwards covers your retreat. The barrel on a block shows where it fires.', 'cannon'),
        step('03', '#5dff8a', 'Collect', 'Kills drop experience (cyan) and parts (diamonds). Park on a supply crystal for 2 seconds to salvage it.', 'magnet'),
        step('04', '#f5ff3b', 'Level up', 'Each level offers three cards: a new block to bolt on, an upgrade, or a perk. New blocks snap onto any free slot next to your machine.', 'battery'),
        step('05', '#ff2bd6', 'Stay connected', 'Blocks that lose their link to the cab fall off. Steel plates take 40% of hits on their neighbours. Battery packs feed arc welders and laser cutters; nailguns side by side fire faster.', 'armor'),
        step('06', '#ff2e63', 'Kill the apex', 'Survive 5:00, then destroy the apex to keep all loot. Dying keeps half. Afterwards the sector breeds its best machines and toughens up against your favourite tool.', 'tesla')),
      el('h2', null, 'Between runs'),
      el('p', { class: 'sub' }, 'In the garage, fabricate permanent blocks and arrange them on the grid. Workshop upgrades make every block of a type stronger. The Junkyard is rich in scrap metal, Cold Storage in lens glass, the Foundry in propane.'),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn primary', onclick: () => this.showHub() }, 'Back'))));
  }

  // ================================================================ settings
  private showSettings(msgText?: string) {
    this.setMode('menu');
    const s = this.save;
    const toggle = (label: string, desc: string, on: boolean, flip: () => void) =>
      el('button', { class: 'toggle', onclick: () => { flip(); this.store(); uiSnd(); this.showSettings(); } },
        el('div', { class: 'tl' }, label, el('div', null, desc)), el('span', { class: 'switch' + (on ? ' on' : '') }));
    const ta = el('textarea', { 'aria-label': 'Save code', spellcheck: 'false' });
    ta.value = exportCode(s);
    const msg = el('p', { class: 'sub' }, msgText || 'Copy this code somewhere safe (Notes works). Paste a code and tap Load to restore it. Codes from the prototype work too.');
    this.show('solid', el('div', { class: 'wrap screen-in', style: 'max-width:760px' },
      el('div', { class: 'kicker' }, 'System'),
      el('h1', null, 'Settings'),
      el('div', { class: 'panel', style: 'margin-top:18px;padding-top:4px;padding-bottom:4px' },
        toggle('Sound', 'Synth effects. Starts after your first touch.', !s.muted, () => { s.muted = !s.muted; setMuted(s.muted); }),
        toggle('Damage numbers', 'Floating numbers when you hit enemies.', this.settings.dmgNumbers, () => { this.settings.dmgNumbers = !this.settings.dmgNumbers; }),
        toggle('Firing arcs', 'Show where each tool fires at the start of a run.', this.settings.arcs, () => { this.settings.arcs = !this.settings.arcs; }),
        toggle('Neon glow', 'Bloom on the neon edges. Turn off if the game stutters.', this.settings.bloom, () => { this.settings.bloom = !this.settings.bloom; }),
        toggle('Screen shake', 'Shake the camera on hits and explosions.', this.settings.shake, () => { this.settings.shake = !this.settings.shake; })),
      el('h2', null, 'Back up your save'),
      msg, ta,
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn', onclick: () => {
          ta.select();
          navigator.clipboard?.writeText(ta.value).then(() => { msg.textContent = 'Copied to the clipboard.'; }, () => { msg.textContent = 'Select the text and copy it manually.'; });
        } }, 'Copy code'),
        el('button', { class: 'btn', onclick: () => {
          try { this.save = importCode(ta.value); setMuted(this.save.muted); this.store(); this.showSettings('Save loaded. Welcome back.'); }
          catch (e) { msg.textContent = 'That code could not be loaded: ' + (e as Error).message + '.'; }
        } }, 'Load code'),
        el('button', { class: 'btn danger', onclick: () => {
          if (confirm('Start over? This deletes your progress on this device.')) { this.save = defaultSave(); this.store(); this.showHub(); }
        } }, 'Start over')),
      el('h2', null, 'Install on iPad'),
      el('p', { class: 'sub' }, 'Open this page in Safari, tap Share, then "Add to Home Screen". The game then starts full screen from its own icon and works offline. Installed apps also keep their save more reliably.'),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn primary', onclick: () => this.showHub() }, 'Back'))));
  }

  // ================================================================ garage
  private garageMaxW() {
    const vw = this.renderer.vw;
    return vw >= 820 ? Math.min(vw, 1100) * 0.52 - 40 : Math.min(vw - 40, 600);
  }

  private garageTap(x: number, y: number, b: GridItem | null) {
    const s = this.save, list = s.build;
    const cell = b as BuildCell | null;
    if (this.gTool && !cell) {
      if ((s.inv[this.gTool] || 0) > 0 && validCells(list, s.gridR).some(c => c[0] === x && c[1] === y)) {
        const nb = { x, y, t: this.gTool, r: 0 };
        list.push(nb);
        s.inv[this.gTool]--;
        if (s.inv[this.gTool] <= 0) { delete s.inv[this.gTool]; this.gTool = null; }
        this.gFresh = nb; this.gSel = nb;
        snd(600, 0.1, 'triangle', 0.035);
        this.store();
      }
    } else if (cell) {
      if (this.gSel === cell && B[cell.t].dir) { cell.r = (cell.r + 1) % 4; snd(420, 0.06, 'triangle', 0.02); this.store(); }
      else { this.gSel = cell; this.gTool = null; uiSnd(440); }
    } else {
      this.gSel = null;
    }
    this.award('garage');
    this.showGarage(true);
  }

  private storeSelected() {
    const s = this.save, b = this.gSel;
    if (!b || b.t === 'cab') return;
    const removed = removeFromBuild(s.build, b);
    s.inv[b.t] = (s.inv[b.t] || 0) + 1;
    for (const o of removed) s.inv[o.t] = (s.inv[o.t] || 0) + 1;
    if (removed.length) this.toast(removed.length + ' disconnected block' + (removed.length > 1 ? 's' : '') + ' returned to storage', 1800);
    this.gSel = null;
    this.store();
    this.award('garage');
    this.showGarage(true);
  }

  showGarage(keepScroll = false) {
    this.run = null;
    this.setMode('garage');
    const s = this.save;
    const st = keepScroll ? this.ui.scrollTop : 0;
    if (this.gSel && !s.build.includes(this.gSel)) this.gSel = null;
    const valid = this.gTool && (s.inv[this.gTool] || 0) > 0 ? validCells(s.build, s.gridR) : [];
    const fresh = this.gFresh; this.gFresh = null;
    const invKeys = PLACEABLE.filter(t => (s.inv[t] || 0) > 0);

    const v = makeVehicle(s.build, s.up);
    const vs = compileVehicle(v, freshMods(), s.up);
    const hpTot = v.list.reduce((a, b) => a + b.max, 0);

    const tools = el('div', { class: 'tools' },
      invKeys.length ? invKeys.map(t => el('button', {
        class: 'tool' + (this.gTool === t ? ' sel' : ''),
        onclick: () => { this.gTool = this.gTool === t ? null : t; this.gSel = null; uiSnd(); this.showGarage(true); },
      }, this.blockIcon(t, 26), B[t].name, el('span', { class: 'cnt' }, '×' + s.inv[t]))) : null);

    let hint: Node;
    if (this.gTool) hint = el('span', null, 'Tap a glowing slot to place the ', el('b', null, B[this.gTool].name), '.');
    else if (this.gSel) hint = el('span', null, B[this.gSel.t].dir ? 'Tap it again to turn it.' : 'Selected.');
    else hint = el('span', null, invKeys.length ? 'Pick a block from storage below, then tap a slot. Tap a block on the grid to inspect or turn it.' : 'Tap a block to inspect or turn it. Fabricate more blocks on the right.');

    const sel = this.gSel;
    const inspector = sel ? el('div', { class: 'inspector' },
      this.blockIcon(sel.t, 34, B[sel.t].dir ? sel.r * 90 : 0),
      el('div', { class: 'nm' }, B[sel.t].name + (this.up(sel.t) ? ' Mk ' + roman(this.up(sel.t) + 1) : ''), el('div', null, B[sel.t].desc)),
      B[sel.t].dir ? el('button', { class: 'btn sm', onclick: () => { sel.r = (sel.r + 1) % 4; this.store(); this.showGarage(true); } }, '⟳ Turn') : null,
      sel.t !== 'cab' ? el('button', { class: 'btn sm ghost', onclick: () => this.storeSelected() }, 'Store') : null) : null;

    const meter = (label: string, val: string, frac: number, bad = false) =>
      el('div', { class: 'meter' + (bad ? ' bad' : '') }, el('div', { class: 'ml' }, label, el('b', null, val)), el('div', { class: 'mt' }, el('div', { class: 'mf', style: `width:${clamp(frac, 0.02, 1) * 100}%` })));
    const warn: string[] = [];
    if (!vs.thrust) warn.push('No propulsion: add wheels, tracks or hover pads.');
    if (vs.powerFactor < 1) warn.push(`Power overload: tools fire at ${Math.round(vs.powerFactor * 100)}%. Add batteries.`);
    if (!vs.weapons.length) warn.push('No tools mounted.');
    const stats = el('div', null,
      el('div', { class: 'meters' },
        meter('TOP SPEED', String(Math.round(vs.speed)), vs.speed / 290),
        meter('POWER', vs.power + ' / ' + vs.demand, vs.demand ? vs.power / Math.max(vs.power, vs.demand) : 1, vs.powerFactor < 1),
        meter('HULL HP', String(hpTot), hpTot / 1500),
        meter('PICKUP RANGE', String(vs.magnet), vs.magnet / 400)),
      warn.map(w => el('div', { class: 'warn' }, w)));

    this.preview ||= new Preview3D();
    const pw = Math.max(240, Math.min(this.garageMaxW() - 36, 560));
    this.preview.render(s.build, pw, Math.round(pw * 0.62));
    const preview = el('div', { class: 'preview' }, this.preview.canvas,
      el('p', null, 'Tool coverage. Each cone shows where a tool can hit; rings are 360° tools. Gaps are where enemies reach you unopposed. Tap a tool twice to turn it.'));

    // right column
    const exp = T.gridExpansions.find(g => g.r === s.gridR + 1);
    const owned = ['cab'].concat(PLACEABLE.filter(t => s.build.some(b => b.t === t) || (s.inv[t] || 0) > 0));
    const workshop = el('div', { class: 'craft' },
      el('p', { class: 'sub', style: 'margin:0 0 4px' }, 'Permanent. Applies to every block of that type, in every run.'),
      owned.map(t => {
        const L = this.up(t), max = L >= T.workshopMax, cost = max ? null : upCost(t, L);
        return el('div', { class: 'crow' },
          el('span', { class: 'sw', style: `--bc:${B[t].color}`, html: iconSvg(t, B[t].color, 24) }),
          el('div', { class: 'nm' }, B[t].name, el('span', { class: 'mk' }, 'MK ' + roman(L + 1)),
            el('div', { class: 'd' }, max ? 'Fully upgraded.' : upEffect(t) + '.'), cost ? this.costChips(cost) : null),
          max ? null : el('button', { class: 'btn sm', disabled: !this.canAfford(cost!), onclick: () => {
            this.pay(cost!); s.up[t] = L + 1; this.store(); snd(660, 0.15, 'triangle', 0.035);
            this.toast(B[t].name + ' upgraded to Mk ' + roman(L + 2), 1400); this.showGarage(true);
          } }, 'Upgrade'));
      }));
    const craft = el('div', { class: 'craft' },
      el('p', { class: 'sub', style: 'margin:0 0 4px' }, 'Fabricated blocks go to storage. Place them on the grid on the left.'),
      exp ? el('div', { class: 'crow', style: 'border-color:var(--acid)' },
        el('span', { class: 'sw', style: '--bc:#f5ff3b;font-family:var(--display);color:var(--acid)' }, (exp.r * 2 + 1) + '²'),
        el('div', { class: 'nm' }, 'Bigger build grid', el('div', { class: 'd' }, `Expand to ${exp.r * 2 + 1}×${exp.r * 2 + 1}. In a run you can always build one ring further.`), this.costChips(exp.cost)),
        el('button', { class: 'btn sm', disabled: !this.canAfford(exp.cost), onclick: () => { this.pay(exp.cost); s.gridR = exp.r; this.store(); snd(700, 0.2, 'triangle', 0.04); this.showGarage(true); } }, 'Expand')) : null,
      PLACEABLE.map(t => el('div', { class: 'crow' },
        el('span', { class: 'sw', style: `--bc:${B[t].color}`, html: iconSvg(t, B[t].color, 24) }),
        el('div', { class: 'nm' }, B[t].name, s.inv[t] ? el('span', { class: 'stored' }, s.inv[t] + ' STORED') : null, el('div', { class: 'd' }, B[t].desc), this.costChips(B[t].cost || {})),
        el('button', { class: 'btn sm', disabled: !this.canAfford(B[t].cost || {}), onclick: () => {
          this.pay(B[t].cost || {}); s.inv[t] = (s.inv[t] || 0) + 1; this.gTool = t; this.gSel = null; this.store(); snd(520, 0.1, 'triangle', 0.03); this.award('craft:' + t);
          this.toast(B[t].name + ' fabricated. Tap a glowing slot to place it.', 1800); this.showGarage(true);
        } }, 'Fabricate'))));

    const tab = (id: 'workshop' | 'craft', label: string) => el('button', { class: 'tab' + (this.gTab === id ? ' on' : ''), onclick: () => { this.gTab = id; uiSnd(); this.showGarage(true); } }, label);

    this.show('solid', el('div', { class: 'wrap' + (keepScroll ? '' : ' screen-in') },
      el('div', { class: 'row' },
        el('div', null, el('div', { class: 'kicker' }, 'Workshop'), el('h1', null, 'Garage')),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn primary', onclick: () => { this.gSel = null; this.gTool = null; this.showHub(); } }, 'Done')),
      this.resChips(s.res),
      el('div', { class: 'garage' },
        el('div', { class: 'panel' },
          this.gridView(s.build, s.gridR, { valid, fresh, sel: this.gSel, maxW: this.garageMaxW(), onTap: (x, y, b) => this.garageTap(x, y, b) }),
          el('p', { class: 'hint' }, hint),
          inspector,
          invKeys.length ? el('h2', { style: 'margin-top:16px' }, 'Storage') : null,
          tools, stats, preview),
        el('div', { class: 'panel' },
          el('div', { class: 'tabs' }, tab('workshop', 'Upgrades'), tab('craft', 'Fabricate')),
          this.gTab === 'workshop' ? workshop : craft))));
    if (keepScroll) this.ui.scrollTop = st;
  }

  // ================================================================ cards
  private showCards() {
    const run = this.run!;
    this.setMode('cards');
    const cards = run.makeCards();
    const icon = (c: Card) => {
      if (c.kind === 'block' || c.kind === 'up') return iconSvg(c.t, B[c.t].color, 32);
      if (c.kind === 'repair') return iconSvg('repair', '#5dff8a', 32);
      return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff2bd6" stroke-width="2" stroke-linejoin="round"><path d="${PERK_ICON}"/></svg>`;
    };
    this.show('dim', el('div', { class: 'wrap mid' },
      el('div', { class: 'center' }, el('div', { class: 'kicker' }, 'Choose one upgrade'), el('div', { class: 'lvl-title' }, 'LEVEL ' + run.level)),
      el('div', { class: 'cards' }, cards.map(c => el('button', { class: 'card k-' + c.kind, onclick: () => this.pickCard(c) },
        el('div', { class: 'cico', html: icon(c) }),
        el('div', { class: 'kind' }, c.label), el('div', { class: 'ttl' }, c.title), el('div', { class: 'dsc' }, c.desc),
        c.kind === 'block' ? el('div', { class: 'foot' }, 'BOLTED ON FOR THIS RUN') : null))),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:18px' },
        el('button', { class: 'btn ghost', disabled: run.reroll <= 0, onclick: () => { run.reroll--; uiSnd(); this.award('reroll'); this.showCards(); } }, 'Reroll · ' + run.reroll + ' left'))));
    snd(740, 0.18, 'triangle', 0.04);
  }

  private pickCard(c: Card) {
    const run = this.run!;
    uiSnd(620);
    if (c.kind === 'block') { this.showPlacement(c.t, null); return; }
    run.applyCard(c);
    this.afterCard();
  }

  private afterCard() {
    const run = this.run!;
    run.consumeLevel();
    if (run.pendingLevels > 0) this.showCards();
    else this.resume();
  }

  private showPlacement(t: string, fresh: Block | null) {
    const run = this.run!;
    this.setMode('place');
    const rlim = this.save.gridR + 1;
    const valid = fresh ? [] : run.placementCells();
    const onTap = (x: number, y: number, b: GridItem | null) => {
      if (!fresh && !b && valid.some(c => c[0] === x && c[1] === y)) {
        const nb = run.placeBlock(x, y, t);
        snd(600, 0.12, 'triangle', 0.04);
        this.showPlacement(t, nb);
      } else if (b && B[b.t].dir) {
        run.rotateBlock(b as Block);
        snd(420, 0.06, 'triangle', 0.02);
        this.showPlacement(t, fresh);
      }
    };
    const maxW = Math.min(this.renderer.vw - 40, 620, (this.renderer.vh - 260) * 1.0);
    this.show('dim', el('div', { class: 'wrap mid', style: 'max-width:700px' },
      el('div', { class: 'center' }, el('div', { class: 'kicker' }, fresh ? 'Bolted on' : 'New block'),
        el('div', { class: 'lvl-title', style: 'font-size:clamp(24px,4vw,34px)' }, fresh ? B[t].name + ' placed' : 'Place your ' + B[t].name)),
      el('p', { class: 'hint', style: 'margin:8px 0 14px' }, fresh
        ? (B[t].dir ? 'Tap any tool to turn it. The arrow shows where it fires.' : 'Tap any tool to turn it, or continue.')
        : 'Tap a glowing slot next to your machine.'),
      this.gridView(run.V.list, rlim, { valid, fresh, maxW: Math.max(260, maxW), onTap }),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:18px' },
        fresh ? el('button', { class: 'btn primary big', onclick: () => this.afterCard() }, 'Continue ▸')
          : el('button', { class: 'btn ghost', onclick: () => this.afterCard() }, 'Skip this block'))));
  }

  // ================================================================ pause
  private showPause() {
    const run = this.run;
    if (this.mode !== 'run' || !run) return;
    if (!this.pauseAt) this.pauseAt = performance.now();
    this.setMode('pause');
    const toggleBtn = (label: string, on: boolean, flip: () => void) =>
      el('button', { class: 'btn sm ghost', onclick: () => { flip(); this.store(); this.setMode('run'); this.showPause(); } }, label + ': ' + (on ? 'on' : 'off'));
    this.show('dim', el('div', { class: 'wrap mid', style: 'max-width:760px' },
      el('div', { class: 'center' },
        el('div', { class: 'kicker' }, run.Wd.name),
        el('div', { class: 'lvl-title', style: 'color:var(--cyan);text-shadow:0 0 22px rgba(0,240,255,.6)' }, 'PAUSED'),
        el('p', { class: 'sub', style: 'margin:8px auto 18px' }, fmtTime(run.t) + ' survived · level ' + run.level + ' · ' + run.kills + ' kills')),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn primary big', onclick: () => this.resume() }, 'Resume'),
        el('button', { class: 'btn danger', onclick: () => { this.pauseAt = 0; this.award('abandon'); run.end(false); this.setMode('run'); this.ui.className = 'hidden'; } }, run.exhibition ? 'Abandon challenge' : 'Abandon (keep half)')),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        toggleBtn('Sound', !this.save.muted, () => { this.save.muted = !this.save.muted; setMuted(this.save.muted); }),
        toggleBtn('Damage numbers', this.settings.dmgNumbers, () => { this.settings.dmgNumbers = !this.settings.dmgNumbers; run.dmgNumbers = this.settings.dmgNumbers; }),
        toggleBtn('Shake', this.settings.shake, () => { this.settings.shake = !this.settings.shake; })),
      el('h2', null, 'Damage so far'),
      damageReport(run.dmgBy, run.killsSrc, run.peak, run.t)));
  }

  // ================================================================ debrief
  private finishRun(r: RunResult) {
    const p = this.profile;
    const ch = this.activeChallenge;
    accumulate(p, r);
    const improved = applyRun(p, r, !!ch);
    let score = 0;
    if (ch) {
      score = challengeScore(r);
      const entry = { pid: p.id, name: p.name, score, t: r.t, kills: r.kills, won: r.won, at: Date.now() };
      const local = p.challenges.find(c => c.id === ch.id) || ch;
      addChallengeEntry(local, entry);
      this.crew.send({ k: 'entry', cid: ch.id, e: entry });
      if (local.entries.some(e => e.pid !== p.id && e.score < score)) this.award('beat_mate');
    }
    const unlocked = this.award(undefined, r, !!ch);
    const sector = WORLDS[r.wk].name;
    this.crew.send({ k: 'news', from: p.id, text: ch
      ? `${p.name} scored ${score.toLocaleString('en')} in the ${sector} challenge`
      : r.won ? `${p.name} just destroyed the apex in the ${sector}!` : `${p.name} got wrecked in the ${sector} after ${fmtTime(r.t)}` });
    this.store();
    this.showDebrief(r, improved, unlocked, ch, score);
  }

  private showDebrief(r: RunResult, improved: RecordDef[] = [], unlocked: TrophyDef[] = [], ch: Challenge | null = null, score = 0) {
    this.setMode('debrief');
    const keys = Object.keys(r.gained);
    const Wd = WORLDS[r.wk];
    const big = (v: string, l: string, c?: string) => el('div', { class: 'bigstat' }, el('div', { class: 'v', style: c ? `color:${c}` : '' }, v), el('div', { class: 'l' }, l));
    const board = ch ? (this.profile.challenges.find(c => c.id === ch.id) || ch) : null;
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'kicker', style: `color:${Wd.theme.accent}` }, Wd.name + (ch ? ' · challenge result' : ' · debrief')),
      el('h1', { style: `color:${r.won ? 'var(--acid)' : 'var(--red)'};text-shadow:0 0 26px ${r.won ? 'rgba(245,255,59,.5)' : 'rgba(255,46,99,.5)'}` }, r.won ? 'APEX DESTROYED' : 'TRUCK WRECKED'),
      el('p', { class: 'sub', style: 'margin-top:10px' }, ch ? 'Challenge runs use the stock truck and bank nothing. Only the score counts.' : r.won ? 'All loot kept. The world grows one tier stronger.' : 'Half of the loot was salvaged.'),
      el('div', { class: 'bigstats' },
        ch ? big(score.toLocaleString('en'), 'CHALLENGE SCORE', 'var(--acid)') : null,
        big(fmtTime(r.t), 'SURVIVED'), big(String(r.level), 'LEVEL'), big(String(r.kills), 'KILLS'),
        big(Math.round(r.taken).toLocaleString('en'), 'DAMAGE TAKEN', 'var(--red)'),
        r.newSpecies ? big('+' + r.newSpecies, 'NEW SPECIES', 'var(--mag)') : null),
      board ? el('h2', null, 'Challenge leaderboard') : null,
      board ? this.challengeTable(board) : null,
      unlocked.length ? el('h2', null, 'Trophies unlocked') : null,
      unlocked.length ? el('div', { class: 'trophies' }, unlocked.map(t => this.trophyCard(t, true))) : null,
      improved.length ? el('h2', null, 'New personal records') : null,
      improved.length ? el('div', { class: 'log terminal' }, improved.map((d, i) => el('div', { style: `animation-delay:${0.1 + i * 0.1}s` },
        el('b', null, d.label + ': ' + fmtRecord(d, this.profile.best[d.id])), ' · title: "' + d.title + '"'))) : null,
      ch ? null : el('h2', null, 'Loot banked'),
      ch ? null : keys.length ? this.resChips(r.gained, true) : el('p', { class: 'sub' }, 'Nothing salvaged this time.'),
      el('h2', null, 'Damage report'),
      damageReport(r.dmg, r.ks, r.peak, r.t),
      ch ? null : el('h2', null, 'How ' + Wd.name + ' evolved'),
      ch ? null : el('div', { class: 'log terminal' }, r.report.length ? r.report.map((l, i) => el('div', { style: `animation-delay:${0.15 + i * 0.12}s` }, l)) : el('div', null, 'No changes.')),
      el('div', { class: 'row', style: 'margin-top:22px' },
        ch ? el('button', { class: 'btn primary big', onclick: () => this.startRun(ch.wk, ch) }, 'Try again') : el('button', { class: 'btn primary big', onclick: () => { this.gSel = null; this.gTool = null; this.showGarage(); } }, 'Garage'),
        ch ? el('button', { class: 'btn big', onclick: () => this.showCrew() }, 'Crew & records') : el('button', { class: 'btn big', onclick: () => this.startRun(r.wk) }, 'Run again'),
        el('button', { class: 'btn ghost', onclick: () => this.showHub() }, 'Sector map'))));
  }

  // ================================================================ trophies & records
  private get profile(): Profile { return this.save.profile!; }
  private trophyCount() { return Object.keys(this.profile.trophies).length; }

  /** Check trophies; queue toasts for new ones; share the new profile with the crew. */
  private award(event?: string, r?: RunResult, challenge = false): TrophyDef[] {
    const got = evaluate({ save: this.save, p: this.profile, r, challenge, event, now: new Date() });
    if (got.length || r) {
      this.store();
      this.crew.send({ k: 'profile', p: publicProfile(this.profile) });
    }
    for (const t of got) this.trophyQueue.push(t);
    this.pumpTrophies();
    return got;
  }

  private pumpTrophies() {
    if (this.trophyShowing || !this.trophyQueue.length) return;
    const t = this.trophyQueue.shift()!;
    this.trophyShowing = true;
    const box = $('trophy');
    box.className = 'trophy-toast on tier-' + t.tier;
    box.replaceChildren(el('div', { class: 'tt-cup', html: CUP }), el('div', null, el('div', { class: 'tt-kind' }, (t.hidden ? 'Easter egg · ' : '') + t.tier + ' trophy unlocked'), el('div', { class: 'tt-title' }, t.title)));
    snd(t.tier === 'platinum' ? 1046 : t.tier === 'gold' ? 880 : 740, 0.35, 'triangle', 0.045);
    setTimeout(() => snd(1175, 0.3, 'triangle', 0.035), 140);
    setTimeout(() => { box.classList.remove('on'); setTimeout(() => { this.trophyShowing = false; this.pumpTrophies(); }, 350); }, 3200);
  }

  private egg(kind: 'slash' | 'tap_charles') {
    const e = this.profile.eggs;
    e[kind] = (e[kind] || 0) + 1;
    this.award(kind);
    this.store();
  }

  private tapCharles(img: HTMLElement) {
    const n = (this.profile.eggs.tap_charles || 0) % CHARLES_SAYS.length;
    this.toast('Charles: "' + CHARLES_SAYS[n] + '"', 2600);
    img.classList.remove('boing'); void img.offsetWidth; img.classList.add('boing');
    snd(300 + Math.random() * 200, 0.12, 'square', 0.03);
    this.egg('tap_charles');
  }

  private trophyCard(t: TrophyDef, fresh = false) {
    const got = this.profile.trophies[t.id];
    const secret = t.hidden && !got;
    return el('div', { class: 'trophy tier-' + t.tier + (got ? ' got' : ' locked') + (fresh ? ' fresh' : '') },
      el('div', { class: 'tcup', html: CUP }),
      el('div', { class: 'tbody' },
        el('div', { class: 'tkind' }, (t.hidden ? 'Easter egg · ' : '') + t.tier),
        el('div', { class: 'ttitle' }, secret ? '???' : t.title),
        el('div', { class: 'tdesc' }, secret ? 'A hidden trophy. Keep poking around.' : t.desc),
        got ? el('div', { class: 'tdate' }, 'Unlocked ' + new Date(got).toLocaleDateString()) : null));
  }

  private showTrophies() {
    uiSnd();
    this.setMode('menu');
    this.screen = 'trophies';
    const has = (t: TrophyDef) => (this.profile.trophies[t.id] ? 0 : 1);
    const sorted = [...TROPHIES].sort((a, b) => has(a) - has(b) || Number(!!a.hidden) - Number(!!b.hidden) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
    const count = (tier: string) => TROPHIES.filter(t => t.tier === tier && this.profile.trophies[t.id]).length + '/' + TROPHIES.filter(t => t.tier === tier).length;
    const got = this.trophyCount();
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'row' },
        el('div', null, el('div', { class: 'kicker' }, 'Trophy cabinet'), el('h1', null, 'Trophies')),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn primary', onclick: () => this.showHub() }, 'Back')),
      el('div', { class: 'tprog' }, el('div', { class: 'tprog-bar' }, el('i', { style: `width:${(got / TROPHIES.length) * 100}%` })),
        el('div', { class: 'statline', style: 'margin-top:10px' },
          el('span', { class: 'stat' }, 'TOTAL ', el('b', null, got + '/' + TROPHIES.length)),
          ...(['platinum', 'gold', 'silver', 'bronze'] as const).map(t => el('span', { class: 'stat tier-' + t }, t.toUpperCase() + ' ', el('b', null, count(t)))))),
      el('div', { class: 'trophies', style: 'margin-top:18px' }, sorted.map(t => this.trophyCard(t)))));
  }

  private challengeTable(c: Challenge) {
    if (!c.entries.length) return el('p', { class: 'sub' }, 'No scores yet. Be the first.');
    return el('div', { class: 'log rep' }, c.entries.map((e, i) => el('div', { class: 'crow-line' + (e.pid === this.profile.id ? ' me' : '') },
      el('span', { class: 'rank' }, '#' + (i + 1)),
      el('span', { class: 'nm' }, e.name + (i === 0 ? ' · Top of the League' : i === c.entries.length - 1 && c.entries.length > 2 ? ' · Participation Award' : '')),
      el('span', { class: 'num' }, el('b', null, e.score.toLocaleString('en')), ' · ' + fmtTime(e.t) + ' · ' + e.kills + ' kills' + (e.won ? ' · apex' : '')))));
  }

  // ================================================================ crew
  private onCrewChange() {
    const online = this.crew.status === 'online';
    if (online && !this.crewWasOnline) {
      this.profile.crewCode = this.crew.code;
      this.award('crew');
      this.store();
    }
    this.crewWasOnline = online;
    this.rememberMates();
    if (this.mode === 'menu' && this.screen === 'crew') this.showCrew(true);
  }

  private rememberMates() {
    const me = this.profile.id;
    for (const [id, p] of this.crew.members) if (id !== me) this.profile.mates[id] = p;
  }

  private mergeChallenge(c: Challenge) {
    const list = this.profile.challenges;
    const ex = list.find(x => x.id === c.id);
    if (ex) { for (const e of c.entries || []) addChallengeEntry(ex, e); return false; }
    list.unshift({ ...c, entries: [...(c.entries || [])] });
    list.sort((a, b) => b.at - a.at);
    list.length = Math.min(list.length, 10);
    return true;
  }

  private onCrewMsg(m: CrewMsg) {
    const me = this.profile;
    if (m.k === 'hello' && this.crew.isHost) {
      // bring the newcomer up to speed on recent challenges
      for (const c of me.challenges.slice(0, 3)) this.crew.send({ k: 'challenge', c });
      this.toast(m.p.name + ' clocked in to the crew', 2200);
    } else if (m.k === 'news') {
      if (m.from !== me.id) this.toast(m.text, 3000);
    } else if (m.k === 'challenge') {
      if (this.mergeChallenge(m.c) && m.c.by !== me.id) this.toast(`${m.c.byName} started a challenge in the ${WORLDS[m.c.wk]?.name || 'sector'}. Open Crew & records to play.`, 3600);
    } else if (m.k === 'entry') {
      const c = me.challenges.find(x => x.id === m.cid);
      if (c) {
        addChallengeEntry(c, m.e);
        const mine = c.entries.find(e => e.pid === me.id);
        if (mine && m.e.pid !== me.id && mine.score > m.e.score) this.award('beat_mate');
      }
    }
    this.rememberMates();
    this.store();
    if (this.mode === 'menu' && this.screen === 'crew') this.showCrew(true);
  }

  private startChallenge(wk: string) {
    const p = this.profile;
    const c: Challenge = { id: Math.random().toString(36).slice(2, 10), wk, seed: (Math.random() * 2 ** 31) >>> 0, by: p.id, byName: p.name, at: Date.now(), entries: [] };
    this.mergeChallenge(c);
    this.crew.send({ k: 'challenge', c });
    this.store();
    uiSnd(660);
    this.toast('Challenge posted. Everyone plays the same map with the stock truck.', 2600);
    this.showCrew(true);
  }

  private showCrew(keepScroll = false) {
    this.setMode('menu');
    this.screen = 'crew';
    const st = keepScroll ? this.ui.scrollTop : 0;
    const p = this.profile, crew = this.crew;
    const me = publicProfile(p);
    const mates = Object.values(p.mates);

    // --- you
    const nameIn = el('input', { class: 'txt', maxlength: '24', value: p.name, 'aria-label': 'Your name' }) as HTMLInputElement;
    const you = el('div', { class: 'panel' },
      el('h3', null, 'Your badge'),
      el('div', { class: 'row', style: 'margin-top:10px' }, nameIn,
        el('button', { class: 'btn sm', onclick: () => {
          const v = nameIn.value.trim().slice(0, 24);
          if (!v) return;
          p.name = v; this.store(); this.award('rename'); this.toast('Name tag updated.', 1400); this.showCrew(true);
        } }, 'Save name')),
      el('div', { class: 'statline', style: 'margin-top:12px' },
        el('span', { class: 'stat' }, 'SHIFTS ', el('b', null, String(p.life.runs || 0))),
        el('span', { class: 'stat' }, 'APEXES ', el('b', null, String(p.life.wins || 0))),
        el('span', { class: 'stat' }, 'KILLS ', el('b', null, String(p.life.kills || 0))),
        el('span', { class: 'stat' }, 'TROPHIES ', el('b', null, this.trophyCount() + '/' + TROPHIES.length))));

    // --- crew connection
    const codeIn = el('input', { class: 'txt code', maxlength: '6', placeholder: 'CODE', value: this.joinCode, 'aria-label': 'Crew code', autocapitalize: 'characters' }) as HTMLInputElement;
    codeIn.addEventListener('input', () => { this.joinCode = cleanCode(codeIn.value); });
    const online = crew.status === 'online';
    const statusLine = crew.status === 'connecting' ? el('p', { class: 'sub' }, 'Connecting…')
      : crew.status === 'error' ? el('p', { class: 'sub', style: 'color:var(--red)' }, crew.error)
      : !online ? el('p', { class: 'sub' }, 'Start a crew on one device and share the code. Everyone else joins with it. Phones and iPads on the same Wi-Fi then talk to each other directly.') : null;
    const members = online ? [...crew.members.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
    const crewPanel = el('div', { class: 'panel', style: '--acc:var(--mag)' },
      el('h3', null, 'Crew'),
      online ? el('div', { class: 'crewcode' }, el('div', { class: 'kicker' }, crew.isHost ? 'You host crew' : 'Crew code'), el('div', { class: 'code-big' }, crew.code)) : null,
      statusLine,
      online ? el('div', { class: 'members' }, members.map(m => el('div', { class: 'member' + (crew.online.has(m.id) ? ' on' : '') },
        el('span', { class: 'dot' }), m.name + (m.id === p.id ? ' (you)' : '') + (m.id === crew.hostId ? ' · host' : ''),
        el('span', { class: 'mstat' }, (m.trophies?.length || 0) + ' trophies')))) : null,
      el('div', { class: 'row', style: 'margin-top:12px' },
        online || crew.status === 'connecting'
          ? el('button', { class: 'btn sm ghost', onclick: () => { crew.leave(); this.showCrew(true); } }, 'Leave crew')
          : [
            el('button', { class: 'btn sm', onclick: () => { void crew.host(newCrewCode()); this.showCrew(true); } }, 'Start a crew'),
            codeIn,
            el('button', { class: 'btn sm', onclick: () => { const c = cleanCode(codeIn.value); if (c.length >= 4) { this.joinCode = c; void crew.join(c); this.showCrew(true); } } }, 'Join'),
            p.crewCode ? el('button', { class: 'btn sm ghost', onclick: () => { void crew.join(p.crewCode!); this.showCrew(true); } }, 'Rejoin ' + p.crewCode) : null,
          ]),
      el('p', { class: 'hint', style: 'text-align:left' }, 'Devices find each other through a free connection broker, so everyone needs internet. On the same Wi-Fi the game data then goes directly between devices.'));

    // --- challenges
    const chal = el('div', { class: 'panel', style: '--acc:var(--acid)' },
      el('h3', null, 'Shift challenges'),
      el('p', { class: 'sub', style: 'margin:6px 0 10px' }, 'Same map, same stock truck, nothing banked. Score = kills × 10 + seconds × 2 + level × 25, plus 1,000 for the apex.' + (online ? ' Posting a challenge sends it to the whole crew.' : ' Join a crew to compete; you can still practise solo.')),
      el('div', { class: 'row' }, WORLD_KEYS.map(k => el('button', { class: 'btn sm', style: `--cut:9px;color:${WORLDS[k].theme.accent}`, onclick: () => this.startChallenge(k) }, 'New: ' + WORLDS[k].name))),
      p.challenges.slice(0, 5).map(c => el('div', { class: 'chal' },
        el('div', { class: 'row' },
          el('div', null, el('b', null, WORLDS[c.wk]?.name || c.wk), el('div', { class: 'meta' }, 'Posted by ' + c.byName + ' · ' + new Date(c.at).toLocaleString())),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm primary', onclick: () => this.startRun(c.wk, c) }, 'Play')),
        this.challengeTable(c))));

    // --- records board
    const board = standings(me, mates);
    const recCard = (s: ReturnType<typeof standings>[number]) => el('div', { class: 'rec ' + s.def.kind + (s.holder && s.holder.id === p.id ? ' mine' : '') },
      el('div', { class: 'rlabel' }, s.def.label),
      el('div', { class: 'rtitle' }, s.def.title),
      el('div', { class: 'rholder' }, s.holder ? el('span', null, el('b', null, s.holder.name), ' · ' + fmtRecord(s.def, s.value!)) : el('span', null, 'Unclaimed. Go get it.')),
      s.mine !== null && !(s.holder && s.holder.id === p.id) ? el('div', { class: 'rmine' }, 'You: ' + fmtRecord(s.def, s.mine)) : null);
    const records = el('div', null,
      el('h2', null, 'Records · serious'),
      el('div', { class: 'recs' }, board.filter(s => s.def.kind === 'serious').map(recCard)),
      el('h2', null, 'Records · questionable'),
      el('div', { class: 'recs' }, board.filter(s => s.def.kind === 'fun').map(recCard)),
      el('p', { class: 'hint', style: 'text-align:left' }, mates.length ? `Board includes ${mates.length} crew-mate${mates.length > 1 ? 's' : ''} (last known records).` : 'Only your records so far. Join a crew or swap record cards to compare.'));

    // --- offline record cards
    const myCard = el('textarea', { readonly: 'true', 'aria-label': 'Your record card' }) as HTMLTextAreaElement;
    myCard.value = exportCard(p);
    const theirs = el('textarea', { placeholder: 'Paste a crew-mate\'s record card here', 'aria-label': 'Crew-mate record card' }) as HTMLTextAreaElement;
    const cardMsg = el('p', { class: 'sub' }, 'No internet? Swap record cards instead: send yours by AirDrop or Messages, paste theirs here.');
    const cards = el('details', { class: 'panel' },
      el('summary', null, 'Record cards (works offline)'),
      cardMsg,
      myCard,
      el('div', { class: 'row', style: 'margin:10px 0 16px' },
        el('button', { class: 'btn sm', onclick: () => { myCard.select(); navigator.clipboard?.writeText(myCard.value).then(() => { cardMsg.textContent = 'Your card is on the clipboard.'; }, () => { cardMsg.textContent = 'Select the text and copy it.'; }); } }, 'Copy my card')),
      theirs,
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'btn sm', onclick: () => {
          try {
            const c = importCard(theirs.value);
            if (c.id === p.id) throw new Error('that is your own card');
            p.mates[c.id] = c; this.store(); this.toast(c.name + ' added to your board', 1800); this.showCrew(true);
          } catch (e) { cardMsg.textContent = 'Could not add the card: ' + (e as Error).message + '.'; }
        } }, 'Add to my board')),
      mates.length ? el('div', { class: 'members', style: 'margin-top:12px' }, mates.map(m => el('div', { class: 'member' },
        el('span', { class: 'dot' }), m.name,
        el('button', { class: 'btn sm ghost', style: 'margin-left:auto;min-height:34px', onclick: () => { delete p.mates[m.id]; this.store(); this.showCrew(true); } }, 'Remove')))) : null);

    this.show('solid', el('div', { class: 'wrap' + (keepScroll ? '' : ' screen-in') },
      el('div', { class: 'row' },
        el('div', null, el('div', { class: 'kicker' }, 'Break room'), el('h1', null, 'Crew & records')),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => this.showTrophies() }, 'Trophies'),
        el('button', { class: 'btn primary', onclick: () => this.showHub() }, 'Back')),
      el('div', { class: 'social-grid', style: 'margin-top:16px' }, you, crewPanel),
      chal,
      records,
      cards));
    if (keepScroll) this.ui.scrollTop = st;
  }
}

const CUP = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 3H17V9A5 5 0 0 1 7 9Z M7 5H3V7A3 3 0 0 0 7 10 M17 5H21V7A3 3 0 0 1 17 10 M12 14V18 M8 21H16 M9 18H15V21H9Z"/></svg>';

const CHARLES_SAYS = [
  'Measure once, cut twice. Wait, no.',
  'That is not a bug, it is a feature.',
  'Righty tighty, lefty loosey.',
  'I will fix it this weekend. Definitely.',
  'Have you tried turning it off and on again?',
  'Per my last email: more nailguns.',
  'There is no problem duct tape cannot postpone.',
  'Safety glasses are a lifestyle.',
  'Let us take this offline. Into the Foundry.',
  'The plan is: no plan survives the first wave.',
  'Stop poking me. I am driving.',
];

// ================================================================ helpers
export function upCost(t: string, L: number): Cost {
  const base = B[t].cost || { scrap: 50, copper: 20 };
  const c: Cost = {};
  for (const r in base) c[r as ResKey] = Math.ceil((base[r as ResKey] || 0) * 1.5 * (L + 1));
  if (L >= 2) c.shard = L - 1;
  return c;
}

export function upEffect(t: string): string {
  const d = B[t];
  const parts = ['+20% HP'];
  if (d.w) parts.push('+15% damage', '+5% fire rate');
  if (d.thrust) parts.push('+8% thrust');
  if (t === 'battery' || t === 'cab') parts.push('+1 power');
  if (d.magnet) parts.push('+25 pickup range');
  if (d.regen || d.repair) parts.push('+25% healing');
  return parts.join(', ') + ' per level';
}

function damageReport(dmg: Record<string, number>, ks: Record<string, number>, peak: Record<string, number>, t: number) {
  const keys = Object.keys(dmg).filter(k => dmg[k] >= 1 && B[k]).sort((a, b) => dmg[b] - dmg[a]);
  if (!keys.length) return el('p', { class: 'sub' }, 'No damage dealt.');
  const total = keys.reduce((a, k) => a + dmg[k], 0), top = dmg[keys[0]];
  return el('div', { class: 'log rep' },
    keys.map(k => el('div', { class: 'rrow' },
      el('div', { class: 'nm', html: iconSvg(k, B[k].color, 18) }, B[k].name + (peak[k] > 1 ? ' ×' + peak[k] : '')),
      el('div', { class: 'track' }, el('div', { class: 'fill', style: `background:${B[k].color};box-shadow:0 0 8px ${B[k].color};width:${Math.max(2, (dmg[k] / top) * 100).toFixed(1)}%` })),
      el('div', { class: 'num' }, el('b', null, Math.round((dmg[k] / total) * 100) + '%'), ' ' + Math.round(dmg[k] / Math.max(1, t)) + '/s · ' + (ks[k] || 0) + ' kills'))),
    el('div', { style: 'color:var(--muted);font-size:13px;margin-top:4px' },
      'Total ' + Math.round(total).toLocaleString('en') + ' damage, ' + Math.round(total / Math.max(1, t)) + ' per second, averaged over the whole run.'));
}
