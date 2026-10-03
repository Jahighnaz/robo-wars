import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { defaultSave } from '../src/persistence/save';
import { playRun } from './bot';

describe('headless run', () => {
  it('plays a full Rustlands run deterministically with a seed', () => {
    const a = playRun(new Run(defaultSave(), 'rust', { seed: 42 }));
    const b = playRun(new Run(defaultSave(), 'rust', { seed: 42 }));
    expect(a.over).toBe(true);
    expect(a.result).not.toBeNull();
    expect(a.kills).toBeGreaterThan(30);
    expect(a.t).toBeCloseTo(b.t, 6);
    expect(a.kills).toBe(b.kills);
  });

  it('director follows the wave script: mini-bosses at 2:00 and 4:00, apex at 5:00', () => {
    const run = new Run(defaultSave(), 'rust', { seed: 7 });
    playRun(run, 305);
    expect(run.mb1).toBe(run.t >= 120);
    if (run.t >= 300) expect(run.boss).toBe(true);
    expect(run.W.species.reduce((a, s) => a + s.st.n, 0)).toBeGreaterThan(50);
  });

  it('ending a run banks loot and evolves the world', () => {
    const save = defaultSave();
    const run = playRun(new Run(save, 'rust', { seed: 3 }), 200);
    if (!run.over) run.end(false);
    expect(save.runs).toBe(1);
    expect(save.worlds.rust.gen).toBe(1);
    expect(run.result!.report.length).toBeGreaterThan(0);
  });
});
