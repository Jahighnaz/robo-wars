import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { defaultSave } from '../src/persistence/save';
import { playRun } from './bot';

describe('headless run', () => {
  it('plays a full Rustlands run deterministically with a seed', () => {
    const a = playRun(new Run(defaultSave(), 'rust', { seed: 1 }));
    const b = playRun(new Run(defaultSave(), 'rust', { seed: 1 }));
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

describe('co-op run', () => {
  const crew = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ pid: 'p' + (i + 2), name: 'Mate ' + (i + 2), build: defaultSave().build, up: {}, gridR: 2 }));

  it('more trucks bring more enemies and every truck gets cards', () => {
    const solo = new Run(defaultSave(), 'rust', { seed: 9 });
    const duo = new Run(defaultSave(), 'rust', { seed: 9, crew: crew(2) });
    expect(duo.coop).toBe(true);
    expect(duo.maxEnemies).toBeGreaterThan(solo.maxEnemies);
    let spawnedSolo = 0, spawnedDuo = 0;
    for (let i = 0; i < 60 * 40; i++) { solo.update(1 / 60); duo.update(1 / 60); }
    spawnedSolo = solo.W.species.reduce((a, s) => a + s.st.n, 0);
    spawnedDuo = duo.W.species.reduce((a, s) => a + s.st.n, 0);
    expect(spawnedDuo).toBeGreaterThan(spawnedSolo * 1.4);
    expect(duo.pendingLevels).toBe(0); // co-op never pauses for cards
    expect(duo.players.every(p => p.pendingCards === duo.level - 1)).toBe(true);
  });

  it('a wrecked truck respawns; the run only ends when the whole crew is down', () => {
    const run = new Run(defaultSave(), 'rust', { seed: 4, crew: crew(2) });
    const mate = run.players[1];
    run.hitPlayer(mate.V.list.find(b => b.t === 'cab')!, 1e6, null, mate);
    expect(mate.alive).toBe(false);
    expect(run.over).toBe(false);
    for (let i = 0; i < 60 * 11; i++) run.update(1 / 60);
    expect(mate.alive).toBe(true);
    run.hitPlayer(run.players[0].V.list.find(b => b.t === 'cab')!, 1e6, null, run.players[0]);
    run.hitPlayer(mate.V.list.find(b => b.t === 'cab')!, 1e6, null, mate);
    expect(run.over).toBe(true);
    expect(Object.keys(run.results)).toEqual(['me', 'p2']);
  });

  it('co-op block cards bolt on without pausing', () => {
    const run = new Run(defaultSave(), 'rust', { seed: 5, crew: crew(2) });
    const p = run.players[1], n = p.V.list.length;
    run.applyCard({ kind: 'block', key: 'bcannon', t: 'cannon', label: '', title: '', desc: '' }, p);
    expect(p.V.list.length).toBe(n + 1);
  });
});
