// Scripted bots for headless runs.
import { Run } from '../src/sim/run';

/** Kiter: drives away from the enemy centre of mass, circling the arena centre. */
export function kiterStep(run: Run): void {
  const V = run.V;
  let cx = 0, cy = 0, n = 0;
  for (const e of run.E) {
    const d = Math.hypot(e.x - V.x, e.y - V.y);
    if (d < 360) { const w = 1 / Math.max(30, d); cx += (e.x - V.x) * w; cy += (e.y - V.y) * w; n += w; }
  }
  // orbit around the arena centre so we don't pin ourselves against the wall
  const r = Math.hypot(V.x, V.y) || 1;
  let ox = -V.y / r, oy = V.x / r;
  ox -= (V.x / r) * Math.max(0, (r - 900) / 600);
  oy -= (V.y / r) * Math.max(0, (r - 900) / 600);
  let jx = ox, jy = oy;
  if (n > 0) { const m = Math.hypot(cx, cy) || 1; jx = ox * 0.5 - (cx / m) * 1.2; jy = oy * 0.5 - (cy / m) * 1.2; }
  const m = Math.hypot(jx, jy) || 1;
  run.joy.x = jx / m; run.joy.y = jy / m;
}

/** Plays a full run headless, auto-picking the first card. Returns the run. */
export function playRun(run: Run, maxT = 420, step = kiterStep): Run {
  const dt = 1 / 60;
  while (!run.over && run.t < maxT) {
    step(run);
    run.update(dt);
    while (run.pendingLevels > 0 && !run.over) {
      const cards = run.makeCards();
      const c = cards.find(k => k.kind !== 'block') ?? cards[0];
      if (c.kind === 'block') {
        const cells = run.placementCells();
        if (cells.length) run.placeBlock(cells[0][0], cells[0][1], c.t);
      } else run.applyCard(c);
      run.consumeLevel();
    }
  }
  return run;
}
