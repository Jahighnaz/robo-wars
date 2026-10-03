import { describe, expect, it } from 'vitest';
import { compileVehicle, freshMods, makeVehicle, reachable, removeFromBuild, validCells, type BuildCell } from '../src/vehicle/vehicle';
import { defaultSave } from '../src/persistence/save';

describe('vehicle compiler', () => {
  it('compiles the starter build like the prototype', () => {
    const v = makeVehicle(defaultSave().build, {});
    const s = compileVehicle(v, freshMods(), {});
    // cab 3 + 4 wheels + battery 1 + 2 cannons 3 = 11 mass, thrust 28
    expect(s.mass).toBe(11);
    expect(s.thrust).toBe(28);
    expect(s.speed).toBeCloseTo(clampSpeed(90 * 28 / 11));
    expect(s.power).toBe(10);
    expect(s.demand).toBe(2);
    expect(s.powerFactor).toBe(1);
    expect(s.weapons).toHaveLength(2);
  });

  it('applies adjacency synergies and power overload', () => {
    const build: BuildCell[] = [
      { x: 0, y: 0, t: 'cab', r: 0 }, { x: 1, y: 0, t: 'tesla', r: 0 }, { x: 2, y: 0, t: 'battery', r: 0 },
      { x: -1, y: 0, t: 'cannon', r: 0 }, { x: -2, y: 0, t: 'cannon', r: 0 },
      { x: 0, y: 1, t: 'laser', r: 0 }, { x: 0, y: 2, t: 'laser', r: 0 }, { x: 0, y: -1, t: 'laser', r: 0 },
    ];
    const v = makeVehicle(build, {});
    const s = compileVehicle(v, freshMods(), {});
    const tesla = v.list.find(b => b.t === 'tesla')!;
    expect(tesla.syn.chain).toBe(1);
    expect(v.list.find(b => b.x === -1)!.syn.rateM).toBeCloseTo(1.12);
    expect(s.demand).toBe(2 + 1 + 1 + 6);
    expect(s.powerFactor).toBeCloseTo(10 / 10);
  });

  it('workshop levels raise HP, thrust and power', () => {
    const up = { wheel: 2, cab: 1 };
    const v = makeVehicle(defaultSave().build, up);
    const s = compileVehicle(v, freshMods(), up);
    expect(v.list.find(b => b.t === 'wheel')!.max).toBe(Math.round(45 * 1.4));
    expect(s.thrust).toBeCloseTo(28 * 1.16);
    expect(s.power).toBe(11);
  });

  it('detaches blocks that lose their path to the cab', () => {
    const build: BuildCell[] = [{ x: 0, y: 0, t: 'cab', r: 0 }, { x: 0, y: 1, t: 'armor', r: 0 }, { x: 0, y: 2, t: 'cannon', r: 2 }, { x: 1, y: 2, t: 'wheel', r: 0 }];
    const removed = removeFromBuild(build, build[1]);
    expect(removed.map(b => b.t).sort()).toEqual(['cannon', 'wheel']);
    expect(build).toHaveLength(1);
    expect(reachable(makeVehicle(build, {})).size).toBe(1);
  });

  it('only offers free cells inside the grid', () => {
    const cells = validCells([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1);
    expect(cells).toHaveLength(5);
    expect(cells.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1)).toBe(true);
  });
});

function clampSpeed(v: number) { return Math.min(290, Math.max(40, v)); }
