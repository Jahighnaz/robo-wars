import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { defaultSave } from '../src/persistence/save';
import { accumulate, addChallengeEntry, challengeScore, ensureProfile, exportCard, importCard, publicProfile, type Challenge } from '../src/meta/profile';
import { applyRun, standings } from '../src/meta/records';
import { evaluate, TROPHIES } from '../src/meta/trophies';
import { playRun } from './bot';

describe('records and trophies', () => {
  const save = defaultSave();
  const p = save.profile!;
  const run = playRun(new Run(save, 'rust', { seed: 11 }), 200);
  if (!run.over) run.end(false);
  const r = run.result!;

  it('tracks run stats', () => {
    expect(r.stats.dist).toBeGreaterThan(100);
    expect(r.stats.spins).toBeGreaterThan(0);
    expect(r.loot).toBeGreaterThanOrEqual(0);
  });

  it('updates lifetime counters and personal bests', () => {
    accumulate(p, r);
    const improved = applyRun(p, r, false);
    expect(p.life.runs).toBe(1);
    expect(p.best.longest_shift).toBeCloseTo(r.t);
    expect(p.best.shifts).toBe(1);
    expect(improved.map(d => d.id)).toContain('most_kills');
    expect(p.best.league).toBeUndefined(); // only challenge runs count for the league
  });

  it('unlocks trophies once', () => {
    const now = new Date(2026, 9, 7, 12); // a Wednesday noon: no date eggs
    const got = evaluate({ save, p, r, now });
    expect(got.map(t => t.id)).toContain('clocked_in');
    expect(evaluate({ save, p, r, now }).map(t => t.id)).not.toContain('clocked_in');
    expect(evaluate({ save, p, event: 'abandon', now }).map(t => t.id)).toEqual(['rage_quit']);
  });

  it('has unique trophy ids and one platinum', () => {
    expect(new Set(TROPHIES.map(t => t.id)).size).toBe(TROPHIES.length);
    expect(TROPHIES.filter(t => t.tier === 'platinum')).toHaveLength(1);
  });

  it('crew board picks the best holder per record', () => {
    const me = publicProfile(p);
    const mate = { ...me, id: 'mate', name: 'Dave', best: { ...me.best, most_kills: me.best.most_kills + 5, speedrun_hr: 999 } };
    const st = standings(me, [mate]);
    expect(st.find(s => s.def.id === 'most_kills')!.holder!.name).toBe('Dave');
    const hr = st.find(s => s.def.id === 'speedrun_hr')!;
    expect(hr.holder!.name).toBe(me.name); // lower is better
  });

  it('record cards round-trip and challenge entries keep each player best', () => {
    const card = importCard(exportCard(p));
    expect(card.name).toBe(p.name);
    expect(() => importCard('nope')).toThrow();
    const c: Challenge = { id: 'c1', wk: 'rust', seed: 1, by: 'x', byName: 'x', at: 0, entries: [] };
    addChallengeEntry(c, { pid: 'a', name: 'A', score: 100, t: 1, kills: 1, won: false, at: 0 });
    addChallengeEntry(c, { pid: 'a', name: 'A', score: 50, t: 1, kills: 1, won: false, at: 0 });
    addChallengeEntry(c, { pid: 'b', name: 'B', score: 300, t: 1, kills: 1, won: false, at: 0 });
    expect(c.entries.map(e => e.score)).toEqual([300, 100]);
    expect(challengeScore(r)).toBeGreaterThan(0);
  });

  it('exhibition runs bank nothing and leave the sector alone', () => {
    const s2 = defaultSave();
    const before = JSON.stringify(s2.worlds.rust.species.map(x => x.name));
    const ex = playRun(new Run(s2, 'rust', { seed: 5, exhibition: true }), 150);
    if (!ex.over) ex.end(false);
    expect(s2.runs).toBe(0);
    expect(s2.res.scrap).toBe(60);
    expect(JSON.stringify(s2.worlds.rust.species.map(x => x.name))).toBe(before);
  });
});

describe('captain choice', () => {
  it('defaults to Charles and drops unknown captains', () => {
    expect(ensureProfile(undefined).avatar).toBe('charles');
    expect(ensureProfile({ name: 'X', avatar: 'hannes' }).avatar).toBe('hannes');
    expect(ensureProfile({ name: 'X', avatar: 'darth' }).avatar).toBe('charles');
  });
});
