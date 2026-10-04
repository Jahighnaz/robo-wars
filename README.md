# Robo Wars

Robo Rally, played live. Five hand-drawn robots fight on a generated factory floor: program cards are played the moment they cool down, the factory still runs in registers (belts, push panels, gears, board lasers, robot lasers, energy), and energy buys upgrades from the Robo Rally deck. Heavier weapons take longer to recharge, which gives the live game its turn-based rhythm. Play against bots, or against your crew on the same Wi-Fi.

Rules, board elements and upgrade cards follow our interactive Robo Rally projection board (`docs/reference/RoboRally-Board-v0_101.html`).

## The robots

| Robot | Moves by | Perk |
| --- | --- | --- |
| **Clank** | walking on three legs | the most hull, cards cool down a little slower |
| **Bruiser** | tank treads | starts with Double Barrel, immune to knockback |
| **Roller** | big wheels | cards cool down 20% faster, starts with a Rocket Launcher |
| **Whirl** | sliding on its saw skirt | hovers over pits, ramming deals 2 |
| **Picks** | crawling, pickaxe swinging | hits the robot in front for 3 every register, mines double energy |

Each robot is an animated billboard: Clank waddles, Bruiser rumbles, Roller bounces and leans, Whirl hovers on a spinning saw, Picks inches along swinging its separate pickaxe arm.

## How a battle works

- **Program cards:** Move 1/2/3, Back up, Turn left/right, U-turn. Tap a card whenever it is cool (keys: W/↑, 2, 3, S/↓, A/←, D/→, X). Moving into a robot pushes it, into pits too.
- **Registers (turns):** every turn (10 s by default; 3/5/10/15/20 s under *Battle bots* or Settings) the factory acts in the reference order: blue belts ×2, green belts, push panels (on the registers printed on them), gears, board lasers, then every robot fires its laser forward (in antenna priority order). Pickaxes swing, energy cubes and repair wrenches pay out.
- **Terrain:** walls and crates block movement and lasers (rail guns and Overload go through walls), pits and the floor edge cost a life, the priority antenna is solid.
- **Upgrades:** spend energy any time. Permanent: Rear Laser, Double Barrel, Rail Gun, Deflector Shield (blocks the first hit each register), Mirror Plating (lasers from the front bounce back), Hover Unit. Active (Q/E/R): Rocket Launcher (9 s), Teleporter (14 s), EMP (18 s), Reverse Gear (20 s), Overload (22 s), Kamikaze (one use).
- **Turn length:** card and upgrade cooldowns, EMP jams and Reverse Gear scale with the turn length, so a battle lasts about the same number of turns whatever you pick. The clock is at least 5 minutes or 45 turns.
- **Reading the board:** a big arrow in the robot's colour shows where it faces, and a faint line shows where its laser will hit at the next turn (yours brighter).
- **Winning:** three lives each; last robot standing, or most kills when the clock runs out. A kill pays 2 energy.

## Crew battles (same Wi-Fi)

One device taps **Host a crew** and shares the 4-letter code; the others **Join**. The host taps **Open the arena**, crew-mates **Take a seat**, the host starts the battle. Up to six robots (tested with five players on five devices); the *Battle bots* count fills empty seats. The host's device runs the match and streams snapshots (15/s); the others send their card plays. A crew-mate who drops out is taken over by a bot.

Web pages cannot scan the local Wi-Fi, so devices find each other through PeerJS's free public broker (internet needed); the data then flows peer-to-peer. Your own broker: `npx peerjs --port 9000`, then open the game with `?broker=<host>:9000`.

## Play it on your iPad

Build (`npm run build`) and host the `dist` folder anywhere static (GitHub Pages via the included workflow, or zip `dist` and upload it to tiiny.host). Open it in Safari → Share → Add to Home Screen: full screen, works offline.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173, also on your LAN for the iPad
npm test           # board generation, rules, upgrades, bot matches
npm run build      # production PWA in dist/
```

| Folder | What |
| --- | --- |
| `src/data/robo.json` | Every tunable number: board mix, register length, card cooldowns, chassis, upgrades |
| `src/robo` | Headless rules: board generator, live match, bot pilots |
| `src/render/three/arena3d.ts` | Three.js arena, animated robots, effects |
| `src/net` | Crew link (PeerJS) and match snapshots |
| `src/ui` | Hub, robot picker, HUD, shop, results |
| `src/audio` | Board sounds (from the reference board) and the "Shop Floor Fever" chiptune |
| `public/robots` | Robot art (Picks has its arm cut out as a separate layer) |
