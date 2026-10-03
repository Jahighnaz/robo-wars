import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { cellConnected, counterWeights, crossover, evolveWorld, mutate } from '../src/evolution/evolution';
import { defaultSave } from '../src/persistence/save';
import type { Cell } from '../src/data';

describe('evolution', () => {
  it('drops cells that are not connected to the core', () => {
    const cells: Cell[] = [[0, 0, 'core'], [0, 1, 'plate'], [2, 2, 'spike']];
    expect(cellConnected(cells)).toHaveLength(2);
  });

  it('mutations and crossover keep genomes connected and bounded', () => {
    const rng = new Rng(9);
    const s = defaultSave();
    const sp = s.worlds.rust.species;
    for (let i = 0; i < 500; i++) {
      const cells = mutate(crossover(rng.pick(sp), rng.pick(sp), rng), counterWeights('rust', { kinetic: 10 }), rng);
      expect(cells.length).toBeLessThanOrEqual(8);
      expect(cellConnected(cells)).toHaveLength(cells.length);
      expect(cells.some(c => c[2] === 'core' && c[0] === 0 && c[1] === 0)).toBe(true);
    }
  });

  it('counter weights favour plating against the dominant damage type', () => {
    const w = counterWeights('rust', { fire: 30 });
    expect(w.fireplate).toBeGreaterThan(w.reactive);
  });

  it('skips the GA below 12 spawns but still adapts resistance', () => {
    const s = defaultSave();
    const out = evolveWorld(s, 'rust', { kinetic: 20 }, new Rng(1));
    expect(out.evolved).toBe(false);
    expect(s.worlds.rust.res.kinetic).toBeCloseTo(0.05);
    expect(s.worlds.rust.gen).toBe(0);
  });

  it('breeds, culls and is reproducible with a seed', () => {
    const run = (seed: number) => {
      const s = defaultSave();
      s.worlds.rust.species.forEach((sp, i) => { sp.st = { n: 10, dmg: i * 20, life: 30 }; });
      evolveWorld(s, 'rust', { kinetic: 10, electric: 10 }, new Rng(seed));
      return s.worlds.rust;
    };
    const a = run(5), b = run(5);
    expect(a.gen).toBe(1);
    expect(a.species.length).toBeGreaterThanOrEqual(4);
    expect(a.species.length).toBeLessThanOrEqual(10);
    expect(a.species.map(s => s.name)).toEqual(b.species.map(s => s.name));
    expect(a.species.some(s => s.name === 'Skitter Ripper')).toBe(false); // lowest fitness went extinct
  });
});
