// Enemy species: block genomes compiled with the same rules as the player's vehicle.
import { EB, type Cell, type DType } from '../data';
import type { Rng } from '../core/rng';

export interface SpeciesStats {
  hp: number; mass: number; speed: number; melee: number; gun: number; boom: number;
  lob: number; snipe: number; rocket: number; spray: number;
  res: Partial<Record<DType, number>>; ext: number; cost: number;
}

export interface Species {
  id: number; name: string; cells: Cell[]; pref: number; spd: number; pop: number; born: number;
  st: { n: number; dmg: number; life: number };
  fit?: number;
  /** compiled stats; never serialised (the save writer drops key "c") */
  c: SpeciesStats;
}

export function compileSpecies(sp: Species): SpeciesStats {
  let hp = 0, mass = 0, thrust = 0, melee = 4, gun = 0, boom = 0, ext = 0, lob = 0, snipe = 0, rocket = 0, spray = 0;
  const res: Partial<Record<DType, number>> = {};
  for (const c of sp.cells) {
    const d = EB[c[2]];
    if (!d) continue;
    hp += d.hp; mass += d.mass;
    if (d.thrust) thrust += d.thrust;
    if (d.melee) melee += d.melee;
    if (d.gun) gun += d.gun;
    if (d.boom) boom += d.boom;
    if (d.lob) lob += d.lob;
    if (d.snipe) snipe += d.snipe;
    if (d.rocket) rocket += d.rocket;
    if (d.spray) spray += d.spray;
    if (d.res) for (const t in d.res) { const k = t as DType; res[k] = Math.min(0.7, (res[k] || 0) + (d.res[k] || 0)); }
    ext = Math.max(ext, Math.abs(c[0]), Math.abs(c[1]));
  }
  const speed = (40 + 160 * (1 + thrust) / (2 + mass)) * (sp.spd || 1);
  const cost = 0.6 + hp / 40 + (melee + gun * 1.5 + boom * 0.3 + lob * 1.4 + snipe * 1.5 + rocket * 1.6 + spray * 3 * 1.3) / 15;
  sp.c = { hp, mass, speed, melee, gun, boom, lob, snipe, rocket, spray, res, ext, cost };
  return sp.c;
}

export function makeSpecies(id: number, name: string, cells: Cell[], pref: number, born: number): Species {
  const sp = { id, name, cells, pref, spd: 1, pop: 1, born, st: { n: 0, dmg: 0, life: 0 } } as Species;
  compileSpecies(sp);
  return sp;
}

export function describeSpecies(sp: { cells: Cell[] }): string {
  const n: Record<string, number> = {};
  for (const c of sp.cells) if (c[2] !== 'core') n[c[2]] = (n[c[2]] || 0) + 1;
  const parts = Object.keys(n).map(k => (n[k] > 1 ? n[k] + '× ' : '') + EB[k].label);
  return parts.length ? parts.join(', ') : 'bare core';
}

const SYL = ['ra', 'ko', 'zu', 'vex', 'mor', 'tin', 'gal', 'dra', 'ix', 'sko', 'bur', 'neth', 'ul', 'kri', 'sa', 'vo', 'ter', 'gra'];
const SUFFIX: Record<string, string> = {
  lobber: 'Mortar', sniper: 'Stalker', rocket: 'Roach', spray: 'Hog',
  spike: 'Ripper', plate: 'Hulk', gun: 'Spitter', boomer: 'Popper', thruster: 'Dart',
  fireplate: 'Salamander', insul: 'Warden', reactive: 'Carapace', core: 'Mote',
};
export function nameFor(cells: Cell[], rng: Rng): string {
  const n: Record<string, number> = {};
  for (const c of cells) if (c[2] !== 'core') n[c[2]] = (n[c[2]] || 0) + 1;
  let top = 'core', best = 0;
  for (const k in n) if (n[k] > best) { best = n[k]; top = k; }
  const a = rng.pick(SYL), b = rng.pick(SYL);
  return (a + b).charAt(0).toUpperCase() + (a + b).slice(1) + ' ' + (SUFFIX[top] || 'Mote');
}
