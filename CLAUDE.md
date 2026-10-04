# Robo Wars — working notes

A live, real-time take on Robo Rally, branched from Charles Projects (which lives on `claude/charles-projects`; the truck game was removed on this branch). Rules, board elements and upgrade cards follow the owner's interactive Robo Rally board in `docs/reference/RoboRally-Board-v0_101.html`: where the code and that file disagree on a rule, the reference wins, except where the live format needs it (cards on cooldowns instead of locked registers, registers on a timer).

- Simulation (`src/robo`) is headless and seeded: no DOM or rendering imports; it runs in tests.
- Crew PvP uses `MatchOptions.equal`: rules read `m.spec(rb)` (never `R.chassis` directly) so every robot gets `robo.json` `standard`. Chassis perks only apply vs bots.
- Classic mode is `MatchOptions.classic`: one card per register (`Robot.played` vs `Match.regCount`), card/upgrade cooldowns in registers (`robo.json` `classic`), a `phase: 'shop'` at each round start that freezes `update()` until the host (robot 0) calls `ready()`.
- Turn length is `MatchOptions.tick` (player setting, default 10 s). `robo.json` cooldowns are tuned at `match.tick` (2 s) and scale by `Match.pace`; use `m.cardCd()`/`m.upgradeCd()`, never raw json cooldowns.
- Tunable numbers live in `src/data/robo.json` (validated with zod in `src/robo/data.ts`).
- Board generation must stay deterministic for a seed: clients rebuild the host's board from it.
- Multiplayer: the host simulates; `src/net/robonet.ts` sends JSON snapshots (`SNAP_HZ`) and clients only copy them into a mirror `Match` (never `update()` it). Inputs are `rw_in` actions; `HOST_ONLY` messages are not relayed by the crew host.
- Robots are billboards (`public/robots/*.png`, 512 px, bottom-centred); per-chassis motion is in `Arena3D.pose()`. Picks is two layers (`picks-body.png`, `picks-arm.png` with the pivot in `ARM_PIVOT`).
- Music: `src/audio/music.ts`, "Shop Floor Fever" (the owner likes it as it is: keep the notes and tempos, do not add other tracks unless asked). Board sounds: `src/audio/sfx.ts`.
- Before pushing: `npm test` and `npm run build`.
