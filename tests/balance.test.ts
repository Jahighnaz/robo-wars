// Per-weapon duel, as in the design doc: two identical weapons in the starter
// build, a kiting bot, 150 s, several seeds. Run with `npm run sim`.
import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { defaultSave } from '../src/persistence/save';
import { playRun } from './bot';

const WEAPONS = ['cannon', 'shotgun', 'laser', 'tesla', 'flamer', 'mortar'];
const SEEDS = [1, 2, 3, 4];

function duel(w: string, wk: string): number {
  let dps = 0;
  for (const seed of SEEDS) {
    const save = defaultSave();
    for (const b of save.build) if (b.t === 'cannon') b.t = w;
    const run = playRun(new Run(save, wk, { seed }), 150);
    const dmg = Object.values(run.dmgBy).reduce((a, b) => a + b, 0);
    dps += dmg / Math.max(1, run.t);
  }
  return dps / SEEDS.length;
}

describe('weapon balance', () => {
  it('reports each weapon against the Autocannon (Rustlands)', () => {
    const res: Record<string, number> = {};
    for (const w of WEAPONS) res[w] = duel(w, 'rust');
    console.table(Object.fromEntries(WEAPONS.map(w => [w, { dps: +res[w].toFixed(1), vsCannon: Math.round((res[w] / res.cannon) * 100) + '%' }])));
    // Report only: numbers are the prototype's tuned values and are not retuned
    // here. Outside the band means a balance pass is due (design doc rule 11).
    const out = WEAPONS.filter(w => res[w] / res.cannon < 0.6 || res[w] / res.cannon > 1.6);
    if (out.length) console.warn('Outside 60–160% of the Autocannon:', out.join(', '));
    expect(res.cannon).toBeGreaterThan(5);
  }, 300_000);
});
