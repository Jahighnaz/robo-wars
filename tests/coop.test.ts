import { describe, expect, it } from 'vitest';
import { Run } from '../src/sim/run';
import { defaultSave } from '../src/persistence/save';
import { encodeSnapshot, Mirror, startInfo } from '../src/net/coop';

describe('co-op snapshots', () => {
  it('a client mirror reproduces the host state', () => {
    const mate = { pid: 'dave', name: 'Dave', build: defaultSave().build, up: {}, gridR: 2 };
    const host = new Run(defaultSave(), 'tundra', { seed: 21, pid: 'charles', name: 'Charles', crew: [mate] });
    host.players[0].joy.x = 1;
    host.players[1].joy.y = -1;
    for (let i = 0; i < 60 * 45; i++) host.update(1 / 60);
    const mirror = new Mirror(startInfo(host), 'dave', { w: 1024, h: 768 });
    expect(mirror.run.local).toBe(1);
    const buf = encodeSnapshot(host);
    expect(buf.byteLength).toBeLessThan(40000);
    mirror.apply(buf);
    const m = mirror.run;
    expect(m.E.length).toBe(host.E.length);
    expect(m.kills).toBe(host.kills);
    expect(m.level).toBe(host.level);
    expect(m.players[1].V.list.length).toBe(host.players[1].V.list.length);
    expect(Math.abs(m.players[0].V.x - host.players[0].V.x)).toBeLessThan(1.01);
    expect(m.PK.length).toBe(Math.min(500, host.PK.length));
    expect(m.HZ).toEqual(host.HZ);
    // the mirror is never simulated, only smoothed
    mirror.advance(1 / 60, { x: 0, y: 0 });
    expect(Number.isFinite(m.E[0]?.x ?? 0)).toBe(true);
  });
});
