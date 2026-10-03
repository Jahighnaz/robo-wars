# Charles Projects (Scrap Evolution reskin) — working notes

This branch is the "Charles Projects" version: block names, colours, icons, resources, sectors and perks are reskinned to workshop tools in `src/data/*.json` and `src/render/icons.ts`; internal block ids (cannon, shotgun, ...) are unchanged so saves and tests stay compatible. Captain Charles is an 8-direction billboard (`public/charles/sheet.png`, cut by `scripts/charles-frames.py`) riding the cab as a spring bobblehead (`src/render/three/charles.ts`). The save lives under its own storage keys.

Tiers: blocks carry `fam` (tier-1 id) and `tier`; use `fam()`/`isCab()`/`isUnlocked()` from `src/data`, never hard-coded ids. Music: `src/audio/music.ts`, one track, "Shop Floor Fever" (scheduled Web Audio chiptune; `setHeat(0-2)` adds layers when enemies crowd the truck, never tempo; `jingle(tier)` for trophies; `window.__renderMusic(mood, secs, heat)` renders a WAV for checking). The owner likes it as it is: keep the notes and tempos, and do not add other tracks unless asked.

Social layer: `src/meta` (profile, records, trophies; pure logic, tested in `tests/meta.test.ts`) and `src/net/crew.ts` (PeerJS star topology, host relays; loaded lazily). Co-op: `Run` holds `players[]` (player 0 = host/local; `run.local` picks the local one on a client mirror). The host simulates; `src/net/coop.ts` encodes Int16 snapshots and `Mirror` renders them on clients (never stepped). Challenge runs are exhibition runs (`RunOptions.exhibition`) on a scratch save with the stock truck and a shared seed.

Design reference: `docs/design.md` (the master prompt is in its "Master prompt" section).
Reference implementation: `prototype/scrap-evolution.html`. Where code and prototype disagree on numbers or behaviour, the prototype wins.

- Simulation (`src/sim`, `src/vehicle`, `src/enemies`, `src/evolution`, `src/data`) must never import rendering or DOM code; it runs headless in tests.
- Tunable numbers live in `src/data/*.json`.
- Save format is the prototype's `v: 1`; prototype export codes must keep importing (`tests/save.test.ts`).
- Before pushing: `npm test` and `npm run build`.

Deviations from the master prompt, deliberately:
- Rendering is 3D with Three.js (not PixiJS), per the owner's request for a 2.5D look: a locked, tilted follow camera over a real 3D scene, instanced meshes, a neon edge shader and bloom. The sim stays 2D; sim (x, y) maps to world (x, z). Text, joystick and markers are on a 2D overlay canvas. All of it lives in `src/render/three`.
- No ECS: plain object arrays with a spatial hash, as in the prototype.
- The weapon duel (`npm run sim`) reports instead of failing CI; with the current bot Scattergun and Flamer sit below 60% and Mortar above 160% of the Autocannon, matching the doc's own finding that they need a balance pass.
