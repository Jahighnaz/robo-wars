# Charles Projects

A workshop-themed version of Scrap Evolution: Captain Charles rides his block-built truck as a pixel-art bobblehead, and every tool is from the shop: nailguns, saw launchers, hot glue guns, laser cutters, arc welders and plasma cutters. Sectors are the Junkyard, Cold Storage and the Foundry. Same rules and tuned numbers as Scrap Evolution; it keeps its own save (prototype save codes still import).

### Crew, records and trophies

- **Trophies:** 50 PlayStation-style trophies (bronze, silver, gold, one platinum) with office and workshop jokes, including hidden easter eggs. Hint: try tapping Captain Charles.
- **Records:** personal bests for serious and questionable KPIs (Workaholic, The Procrastinator, Speedrun to HR, ...).
- **Crew:** one device taps *Start a crew* and shares the 4-letter code; others join. Everyone sees a combined records board, live news, and *shift challenges*: the same map with the stock truck, scored on kills, time, level and the apex.
- Web pages cannot scan the local Wi-Fi, so devices find each other through PeerJS's free public broker (internet needed). Data then flows peer-to-peer, directly inside the Wi-Fi when possible. To use your own broker: `npx peerjs --port 9000` and open the game with `?broker=<host>:9000`.
- Offline fallback: *Record cards* (a copyable code) add a crew-mate's records to your board.

---

## Scrap Evolution (base game)

An iPad-first, one-finger survivor game: build a vehicle from blocks, survive five minutes of waves, destroy the apex. Enemies are built from the same blocks as you, and every world breeds its most successful machines against the way you play.

Neon cyberpunk 2.5D (Three.js, locked tilted camera) standalone port of the v0.2 prototype (`prototype/scrap-evolution.html`). Design: `docs/design.md`.

## Play it on your iPad

1. In the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions** (one time).
2. Merge to `main`. The workflow tests, builds and deploys to `https://<user>.github.io/<repo>/`.
3. Open that URL in **Safari** on the iPad → **Share → Add to Home Screen**.
4. Launch it from the icon: full screen, works offline. New versions show an "Update available" banner.

Your prototype progress carries over: in the prototype open *Back up save*, copy the code, then paste it under **Settings & backup → Load code** here.

## Controls

- Touch anywhere and drag to drive. Release to coast. Everything else is automatic.
- Weapons fire on their own inside their arc; the triangle on a block shows where it faces.
- Desktop testing: WASD / arrow keys, `Esc` or `P` to pause.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173, also on your LAN (--host) for the iPad
npm test           # unit tests: compiler, connectivity, GA, save import, headless runs
npm run sim        # weapon duel balance report (headless bot)
npm run build      # production PWA in dist/
```

## Layout

| Folder | What |
| --- | --- |
| `src/data` | All tunable numbers as JSON, validated with zod at load |
| `src/core` | Seeded RNG, math |
| `src/vehicle` | Block grid, connectivity, stat compiler |
| `src/enemies` | Species genomes, compiled with the same rules |
| `src/evolution` | Adaptive resistance + genetic algorithm |
| `src/sim` | Headless run simulation (director, combat, loot, cards) |
| `src/render/three` | 2.5D Three.js renderer: locked tilted camera, instanced neon blocks, bloom, 2D overlay; 3D garage preview |
| `src/input` | Floating joystick |
| `src/persistence` | Versioned save (prototype-compatible), IndexedDB |
| `src/ui` | Screens, HUD, main loop |
| `tests` | Vitest suites, bot, prototype save fixture |
