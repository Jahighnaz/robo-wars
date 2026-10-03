# Scrap Evolution

An iPad-first, one-finger survivor game: build a vehicle from blocks, survive five minutes of waves, destroy the apex. Enemies are built from the same blocks as you, and every world breeds its most successful machines against the way you play.

Neon cyberpunk standalone port of the v0.2 prototype (`prototype/scrap-evolution.html`). Design: `docs/design.md`.

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
| `src/render` | Neon Canvas 2D renderer with cached glow sprites |
| `src/input` | Floating joystick |
| `src/persistence` | Versioned save (prototype-compatible), IndexedDB |
| `src/ui` | Screens, HUD, main loop |
| `tests` | Vitest suites, bot, prototype save fixture |
