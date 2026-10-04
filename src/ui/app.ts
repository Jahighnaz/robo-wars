// Robo Wars app: hub with the robot picker, battles against bots or the crew,
// the live HUD (program cards, upgrades, shop) and the results screen.
import { $, el } from './dom';
import { setMuted, uiSnd, unlockAudio } from '../audio/audio';
import { sfx } from '../audio/sfx';
import { music, type Mood } from '../audio/music';
import { timeSeed } from '../core/rng';
import { fmtTime } from '../core/math';
import { persist } from '../persistence/storage';
import type { Difficulty, Save } from '../persistence/save';
import { Arena3D } from '../render/three/arena3d';
import { Bots, type BotBrain } from '../robo/bot';
import { CARD_IDS, CHASSIS_IDS, R, TEAM_COLORS, type CardId } from '../robo/data';
import { Match, type MatchEvent, type PlayerSpec, type Robot } from '../robo/match';
import { cleanCode, Crew, newCrewCode, type CrewMsg } from '../net/crew';
import { applySnapshot, SNAP_HZ, snapshot, type Action, type LobbySeat, type PublicProfile } from '../net/robonet';

const BRAINS: Record<Difficulty, BotBrain> = {
  easy: { think: 1.1, skill: 0.45 },
  normal: { think: 0.7, skill: 0.7 },
  hard: { think: 0.42, skill: 0.92 },
};
const BOT_NAMES = ['Sprocket', 'Torque', 'Rusty', 'Gizmo', 'Widget', 'Bolt', 'Ratchet', 'Clamp', 'Dynamo', 'Flux', 'Servo', 'Piston'];
const CARD_ICON: Record<CardId, string> = { move1: '▲', move2: '▲▲', move3: '▲▲▲', back: '▼', left: '↺', right: '↻', uturn: '⟲' };
const KEYS: Record<string, CardId> = { w: 'move1', arrowup: 'move1', '1': 'move1', '2': 'move2', '3': 'move3', s: 'back', arrowdown: 'back', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', x: 'uturn', u: 'uturn' };

type Role = 'solo' | 'host' | 'client';

export class App {
  private ui = $('ui');
  private hud = $('hud');
  private arena: Arena3D;
  private crew: Crew;
  private match: Match | null = null;
  private bots: Bots | null = null;
  private role: Role | null = null;
  private localId = -1;
  private paused = false;
  private acc = 0;
  private last = performance.now();
  private snapAcc = 0;
  private snapEv: MatchEvent[] = [];
  private targeting: string | null = null;
  private shopOpen = false;
  private ended = false;
  private screen = '';
  /** host side: open arena lobby */
  private lobby: { seats: LobbySeat[] } | null = null;
  /** member side: the host's lobby as last announced */
  private remoteLobby: Extract<CrewMsg, { k: 'rw_lobby' }> | null = null;
  private toastT = 0;
  private hudEls: { cards: Map<CardId, HTMLButtonElement>; actives: HTMLElement; passives: HTMLElement; board: HTMLElement; clock: HTMLElement; reg: HTMLElement; regbar: HTMLElement; hull: HTMLElement; energy: HTMLElement; shopBtn: HTMLButtonElement; shop: HTMLElement; status: HTMLElement } | null = null;
  private hudSig = '';

  constructor(private save: Save) {
    this.arena = new Arena3D($('cv') as HTMLCanvasElement, $('ov') as HTMLCanvasElement);
    this.crew = new Crew(() => this.publicProfile(), m => this.onCrew(m), () => this.onCrewChange());
    setMuted(!save.settings.sound);
    const resize = () => this.arena.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', resize);
    resize();
    document.addEventListener('pointerdown', () => { unlockAudio(); music.setEnabled(this.save.settings.music); }, { capture: true });
    ($('cv') as HTMLCanvasElement).addEventListener('pointerdown', e => this.onBoardTap(e));
    window.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.role === 'solo' && this.match && !this.match.over) this.pause(true); });
    this.showHub();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private store() { persist(this.save); }
  private publicProfile(): PublicProfile {
    const s = this.save;
    return { id: s.pilot.id, name: s.pilot.name, chassis: s.pilot.chassis, wins: s.rec.wins, matches: s.rec.matches };
  }

  toast(text: string, ms = 2200) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('on'), ms);
  }

  private show(cls: 'solid' | 'dim' | 'hidden', node?: Node) {
    this.ui.className = cls;
    this.ui.replaceChildren(...(node ? [node] : []));
    this.ui.scrollTop = 0;
  }

  // ================================================================ hub
  showHub() {
    this.screen = 'hub';
    this.endMatchView();
    music.setMood('menu');
    const s = this.save;
    const nameIn = el('input', { class: 'namein', value: s.pilot.name, maxlength: '20', 'aria-label': 'Pilot name', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) { s.pilot.name = v.slice(0, 20); this.store(); this.crew.send({ k: 'profile', p: this.publicProfile() }); } } });
    const picker = el('div', { class: 'robots' }, CHASSIS_IDS.map(id => {
      const ch = R.chassis[id];
      return el('button', { class: 'robot-card' + (id === s.pilot.chassis ? ' on' : ''), style: `--acc:${ch.color}`, onclick: () => { s.pilot.chassis = id; this.store(); uiSnd(640); this.crew.send({ k: 'profile', p: this.publicProfile() }); this.showHub(); } },
        el('div', { class: 'robot-art m-' + ch.move }, el('img', { src: `robots/${id === 'picks' ? 'picks' : id}.png`, alt: ch.name, draggable: 'false' })),
        el('div', { class: 'rname' }, ch.name),
        el('div', { class: 'rmove' }, { walk: 'Walker', treads: 'Tank treads', wheels: 'Big wheels', slide: 'Saw skirt', crawl: 'Crawler' }[ch.move]),
        el('div', { class: 'rperk' }, ch.perk),
        el('div', { class: 'rhull' }, Array.from({ length: ch.hp }, () => el('i'))));
    }));
    const diff = (d: Difficulty, label: string) => el('button', { class: 'seg' + (s.settings.difficulty === d ? ' on' : ''), onclick: () => { s.settings.difficulty = d; this.store(); uiSnd(); this.showHub(); } }, label);
    const rec = s.rec;
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'hub-head' },
        el('div', null,
          el('div', { class: 'kicker' }, 'Robo Rally · live'),
          el('h1', { class: 'logo', 'data-text': 'ROBO//WARS' }, 'ROBO', el('span', { class: 'slash' }, '//'), el('span', { class: 'evo' }, 'WARS')),
          el('div', { class: 'stat', style: 'display:inline-block;margin-top:14px' }, 'MATCHES ', el('b', null, String(rec.matches)), ' · WINS ', el('b', null, String(rec.wins)), ' · KILLS ', el('b', null, String(rec.kills)))),
        el('div', { class: 'pilot' }, el('div', { class: 'kicker' }, 'Pilot'), nameIn)),
      el('p', { class: 'sub' }, 'Play program cards whenever they are cool, dodge pits and conveyor belts, and line up your laser: it fires every register. Energy buys upgrades from the Robo Rally deck, and the heavy hitters take longest to recharge.'),
      el('h2', null, 'Pick your robot'),
      picker,
      el('div', { class: 'modes' },
        el('div', { class: 'panel mode' },
          el('h3', null, 'Battle bots'),
          el('p', { class: 'sub' }, 'You against bot pilots on a fresh factory floor.'),
          el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Bots'),
            el('button', { class: 'btn sm ghost', onclick: () => { s.settings.bots = Math.max(1, s.settings.bots - 1); this.store(); this.showHub(); } }, '−'),
            el('b', { class: 'count' }, String(s.settings.bots)),
            el('button', { class: 'btn sm ghost', onclick: () => { s.settings.bots = Math.min(5, s.settings.bots + 1); this.store(); this.showHub(); } }, '+')),
          el('div', { class: 'row', style: 'margin-top:10px' }, el('span', { class: 'lbl' }, 'Skill'), diff('easy', 'Easy'), diff('normal', 'Normal'), diff('hard', 'Hard')),
          el('button', { class: 'btn primary big', style: 'margin-top:16px', onclick: () => this.startSolo() }, 'Fight ▸')),
        this.crewPanel()),
      el('div', { class: 'nav' },
        el('button', { class: 'btn ghost', onclick: () => this.showHelp() }, 'How to play'),
        el('button', { class: 'btn ghost', onclick: () => this.showSettings() }, 'Settings'))));
  }

  // ---------------------------------------------------------------- crew panel
  private crewPanel(): HTMLElement {
    const c = this.crew, s = this.save;
    const codeIn = el('input', { class: 'codein', value: s.crewCode || '', maxlength: '6', placeholder: 'CODE', 'aria-label': 'Crew code', autocapitalize: 'characters' });
    let body: HTMLElement;
    if (c.status === 'off' || c.status === 'error') {
      body = el('div', null,
        c.status === 'error' ? el('p', { class: 'err' }, c.error) : el('p', { class: 'sub' }, 'Same Wi-Fi: one device hosts a crew, the others join with its code. Then the host opens the arena and everyone fights live. Empty seats get bots.'),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => { const code = s.crewCode || newCrewCode(); s.crewCode = code; this.store(); void c.host(code); } }, 'Host a crew'),
          codeIn,
          el('button', { class: 'btn', onclick: () => { const code = cleanCode(codeIn.value); if (code.length < 4) { this.toast('Enter the 4-letter crew code'); return; } s.crewCode = code; this.store(); void c.join(code); } }, 'Join')));
    } else if (c.status === 'connecting') {
      body = el('p', { class: 'sub' }, 'Connecting to crew ' + c.code + '…');
    } else {
      const members = [...c.members.values()].filter(m => c.online.has(m.id));
      const L = this.lobby, RL = this.remoteLobby;
      const seated = c.isHost ? !!L : !!RL?.open && RL.seats.some(x => x.pid === s.pilot.id);
      body = el('div', null,
        el('div', { class: 'row' }, el('span', { class: 'badge' }, 'CREW ' + c.code), el('span', { class: 'sub', style: 'margin:0' }, members.length + ' online'), el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm ghost', onclick: () => { this.closeLobby(); c.leave(); } }, 'Leave')),
        el('div', { class: 'members' }, members.map(m => el('span', { class: 'member', style: `--acc:${R.chassis[m.chassis]?.color ?? '#fff'}` }, el('img', { src: `robots/${m.chassis}.png`, alt: '' }), m.name, m.id === c.hostId ? ' ★' : ''))),
        c.isHost
          ? (L ? el('div', null,
            el('p', { class: 'sub' }, 'Arena open. Seats: ' + [s.pilot.name, ...L.seats.map(x => x.name)].join(', ') + ' · plus ' + this.crewBots(1 + L.seats.length) + ' bots (set the count under Battle bots).'),
            el('div', { class: 'row' },
              el('button', { class: 'btn primary', onclick: () => this.startHost() }, 'Start the battle ▸'),
              el('button', { class: 'btn ghost sm', onclick: () => this.closeLobby() }, 'Close arena')))
            : el('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => this.openLobby() }, 'Open the arena'))
          : RL?.open
            ? el('div', null,
              el('p', { class: 'sub' }, RL.host + ' has the arena open: ' + [RL.host, ...RL.seats.map(x => x.name)].join(', ') + '.'),
              seated ? el('button', { class: 'btn ghost', onclick: () => c.send({ k: 'rw_leave', pid: s.pilot.id }) }, 'Leave seat · waiting for the host')
                : el('button', { class: 'btn primary', onclick: () => c.send({ k: 'rw_join', seat: { pid: s.pilot.id, name: s.pilot.name, chassis: s.pilot.chassis } }) }, 'Take a seat ▸'))
            : el('p', { class: 'sub' }, 'Waiting for the host to open the arena.'));
    }
    return el('div', { class: 'panel mode' }, el('h3', null, 'Crew battle'), body);
  }

  /** bots that join a crew battle: the Battle bots count, up to six robots, at least one opponent */
  private crewBots(humans: number): number { return Math.max(humans < 2 ? 1 : 0, Math.min(this.save.settings.bots, 6 - humans)); }

  private onCrewChange() {
    if (this.screen === 'hub') this.showHub();
  }

  private openLobby() {
    this.lobby = { seats: [] };
    this.broadcastLobby();
    uiSnd(660);
    this.showHub();
  }
  private closeLobby() {
    if (!this.lobby) return;
    this.lobby = null;
    this.broadcastLobby();
    if (this.screen === 'hub') this.showHub();
  }
  private broadcastLobby() {
    const s = this.save;
    this.crew.send({ k: 'rw_lobby', open: !!this.lobby, host: s.pilot.name, hostPid: s.pilot.id, seats: this.lobby?.seats ?? [], bots: this.save.settings.bots });
  }

  private onCrew(m: CrewMsg) {
    const s = this.save;
    switch (m.k) {
      case 'rw_lobby': this.remoteLobby = m; if (this.screen === 'hub') this.showHub(); break;
      case 'rw_join': {
        if (!this.lobby || this.lobby.seats.some(x => x.pid === m.seat.pid) || this.lobby.seats.length >= 5) break;
        this.lobby.seats.push(m.seat);
        this.broadcastLobby();
        if (this.screen === 'hub') this.showHub();
        break;
      }
      case 'rw_leave': {
        if (!this.lobby) break;
        this.lobby.seats = this.lobby.seats.filter(x => x.pid !== m.pid);
        this.broadcastLobby();
        if (this.screen === 'hub') this.showHub();
        break;
      }
      case 'rw_start': {
        const idx = m.players.findIndex(p => p.pid === s.pilot.id);
        if (idx < 0) break;
        this.remoteLobby = null;
        this.match = new Match(m.seed, m.players);
        this.bots = null;
        this.role = 'client';
        this.localId = idx;
        this.beginMatch();
        break;
      }
      case 'rw_in': {
        if (this.role !== 'host' || !this.match) break;
        const rb = this.match.robots.find(r => r.pid === m.pid);
        if (rb) this.apply(rb.id, m.act);
        break;
      }
      case 'rw_snap': {
        if (this.role !== 'client' || !this.match) break;
        const evs = applySnapshot(this.match, m.s);
        this.handleEvents(evs);
        break;
      }
      case 'rw_end': if (this.role === 'client' && this.match && !this.ended) { this.toast('The host left the battle.'); this.leaveMatch(); } break;
      default: break;
    }
  }

  // ================================================================ start a match
  private botSpecs(n: number, taken: Set<string>, usedChassis: string[]): PlayerSpec[] {
    const names = BOT_NAMES.filter(x => !taken.has(x)).sort(() => Math.random() - 0.5);
    // bots take the chassis nobody picked first, so a battle shows off different robots
    const used = new Set(usedChassis);
    const pool = [...CHASSIS_IDS.filter(c => !used.has(c)).sort(() => Math.random() - 0.5), ...[...CHASSIS_IDS].sort(() => Math.random() - 0.5)];
    return Array.from({ length: n }, (_, i) => ({ pid: 'bot' + i + '-' + Math.random().toString(36).slice(2, 6), name: names[i % names.length], chassis: pool[i % pool.length], bot: true }));
  }

  private me(): PlayerSpec { const p = this.save.pilot; return { pid: p.id, name: p.name, chassis: p.chassis }; }

  startSolo() {
    unlockAudio();
    const players = [this.me(), ...this.botSpecs(this.save.settings.bots, new Set([this.save.pilot.name]), [this.save.pilot.chassis])];
    players.forEach((p, i) => { p.color = TEAM_COLORS[i]; });
    this.match = new Match(timeSeed(), players);
    this.bots = new Bots(this.match, BRAINS[this.save.settings.difficulty]);
    this.role = 'solo';
    this.localId = 0;
    this.beginMatch();
  }

  private startHost() {
    const L = this.lobby;
    if (!L) return;
    const seats = L.seats.filter(x => this.crew.online.has(x.pid)).slice(0, 5);
    const humans: PlayerSpec[] = [this.me(), ...seats.map(x => ({ pid: x.pid, name: x.name, chassis: x.chassis }))];
    const botN = this.crewBots(humans.length);
    const players = [...humans, ...this.botSpecs(botN, new Set(humans.map(h => h.name)), humans.map(h => h.chassis))];
    players.forEach((p, i) => { p.color = TEAM_COLORS[i]; });
    const seed = timeSeed();
    this.match = new Match(seed, players);
    this.bots = new Bots(this.match, BRAINS[this.save.settings.difficulty]);
    this.role = 'host';
    this.localId = 0;
    this.lobby = null;
    this.crew.send({ k: 'rw_start', seed, players });
    this.beginMatch();
  }

  private beginMatch() {
    const m = this.match!;
    unlockAudio();
    this.screen = 'match';
    this.ended = false;
    this.paused = false;
    this.targeting = null;
    this.shopOpen = false;
    this.acc = 0; this.snapAcc = 0; this.snapEv = [];
    this.arena.localId = this.localId;
    this.arena.setBoard(m);
    m.drain();
    this.show('hidden');
    this.buildHud();
    music.setMood('run');
    const me = m.robots[this.localId];
    this.toast(`${R.chassis[me.chassis].name} online · lasers fire every ${R.match.tick}s`, 2600);
  }

  // ================================================================ actions
  private act(a: Action) {
    if (!this.match || this.match.over || this.paused) return;
    if (this.role === 'client') { this.crew.send({ k: 'rw_in', pid: this.save.pilot.id, act: a }); return; }
    this.apply(this.localId, a);
  }

  private apply(id: number, a: Action) {
    const m = this.match!;
    if (a.a === 'card' && CARD_IDS.includes(a.x)) m.play(id, a.x);
    else if (a.a === 'buy') m.buy(id, a.x);
    else if (a.a === 'use') m.use(id, a.x, a.r !== undefined && a.c !== undefined ? { r: a.r, c: a.c } : undefined);
  }

  private useUpgrade(up: string) {
    if (up === 'tele') {
      if (this.targeting) { this.targeting = null; this.arena.highlight = null; return; }
      const m = this.match!, rb = m.robots[this.localId], range = R.upgrades.tele.range ?? 5;
      const hl = new Set<number>();
      for (const cell of m.board.cells) if (Math.abs(cell.r - rb.r) + Math.abs(cell.c - rb.c) <= range && cell.type !== 'crate' && !(m.board.antenna.r === cell.r && m.board.antenna.c === cell.c)) hl.add(cell.r * m.board.cols + cell.c);
      this.targeting = up;
      this.arena.highlight = hl;
      this.toast('Tap a tile to teleport (tap the button again to cancel)', 1800);
      return;
    }
    this.act({ a: 'use', x: up });
  }

  private onBoardTap(e: PointerEvent) {
    if (!this.targeting || !this.match) return;
    const cell = this.arena.pick(e.clientX, e.clientY);
    const hl = this.arena.highlight;
    if (!cell || !hl || !hl.has(cell.r * this.match.board.cols + cell.c)) return;
    this.act({ a: 'use', x: this.targeting, r: cell.r, c: cell.c });
    this.targeting = null;
    this.arena.highlight = null;
  }

  private onKey(e: KeyboardEvent) {
    if (this.screen !== 'match' || !this.match) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (this.shopOpen) this.toggleShop(); else if (this.role === 'solo') this.pause(!this.paused); return; }
    if (k === 'b') { this.toggleShop(); return; }
    const card = KEYS[k];
    if (card) { e.preventDefault(); this.act({ a: 'card', x: card }); return; }
    const me = this.match.robots[this.localId];
    const slot = ['q', 'e', 'r'].indexOf(k);
    if (slot >= 0 && me.active[slot]) this.useUpgrade(me.active[slot]);
  }

  // ================================================================ frame
  private frame(dt: number) {
    const m = this.match;
    if (m && this.screen === 'match') {
      if (this.role !== 'client' && !this.paused && !m.over) {
        this.acc += dt;
        const step = 1 / 60;
        while (this.acc >= step) {
          this.acc -= step;
          this.bots?.update();
          m.update(step);
          const evs = m.drain();
          if (evs.length) { this.handleEvents(evs); if (this.role === 'host') this.snapEv.push(...evs); }
        }
        if (this.role === 'host') {
          this.snapAcc += dt;
          if (this.snapAcc >= 1 / SNAP_HZ || m.over) {
            this.snapAcc = 0;
            // members who dropped out are taken over by a bot
            for (const rb of m.robots) if (!rb.bot && rb.id !== this.localId && !this.crew.online.has(rb.pid)) rb.bot = true;
            this.crew.send({ k: 'rw_snap', s: snapshot(m, this.snapEv) });
            this.snapEv = [];
          }
        }
      }
      this.arena.render(m, this.paused ? 0 : dt);
      this.updateHud();
      this.updateMusic();
      if (m.over && !this.ended) { this.ended = true; window.setTimeout(() => this.showResults(), 1400); }
    }
  }

  private lastLaserSnd = 0;
  private handleEvents(evs: MatchEvent[]) {
    const m = this.match!;
    this.arena.onEvents(m, evs);
    const now = performance.now();
    for (const e of evs) {
      switch (e.k) {
        case 'beam':
          if (e.kind === 'over') sfx.over();
          else if (e.kind === 'board') sfx.boardLaser();
          else if (now - this.lastLaserSnd > 90) { this.lastLaserSnd = now; sfx.laser(Math.floor(Math.random() * 6)); }
          break;
        case 'rocket': sfx.rocket(); break;
        case 'blast': sfx.boom(e.size > 2); break;
        case 'fall': sfx.fall(); if (e.id === this.localId) this.toast('Down the pit!', 1400); break;
        case 'wreck': sfx.boom(true); break;
        case 'hit': sfx.hit(); break;
        case 'shield': sfx.shield(); break;
        case 'gear': sfx.gear(); break;
        case 'belt': sfx.belt(); break;
        case 'push': sfx.push(); break;
        case 'energy': if (e.id === this.localId) sfx.charge(); break;
        case 'heal': if (e.id === this.localId) sfx.heal(); break;
        case 'emp': sfx.emp(); break;
        case 'tele': sfx.tele(); break;
        case 'buy': if (e.id === this.localId) sfx.buy(); break;
        case 'pick': sfx.pick(); break;
        case 'register': sfx.register(); break;
        case 'move': if (e.id === this.localId && !e.push) sfx.step(); break;
        case 'turn': if (e.id === this.localId) sfx.turn(); break;
        case 'kill': {
          const k = m.robots[e.killer], v = m.robots[e.victim];
          if (k && v) this.toast(e.killer === this.localId ? `You scrapped ${v.name}! +${R.match.killEnergy} ⚡` : e.victim === this.localId ? `${k.name} scrapped you` : `${k.name} scrapped ${v.name}`, 1800);
          break;
        }
        case 'reverse': this.toast(e.on ? 'Reverse gear: belts run backwards!' : 'Belts back to normal', 1500); break;
        default: break;
      }
    }
  }

  private updateMusic() {
    const m = this.match!;
    const left = m.robots.filter(r => !r.out).length;
    const mood: Mood = m.over ? 'menu' : left <= 2 || m.t > R.match.timeLimit - 30 ? 'boss' : 'run';
    music.setMood(mood);
    const me = m.robots[this.localId];
    let near = 0;
    if (me?.alive) for (const o of m.robots) if (o !== me && o.alive && Math.abs(o.r - me.r) + Math.abs(o.c - me.c) <= 4) near++;
    music.setHeat(near >= 3 ? 2 : near >= 1 ? 1 : 0);
  }

  // ================================================================ HUD
  private buildHud() {
    const m = this.match!;
    const cards = new Map<CardId, HTMLButtonElement>();
    const tray = el('div', { class: 'tray' }, CARD_IDS.map(k => {
      const b = el('button', { class: 'pcard', 'aria-label': R.cards[k].name, onpointerdown: (e: Event) => { e.preventDefault(); this.act({ a: 'card', x: k }); } },
        el('span', { class: 'pico' }, CARD_ICON[k]), el('span', { class: 'pname' }, R.cards[k].name), el('span', { class: 'cdv' }));
      cards.set(k, b);
      return b;
    }));
    const board = el('div', { class: 'scores' });
    const clock = el('div', { class: 'clock' }, '0:00');
    const reg = el('div', { class: 'regs' }, [1, 2, 3, 4, 5].map(n => el('i', null, String(n))));
    const regbar = el('div', { class: 'regbar' }, el('b'));
    const hull = el('div', { class: 'hull' });
    const energy = el('div', { class: 'energy' });
    const passives = el('div', { class: 'passives' });
    const actives = el('div', { class: 'actives' });
    const status = el('div', { class: 'mestatus' });
    const shopBtn = el('button', { class: 'btn sm shopbtn', onclick: () => this.toggleShop() }, 'Upgrades');
    const shop = el('div', { class: 'shop off' });
    const menuBtn = el('button', { class: 'iconbtn', 'aria-label': 'Menu', onclick: () => this.role === 'solo' ? this.pause(true) : this.confirmLeave() },
      el('span', { html: '<svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="2" width="4" height="14" fill="currentColor"/><rect x="11" y="2" width="4" height="14" fill="currentColor"/></svg>' }));
    this.hud.replaceChildren(
      el('div', { class: 'top' },
        el('div', { class: 'clockbox' }, clock, el('div', { class: 'reglabel' }, 'REGISTER'), reg, regbar),
        board,
        menuBtn),
      el('div', { class: 'bottom' },
        el('div', { class: 'me' }, status, hull, energy, passives),
        tray,
        el('div', { class: 'side' }, actives, shopBtn)),
      shop);
    this.hud.className = '';
    this.hudEls = { cards, actives, passives, board, clock, reg, regbar, hull, energy, shopBtn, shop, status };
    this.hudSig = '';
    void m;
  }

  private updateHud() {
    const m = this.match, H = this.hudEls;
    if (!m || !H) return;
    const me = m.robots[this.localId];
    H.clock.textContent = fmtTime(Math.max(0, R.match.timeLimit - m.t));
    [...H.reg.children].forEach((x, i) => x.classList.toggle('on', i + 1 === m.register));
    (H.regbar.firstChild as HTMLElement).style.width = (100 * m.tickT / R.match.tick).toFixed(1) + '%';
    H.regbar.classList.toggle('soon', R.match.tick - m.tickT < 0.6);
    for (const [k, b] of H.cards) {
      const cd = me.cds[k], max = R.cards[k].cd * R.chassis[me.chassis].cdMul;
      const ready = me.alive && !me.out && cd <= 0 && me.jamT <= 0;
      b.classList.toggle('ready', ready);
      b.style.setProperty('--cd', String(me.jamT > 0 ? 1 : Math.min(1, cd / max)));
      (b.lastChild as HTMLElement).textContent = me.jamT > 0 ? 'JAM' : cd > 0 ? cd.toFixed(1) : '';
    }
    // things that change rarely: rebuild on a signature change
    const sig = [me.hp, me.lives, me.energy, me.alive, me.out, me.passive.join(), me.active.join(), m.robots.map(r => `${r.kills}/${r.lives}/${r.hp}/${r.alive}`).join(), this.shopOpen].join('|');
    if (sig !== this.hudSig) {
      this.hudSig = sig;
      H.hull.replaceChildren(el('span', { class: 'lbl' }, 'HULL'), el('span', { class: 'pips' }, Array.from({ length: me.maxHp }, (_, i) => el('i', { class: i < me.hp ? (me.hp <= 3 ? 'low' : 'on') : '' }))));
      H.energy.replaceChildren(el('span', { class: 'lbl' }, 'ENERGY'), el('b', null, '⚡ ' + me.energy), el('span', { class: 'lives' }, '♥'.repeat(Math.max(0, me.lives)) + '♡'.repeat(Math.max(0, R.match.lives - me.lives))));
      H.passives.replaceChildren(...me.passive.map(p => el('span', { class: 'chip' }, R.upgrades[p].name)));
      H.status.textContent = me.out ? 'OUT OF LIVES · watching' : !me.alive ? 'REBOOTING…' : R.chassis[me.chassis].name;
      H.actives.replaceChildren(...me.active.map((up, i) => el('button', { class: 'abtn', 'data-up': up, onpointerdown: (e: Event) => { e.preventDefault(); this.useUpgrade(up); } },
        el('span', { class: 'aname' }, R.upgrades[up].name), el('span', { class: 'akey' }, ['Q', 'E', 'R'][i]), el('span', { class: 'acd' }))));
      H.board.replaceChildren(...m.robots.map((r, i) => el('div', { class: 'sc' + (r.out ? ' out' : '') + (i === this.localId ? ' me' : ''), style: `--acc:${r.color}` },
        el('img', { src: `robots/${r.chassis}.png`, alt: '' }),
        el('div', null, el('div', { class: 'scn' }, r.name), el('div', { class: 'scs' }, '♥'.repeat(Math.max(0, r.lives)) + ' · ' + r.kills + ' ✖')))));
      H.shopBtn.textContent = `Upgrades ⚡${me.energy}`;
      H.shopBtn.classList.toggle('afford', Object.keys(R.upgrades).some(u => !m.has(me, u) && R.upgrades[u].cost <= me.energy));
      if (this.shopOpen) this.renderShop();
    }
    for (const b of H.actives.children) {
      const up = (b as HTMLElement).dataset.up!;
      const cd = me.acd[up] ?? 0, max = R.upgrades[up].cd || 1;
      (b as HTMLElement).style.setProperty('--cd', String(Math.min(1, cd / max)));
      b.classList.toggle('ready', cd <= 0 && me.alive);
      b.classList.toggle('aiming', this.targeting === up);
      (b.lastChild as HTMLElement).textContent = cd > 0 ? cd.toFixed(0) + 's' : '';
    }
  }

  private toggleShop() {
    this.shopOpen = !this.shopOpen;
    this.hudEls?.shop.classList.toggle('off', !this.shopOpen);
    if (this.shopOpen) this.renderShop();
    uiSnd(this.shopOpen ? 700 : 500);
  }

  private renderShop() {
    const m = this.match!, me = m.robots[this.localId], H = this.hudEls!;
    const item = (id: string) => {
      const u = R.upgrades[id], owned = m.has(me, id);
      const full = (u.kind === 'passive' ? me.passive.length >= R.slots.passive : me.active.length >= R.slots.active);
      const can = !owned && !full && me.energy >= u.cost && !me.out;
      return el('button', { class: 'upcard' + (owned ? ' owned' : '') + (can ? ' can' : ''), disabled: !can, onclick: () => { this.act({ a: 'buy', x: id }); } },
        el('div', { class: 'uhead' }, el('b', null, u.name), el('span', { class: 'ucost' }, owned ? 'OWNED' : '⚡' + u.cost)),
        el('div', { class: 'ukind' }, u.kind === 'passive' ? 'Permanent' : `Active · ${u.once ? 'one use' : (u.cd ?? 0) + 's cooldown'}`),
        el('div', { class: 'udesc' }, u.desc));
    };
    const ids = Object.keys(R.upgrades);
    H.shop.replaceChildren(
      el('div', { class: 'shophead' }, el('h3', null, 'Upgrades'), el('span', { class: 'sub', style: 'margin:0' }, `⚡ ${me.energy} energy · ${me.passive.length}/${R.slots.passive} permanent · ${me.active.length}/${R.slots.active} active`), el('div', { class: 'spacer' }),
        el('button', { class: 'btn sm ghost', onclick: () => this.toggleShop() }, 'Close')),
      el('div', { class: 'upgrid' }, ids.filter(i => R.upgrades[i].kind === 'passive').map(item), ids.filter(i => R.upgrades[i].kind === 'active').map(item)));
  }

  // ================================================================ pause, leave, results
  private pause(on: boolean) {
    if (this.role !== 'solo' || !this.match) return;
    this.paused = on;
    if (!on) { this.show('hidden'); return; }
    this.show('dim', el('div', { class: 'wrap mid center screen-in', style: 'max-width:640px' },
      el('div', { class: 'kicker' }, 'Factory floor'),
      el('div', { class: 'lvl-title' }, 'PAUSED'),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:20px' },
        el('button', { class: 'btn primary big', onclick: () => this.pause(false) }, 'Resume'),
        el('button', { class: 'btn danger', onclick: () => this.leaveMatch() }, 'Quit battle')),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        el('button', { class: 'btn sm ghost', onclick: () => { this.save.settings.sound = !this.save.settings.sound; setMuted(!this.save.settings.sound); this.store(); this.pause(true); } }, 'Sound: ' + (this.save.settings.sound ? 'on' : 'off')),
        el('button', { class: 'btn sm ghost', onclick: () => { this.save.settings.music = !this.save.settings.music; music.setEnabled(this.save.settings.music); this.store(); this.pause(true); } }, 'Music: ' + (this.save.settings.music ? 'on' : 'off')))));
  }

  private confirmLeave() {
    this.show('dim', el('div', { class: 'wrap mid center screen-in', style: 'max-width:640px' },
      el('div', { class: 'lvl-title' }, 'LEAVE?'),
      el('p', { class: 'sub', style: 'margin:12px auto' }, this.role === 'host' ? 'You are hosting: leaving ends the battle for everyone.' : 'The battle goes on without you; a bot takes your robot.'),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn primary', onclick: () => this.show('hidden') }, 'Keep fighting'),
        el('button', { class: 'btn danger', onclick: () => this.leaveMatch() }, 'Leave'))));
  }

  private leaveMatch() {
    if (this.role === 'host') this.crew.send({ k: 'rw_end' });
    if (this.role === 'client') this.crew.send({ k: 'rw_leave', pid: this.save.pilot.id });
    this.match = null;
    this.showHub();
  }

  private endMatchView() {
    this.hud.className = 'off';
    this.hudEls = null;
    this.arena.highlight = null;
    this.targeting = null;
  }

  private showResults() {
    const m = this.match;
    if (!m) return;
    this.screen = 'results';
    const me = m.robots[this.localId];
    const order = m.standings();
    const won = order[0] === me;
    const rec = this.save.rec;
    rec.matches++; rec.kills += me.kills; rec.deaths += me.deaths;
    if (won) { rec.wins++; rec.byChassis[me.chassis] = (rec.byChassis[me.chassis] || 0) + 1; }
    rec.bestStreak = Math.max(rec.bestStreak, me.kills);
    this.store();
    this.crew.send({ k: 'profile', p: this.publicProfile() });
    this.endMatchView();
    music.setMood('menu');
    this.show('dim', el('div', { class: 'wrap screen-in', style: 'max-width:820px' },
      el('div', { class: 'center' },
        el('div', { class: 'kicker' }, won ? 'Last robot rolling' : 'Battle over'),
        el('div', { class: 'lvl-title', style: `color:${won ? 'var(--acid)' : 'var(--mag)'}` }, won ? 'VICTORY' : order[0].name.toUpperCase() + ' WINS')),
      el('div', { class: 'panel', style: 'margin-top:18px' },
        el('table', { class: 'standings' },
          el('tr', null, el('th', null, '#'), el('th', null, 'Robot'), el('th', null, 'Kills'), el('th', null, 'Deaths'), el('th', null, 'Damage'), el('th', null, 'Lives')),
          order.map((r, i) => el('tr', { class: r === me ? 'me' : '', style: `--acc:${r.color}` },
            el('td', null, String(i + 1)),
            el('td', null, el('span', { class: 'who' }, el('img', { src: `robots/${r.chassis}.png`, alt: '' }), r.name, r.bot ? el('small', null, ' bot') : null)),
            el('td', null, String(r.kills)), el('td', null, String(r.deaths)), el('td', null, String(r.dmg)), el('td', null, String(Math.max(0, r.lives))))))),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:20px' },
        this.role === 'solo' ? el('button', { class: 'btn primary big', onclick: () => this.startSolo() }, 'Rematch ▸') : null,
        el('button', { class: 'btn', onclick: () => { this.match = null; this.showHub(); } }, 'Back to the hub'))));
  }

  // ================================================================ help, settings
  private showHelp() {
    this.screen = 'help';
    const step = (n: string, t: string, d: string, acc: string) => el('div', { class: 'panel step', style: `--acc:${acc}` }, el('div', { class: 'num' }, n), el('h3', null, t), el('p', null, d));
    this.show('solid', el('div', { class: 'wrap screen-in' },
      el('div', { class: 'kicker' }, 'Field manual'),
      el('h1', null, 'How to play'),
      el('div', { class: 'steps', style: 'margin-top:18px' },
        step('1', 'Program cards, live', 'Move 1/2/3, Back up, Turn left/right and U-turn. Play any card that is cool; bigger moves cool down longer. Keys: W/↑, 2, 3, S/↓, A/←, D/→, X.', 'var(--cyan)'),
        step('2', 'The factory runs in registers', `Every ${R.match.tick} s: blue belts move 2, green belts 1, push panels shove (on the registers printed on them), gears turn you, board lasers fire, then every robot fires its laser forward. Energy cubes and repair wrenches pay out.`, 'var(--acid)'),
        step('3', 'Watch your step', 'Pits and the edge of the floor cost a life. Walls and crates stop movement and lasers. You can push other robots, into pits too.', 'var(--red)'),
        step('4', 'Upgrades', 'Energy buys cards from the Robo Rally deck: Rear Laser, Double Barrel, Rail Gun, Deflector Shield, Mirror Plating, Hover, and actives (Q/E/R): Rocket, EMP, Teleport, Overload, Kamikaze, Reverse Gear. The heavier the weapon, the longer its cooldown.', 'var(--mag)'),
        step('5', 'Win', `${R.match.lives} lives each. Last robot standing wins, or the most kills when the ${fmtTime(R.match.timeLimit)} clock runs out. A kill pays ${R.match.killEnergy} energy.`, 'var(--green)')),
      el('div', { class: 'row', style: 'margin-top:20px' }, el('button', { class: 'btn', onclick: () => this.showHub() }, '◂ Back'))));
  }

  private showSettings() {
    this.screen = 'settings';
    const s = this.save.settings;
    const toggle = (label: string, desc: string, on: boolean, flip: () => void) =>
      el('button', { class: 'toggle', onclick: () => { flip(); this.store(); uiSnd(); this.showSettings(); } },
        el('div', { class: 'tl' }, label, el('div', null, desc)), el('span', { class: 'switch' + (on ? ' on' : '') }));
    this.show('solid', el('div', { class: 'wrap screen-in', style: 'max-width:760px' },
      el('div', { class: 'kicker' }, 'System'),
      el('h1', null, 'Settings'),
      el('div', { class: 'panel', style: 'margin-top:18px;padding-top:4px;padding-bottom:4px' },
        toggle('Sound', 'Lasers, belts, gears and booms.', s.sound, () => { s.sound = !s.sound; setMuted(!s.sound); }),
        toggle('Music', '"Shop Floor Fever": 8-bit arcade techno.', s.music, () => { s.music = !s.music; music.setEnabled(s.music); }),
        toggle('Neon glow', 'Bloom on the neon edges. Turn off if the game stutters.', this.arena.bloomOn, () => { this.arena.bloomOn = !this.arena.bloomOn; })),
      el('div', { class: 'row', style: 'margin-top:20px' }, el('button', { class: 'btn', onclick: () => this.showHub() }, '◂ Back'))));
  }
}

export type { Robot };
