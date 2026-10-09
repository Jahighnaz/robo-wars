import { describe, expect, it } from 'vitest';
import { cellAt, generateBoard, type Board } from '../src/robo/board';
import { Match, type PlayerSpec } from '../src/robo/match';
import { Bots } from '../src/robo/bot';
import { R } from '../src/robo/data';
import { crewBotCount } from '../src/net/robonet';

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

  it('crew battles give every robot the same specs', () => {
    const m = new Match(9, ['clank', 'bruiser', 'roller', 'whirl', 'picks'].map((ch, i) => ({ pid: 'p' + i, name: 'P' + i, chassis: ch })), { equal: true });
    for (const rb of m.robots) {
      expect(rb.maxHp).toBe(R.standard.hp);
      expect(rb.passive.length + rb.active.length).toBe(0);
      expect(m.cardCd(rb, 'move1')).toBe(m.cardCd(m.robots[0], 'move1'));
      const sp = m.spec(rb);
      expect([sp.heavy, sp.ram, sp.pick, sp.miner].some(Boolean)).toBe(false);
    }
    // the pickaxe stays a look: no swing damage in an equal battle
    blank(m);
    place(m, 4, 5, 5, 1); const t = place(m, 0, 5, 6, 0); // right in front of Picks
    for (const o of m.robots.slice(1, 4)) Object.assign(o, { alive: false, out: true });
    m.update(m.tick + 0.01);
    expect(t.hp).toBe(R.standard.hp - R.match.laserDmg);
  });

  it('classic: cards wait for the end of programming, cooldowns in registers, a shop between rounds', () => {
    const m = new Match(21, P(2), { classic: true, tick: 2 });
    blank(m);
    const a = place(m, 0, 5, 3, 1); place(m, 1, 9, 12, 0);
    // round 1 opens with the shop: nothing runs, buying works, only the host starts the round
    expect(m.phase).toBe('shop');
    m.update(5);
    expect(m.t).toBe(0);
    expect(m.buy(0, 'rear')).toBe(true);
    expect(m.program(0, 'move1')).toBe(false);
    expect(m.ready(1)).toBe(false);
    expect(m.ready(0)).toBe(true);
    expect(m.phase).toBe('program');
    // one register to program: the card waits, the move does not happen yet
    expect(m.program(0, 'move2')).toBe(true);
    expect(m.program(0, 'left')).toBe(false); // the register is full
    expect(m.unprogram(0)).toBe(true);
    expect(m.program(0, 'move2')).toBe(true);
    expect(m.buy(0, 'dbl')).toBe(false); // no shopping mid-round
    expect(m.play(0, 'move1')).toBe(false); // classic never plays straight away
    m.update(1.9);
    expect(a.c).toBe(3);
    m.update(0.11);
    expect(m.phase).toBe('exec');
    m.update(1 / 60);
    expect(a.c).toBe(5); // runs at the end of programming
    while (m.phase === 'exec') m.update(0.1);
    expect(m.regCount).toBe(1);
    expect(a.cds.move2).toBe(2);
    expect(m.program(0, 'move3')).toBe(true);
    // after five registers the shop opens again
    while (m.regCount < 5) m.update(0.1);
    while (m.phase !== 'shop') m.update(0.1);
    expect(m.phase).toBe('shop');
    expect(m.round).toBe(2);
    expect(a.cds.move3).toBe(4);
  });

  it('classic: cards run in antenna order, half a second apart, then the board, then lasers one by one', () => {
    const m = new Match(23, P(3), { classic: true, tick: 2 });
    const b = blank(m);
    b.antenna = { r: 0, c: 0 };
    // robot 2 is nearest the antenna, then 0, then 1
    const r2 = place(m, 2, 1, 1, 2), r0 = place(m, 0, 3, 3, 1), r1 = place(m, 1, 8, 8, 0);
    cellAt(b, 3, 4)!.gear = 'cw'; // r0 walks onto a gear: turned after all moves, before the lasers
    m.ready(0);
    m.program(0, 'move1'); m.program(1, 'move1'); m.program(2, 'move1');
    m.update(2.001);
    expect(m.phase).toBe('exec');
    const order: number[] = [];
    let t = 0, gearAt = -1;
    const beams: number[] = [];
    while (m.phase === 'exec' && t < 10) {
      m.update(0.01); t += 0.01;
      for (const e of m.drain()) {
        if (e.k === 'card') order.push(e.id);
        if (e.k === 'gear') gearAt = order.length;
        if (e.k === 'beam' && e.kind === 'laser') beams.push(Math.round(t * 100));
      }
      // nobody moves before their turn
      if (order.length === 1) expect([r0.c, r1.r]).toEqual([3, 8]);
    }
    expect(order).toEqual([2, 0, 1]);
    expect(gearAt).toBe(3); // gears after every card
    expect([r2.r, r0.c, r0.d, r1.r]).toEqual([2, 4, 2, 7]);
    // three lasers, each half a beat apart
    expect(beams.length).toBe(3);
    expect(beams[1] - beams[0]).toBeGreaterThanOrEqual(R.classic.beat * 100 - 2);
    expect(beams[2] - beams[1]).toBeGreaterThanOrEqual(R.classic.beat * 100 - 2);
  });

  it('classic: several registers programmed at once, respecting cooldowns', () => {
    const m = new Match(24, P(2), { classic: true, tick: 2, program: 3 });
    blank(m);
    const a = place(m, 0, 5, 2, 1); place(m, 1, 9, 12, 0);
    m.ready(0);
    expect(m.progN).toBe(3);
    expect(m.program(0, 'move2')).toBe(true);
    expect(m.program(0, 'move2')).toBe(false); // recharges in 3 registers
    expect(m.cardWait(a, 'move2')).toBe(2);
    expect(m.program(0, 'move1')).toBe(true);
    expect(m.program(0, 'right')).toBe(true);
    expect(m.program(0, 'left')).toBe(false); // three registers, all full
    // the robot on the other side programs nothing; the window ends on the clock (3 registers x 2 s)
    m.update(5.9);
    expect(m.phase).toBe('program');
    m.update(0.11);
    while (m.phase === 'exec') m.update(0.05);
    expect([a.r, a.c, a.d]).toEqual([5, 5, 2]);
    expect(m.regCount).toBe(3);
    // only two registers are left in the round
    expect(m.progN).toBe(2);
    // random: a fresh count each window, never past the end of the round
    const r = new Match(25, P(2), { classic: true, tick: 2, program: 0 });
    r.ready(0);
    expect(r.progN).toBeGreaterThanOrEqual(1);
    expect(r.progN).toBeLessThanOrEqual(5);
  });

  it('classic: bots program their registers and the match finishes', () => {
    const m = new Match(26, ['clank', 'bruiser', 'roller', 'whirl'].map((ch, i) => ({ pid: 'b' + i, name: 'B' + i, chassis: ch, bot: true })), { classic: true, tick: 2, program: 3 });
    const bots = new Bots(m);
    let programmed = 0;
    for (let i = 0; i < 60 * m.timeLimit + 10 && !m.over; i++) {
      if (m.phase === 'shop') m.ready(0);
      bots.update(); m.update(1 / 60);
      for (const e of m.drain()) if (e.k === 'card') programmed++;
    }
    expect(m.over).toBe(true);
    expect(programmed).toBeGreaterThan(20);
  });

  it('crew battles: members take bot seats', () => {
    expect(crewBotCount(1, 3)).toBe(3);
    expect(crewBotCount(2, 1)).toBe(0); // 1 other player, 1 bot wanted: a straight duel
    expect(crewBotCount(3, 2)).toBe(0);
    expect(crewBotCount(2, 3)).toBe(2);
    expect(crewBotCount(4, 5)).toBe(2); // six robots at most
    expect(crewBotCount(1, 0)).toBe(1); // never alone
  });

  it('classic: energy cubes refill after 8 registers', () => {
    const m = new Match(22, P(2), { classic: true, tick: 2 });
    const b = blank(m);
    cellAt(b, 4, 4)!.type = 'energy';
    const a = place(m, 0, 4, 4, 0); place(m, 1, 9, 12, 0);
    const e0 = a.energy;
    let regs = 0;
    while (regs < 12) { if (m.phase === 'shop') m.ready(0); m.update(0.25); regs = m.regCount; }
    // register 1 pays; register 5 always pays (reference rule) and restarts the 8-register refill,
    // so the next payout is register 10 (a register 5 again), not 13
    expect(a.energy - e0).toBe(3);
    expect(m.drained.size).toBe(1);
  });
});
