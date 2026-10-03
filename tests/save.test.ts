import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultSave, exportCode, importCode } from '../src/persistence/save';

describe('save codes', () => {
  it('imports a save code exported by the prototype (v0.2)', () => {
    const code = readFileSync(new URL('./fixtures/prototype-save.txt', import.meta.url), 'utf8');
    const s = importCode(code);
    expect(s.res.scrap).toBe(321);
    expect(s.res.shard).toBe(4);
    expect(s.up.cannon).toBe(2);
    expect(s.gridR).toBe(3);
    expect(s.inv.tesla).toBe(1);
    expect(s.worlds.rust.gen).toBe(3);
    expect(s.worlds.rust.res.kinetic).toBe(0.1);
    expect(s.worlds.rust.species[0].name).toBe('Vexdra Ripper');
    expect(s.worlds.rust.species[0].c.res.kinetic).toBeCloseTo(0.15);
    expect(s.settings?.arcs).toBe(true);
  });

  it('round-trips and keeps compiled stats out of the code', () => {
    const s = defaultSave();
    const code = exportCode(s);
    expect(atob(code)).not.toContain('"c":');
    expect(importCode(code).build).toEqual(s.build);
  });

  it('rejects garbage', () => {
    expect(() => importCode('hello')).toThrow();
    expect(() => importCode(btoa('{"v":2}'))).toThrow(/not a Scrap Evolution save/);
  });
});
