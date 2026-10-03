# Scrap Evolution — working notes

Design reference: `docs/design.md` (the master prompt is in its "Master prompt" section).
Reference implementation: `prototype/scrap-evolution.html`. Where code and prototype disagree on numbers or behaviour, the prototype wins.

- Simulation (`src/sim`, `src/vehicle`, `src/enemies`, `src/evolution`, `src/data`) must never import rendering or DOM code; it runs headless in tests.
- Tunable numbers live in `src/data/*.json`.
- Save format is the prototype's `v: 1`; prototype export codes must keep importing (`tests/save.test.ts`).
- Before pushing: `npm test` and `npm run build`.

Deviations from the master prompt, deliberately:
- Rendering is Canvas 2D with pre-rendered glow sprites, not PixiJS (the prototype's renderer already hit 60 fps on iPad; swap is isolated to `src/render`).
- No ECS: plain object arrays with a spatial hash, as in the prototype.
- The weapon duel (`npm run sim`) reports instead of failing CI; with the current bot Scattergun and Flamer sit below 60% and Mortar above 160% of the Autocannon, matching the doc's own finding that they need a balance pass.
