import { describe, expect, it } from 'vitest';
import { cellAt, generateBoard, type Board } from '../src/robo/board';
import { Match, type PlayerSpec } from '../src/robo/match';
import { Bots } from '../src/robo/bot';
import { R } from '../src/robo/data';

const P = (n: number, chassis = 'clank'): PlayerSpec[] =>
  Array.from({ length: n }, (_, i) => ({ pid: 'p' + i, name: 'P' + i, chassis, bot: true }));

/** A blank board: plain floor everywhere, so a test can place exactly what it needs. */
function blank(m: Match): Board {
  const b = m.board;
  for (const cell of b.cells) {
    Object.assign(cell, { type: 'floor', walls: [false, false, false, false], dir: 0, turn: null, kind: null, gear: null, pusher: null, emit: null });
  }
  b.emitters.length = 0;
  b.antenna = { r: 0, c: b.cols - 1 };
  return b;
}
function place(m: Match, id: number, r: number, c: number, d: number) {
  const rb = m.robots[id];
  Object.assign(rb, { r, c, d, guardT: 0 });
  return rb;
}

describe('board', () => {
  it('is the same on every device for a seed', () => {
    const a = generateBoard(42), b = generateBoard(42), c = generateBoard(43);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c));
  });
  it('keeps start positions clear', () => {
    for (let s = 1; s < 40; s++) {
      const b = generateBoard(s);
      for (const st of b.starts) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cell = cellAt(b, st.r + dr, st.c + dc);
        if (cell) expect(cell.type === 'pit' || cell.type === 'crate').toBe(false);
      }
    }
  });
});

describe('robo rally rules, live', () => {
  it('moves, pushes robots and stops at walls', () => {
    const m = new Match(1, P(2));
    const b = blank(m);
    const a = place(m, 0, 5, 3, 1), o = place(m, 1, 5, 4, 1);
    expect(m.play(0, 'move1')).toBe(true);
    expect([a.c, o.c]).toEqual([4, 5]); // pushed
    expect(m.play(0, 'move1')).toBe(false); // still cooling down / busy
    m.update(2);
    cellAt(b, 5, 5)!.walls[1] = true;
    expect(m.play(0, 'move2')).toBe(true);
    expect([a.c, o.c]).toEqual([4, 5]); // wall stops the whole chain
  });

  it('pits and the edge destroy, and a life is lost', () => {
    const m = new Match(2, P(2));
    const b = blank(m);
    cellAt(b, 3, 4)!.type = 'pit';
    const a = place(m, 0, 3, 3, 1);
    place(m, 1, 9, 9, 0);
    m.play(0, 'move1');
    expect(a.alive).toBe(false);
    expect(a.lives).toBe(R.match.lives - 1);
    m.update(R.match.respawn + 0.1);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(a.maxHp);
  });

  it('lasers fire on the register, walls and crates block them', () => {
    const m = new Match(3, P(3));
    const b = blank(m);
    const a = place(m, 0, 2, 1, 1), t = place(m, 1, 2, 6, 3);
    const c = place(m, 2, 8, 1, 1);
    m.update(R.match.tick + 0.01);
    expect(t.hp).toBe(t.maxHp - 1);
    expect(a.hp).toBe(a.maxHp - 1); // it fired back
    cellAt(b, 2, 3)!.type = 'crate';
    m.update(R.match.tick);
    expect(t.hp).toBe(t.maxHp - 1);
    expect(c.hp).toBe(c.maxHp);
  });

  it('belts carry, gears turn, energy pays for upgrades', () => {
    const m = new Match(4, P(2));
    const b = blank(m);
    Object.assign(cellAt(b, 4, 4)!, { type: 'conv', kind: 'b', dir: 1 });
    Object.assign(cellAt(b, 4, 5)!, { type: 'conv', kind: 'b', dir: 1 });
    cellAt(b, 4, 6)!.gear = 'cw';
    cellAt(b, 8, 8)!.type = 'energy';
    const a = place(m, 0, 4, 4, 0), e = place(m, 1, 8, 8, 0);
    m.update(R.match.tick + 0.01);
    expect([a.r, a.c, a.d]).toEqual([4, 6, 1]);
    expect(e.energy).toBe(R.match.startEnergy + 1);
    expect(m.buy(1, 'rear')).toBe(true);
    expect(e.energy).toBe(R.match.startEnergy + 1 - R.upgrades.rear.cost);
    expect(m.buy(1, 'rear')).toBe(false);
  });

  it('heavy weapons: rocket knocks back, shield blocks once, mirror reflects', () => {
    const m = new Match(5, [{ pid: 'a', name: 'A', chassis: 'roller' }, { pid: 'b', name: 'B', chassis: 'clank' }]);
    blank(m);
    const a = place(m, 0, 5, 2, 1), t = place(m, 1, 5, 5, 0);
    expect(m.use(0, 'rocket')).toBe(true);
    expect(t.hp).toBe(t.maxHp - 2);
    expect(t.c).toBe(6);
    expect(m.use(0, 'rocket')).toBe(false); // cooldown
    t.energy = 20; m.buy(1, 'shield'); m.buy(1, 'jedi');
    t.d = 3; // facing the shooter
    m.update(R.match.tick + 0.01);
    expect(t.hp).toBe(t.maxHp - 2); // shield ate the hit
    m.update(R.match.tick);
    expect(a.hp).toBeLessThan(a.maxHp); // mirror sent it back
  });

  it('a match against bots finishes with a winner', () => {
    for (const seed of [11, 12, 13]) {
      const m = new Match(seed, ['clank', 'bruiser', 'roller', 'whirl', 'picks'].map((ch, i) => ({ pid: 'b' + i, name: 'B' + i, chassis: ch, bot: true })));
      const bots = new Bots(m);
      for (let i = 0; i < 60 * R.match.timeLimit + 10 && !m.over; i++) { bots.update(); m.update(1 / 60); m.drain(); }
      expect(m.over).toBe(true);
      expect(m.winner).toBeGreaterThanOrEqual(0);
      const total = m.robots.reduce((s, r) => s + r.kills + r.deaths, 0);
      expect(total).toBeGreaterThan(3); // they actually fight
    }
  });
});
