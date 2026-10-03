# Scrap Evolution — Game Architecture & Master Prompt

Oct 3, 2026 · @Hannes Berg

## Vision & design pillars

An iPad-first, one-finger survivor game where the thing you level up is a physical vehicle you build block by block, in worlds whose enemies and resources evolve in response to how you play. Working title: **Scrap Evolution**.

The central idea that ties both halves together: **enemies are built from the same block system as the player.** Every enemy is a small vehicle. Killing it drops its blocks as salvage, and the world's enemy designs are literally bred by a genetic algorithm. One system powers building, combat, loot and evolution.

| Pillar | Player feeling | Design rule |
| --- | --- | --- |
| Build | "My machine is mine" | Placement and orientation of blocks change behaviour, not only stats |
| Survive | "One more run" | Runs of 4–8 min, one thumb, auto-fire, a meaningful choice every 30–45 s |
| Evolve | "The world remembers me" | Worlds adapt to the player's habits, visibly and fairly, forcing build changes |
| Explore | "I need what's over there" | Each world has a distinct resource profile; good builds need materials from several worlds |

Non-goals for v1: multiplayer, free 3D building, physics-heavy destruction, story campaign.

## Status: playable prototype (v0.2)

A working single-file prototype exists and is the **reference implementation** for the standalone game: [Scrap Evolution prototype](https://claude.ai/artifact/Ms4XqtVQZomep9died15XC). Its behaviour and numbers were tuned with headless bot runs and playtesting on the iPad. The standalone build should port it module by module, not reinvent it.

| Area | In the prototype | Still design-only |
| --- | --- | --- |
| Vehicle | 5×5 grid (7×7, 9×9 unlockable), 15 block types, connectivity + detach, armor sharing, adjacency synergies, power budget | Cab variants, rarity tiers, second layer, drone bay, mine layer |
| Run | Floating joystick, arc-based auto-fire (always-fire), threat-budget director, 4 spawn patterns, breathers, 2 mini-bosses, apex at 5:00, level-up cards with reroll | Evolution fusion cards, slow-mo, damage numbers, stop-to-fire mode |
| Enemies | Block genomes, 9 enemy block types, steering + separation, ranged, kamikaze | Shielder, splitter, leech |
| Worlds | Rustlands (mud), Crystal Tundra (ice), Magma Rift (lava), resource tables, deposits, caches | Fungal Marsh, Storm Spires, invasions, daily mutators |
| Evolution | GA per world (fitness, crossover, mutation, extinction), counter-weighted mutations, adaptive resistance, eras, debrief report | Ecology (depletion), faction spread |
| Meta | Crafting, workshop upgrades Mk I–VI, grid expansion, damage report, localStorage save + export code | Research tree, bestiary screen, blueprints, mastery |
| Platform | iPad Safari, safe areas, Web Audio | Offline PWA, IndexedDB, Pixi rendering |

The prototype's save export code should stay importable by the standalone game, so progress carries over (see milestone S4).

## Core loop and session structure

The game runs on three nested loops: seconds (drive and dodge), minutes (a run), and days (garage, meta and world evolution).

1. **Garage (30–90 s):** pick a world on the map, adjust the build on the grid, equip a blueprint.
2. **Run (4–8 min):** drive with the floating joystick; weapons fire automatically. Enemies arrive in waves of \~30 s; every \~60 s a mini-boss, at the end a world boss.
3. **In-run level-ups:** XP orbs fill a bar; each level offers 3 cards (a new block, a block upgrade, or a perk). New blocks snap onto the vehicle via a quick 5-second placement overlay (game paused).
4. **Salvage:** destroyed enemies drop blocks and resources; a magnet block widens pickup range.
5. **Extract or die:** surviving the boss banks 100% of loot; dying banks 50% (softens frustration, keeps runs worth playing).
6. **Debrief:** loot converts into permanent blocks, crafting materials and research. The world then **evolves** (see Evolutionary worlds) and shows what changed.

In-run blocks are temporary (Archero style); blocks crafted in the garage are permanent and form the starting build. This split keeps every run fresh while long-term building still matters.

## Vehicle block system (TerraTech side)

The vehicle is a graph of blocks on a top-down 2D grid (one layer for v1, a second "turret deck" layer later). A **Cab** block is the root; anything not connected to the Cab through attach points falls off when a connecting block dies. This is the TerraTech signature moment and the main source of drama.

**Build constraints** keep choices meaningful: a grid size limit (starts 5×5, unlocks to 9×9), a **power budget** (weapons and shields consume, batteries and generators supply) and **mass**, which lowers speed and turning unless you add more propulsion.

| Category | Examples | What placement changes |
| --- | --- | --- |
| Cab | Scout cab, Heavy cab, Tech cab | Base HP, power, grid size, 1 unique perk |
| Propulsion | Wheels, tracks, hover pads, spider legs | Speed, turn rate, terrain handling (mud, ice, lava) |
| Armor | Plate, sloped plate, reactive, regen moss | Protects neighbours; sloped armor deflects from its facing |
| Weapons | Autocannon, shotgun, laser, tesla, flamer, mortar, drone bay, mine layer | Firing arc follows facing (front, side, rear, 360° turret) |
| Energy | Battery, generator, capacitor | Power supply; adjacency buffs to energy weapons |
| Utility | Magnet, shield projector, repair arm, radar, booster | Range, healing, pickup, dash |

**Damage types:** kinetic, explosive, fire, energy, electric (chains), corrosive. Enemies and blocks have resistances, which is what the evolution system tunes.

**Synergies** are the fun multiplier: adjacency bonuses (tesla next to battery = +1 chain), tag sets (3 "Fire" blocks = burning ground), and directional builds (all guns rear-facing = "retreat" playstyle). Stats are compiled once whenever the graph changes into a flat VehicleStats object, so combat never walks the graph per frame.

Block rarity: Common → Rare → Epic → Legendary; duplicates merge into higher tiers (survivor-style merge).

## Combat, controls, in-run upgrades (Archero / Survivor.io side)

The player's only input during a run is movement; everything else is automatic, so all depth lives in the build and in positioning.

- **Floating joystick:** appears wherever the thumb touches, dead zone \~8% of radius, max radius \~70 px. Release = vehicle coasts and brakes (mass-dependent), which makes heavy builds feel heavy.
- **Vehicle physics:** arcade, not simulated. Velocity steers toward joystick direction with turn rate and acceleration from VehicleStats; tracks turn on the spot, wheels drift.
- **Auto-targeting:** each weapon picks the nearest valid enemy inside its own firing arc and range; priority rules per weapon (mortar prefers clusters, laser prefers elites).
- **Archero twist (optional mode):** weapons fire only while stopped, rewarding stop-and-go play. Test both; Survivor.io-style always-fire is the safer default.
- **Dash:** an auto-triggered booster block, or a double-tap if playtests show players want one active skill.

**Level-up cards** (3 choices, 1 reroll per run):

| Card type | Example | Frequency |
| --- | --- | --- |
| New block | "Tesla Coil (Rare) — place it" | \~45% |
| Block upgrade | "All autocannons +1 barrel" | \~35% |
| Perk | "Kills heal 1% HP" | \~15% |
| Evolution | Two maxed blocks fuse: Flamer + Fan = Firestorm | \~5%, guaranteed when eligible |

Evolutions (Survivor.io's best mechanic) map naturally onto adjacency: the two blocks must touch on the vehicle.

## Enemies & wave director

Waves are spent from a **threat budget**, not scripted lists, so the same director works for every world and adapts to player power.

**Director, per wave:** budget = base × world tier × time curve × (player DPS / expected DPS)^0.5. The square root lets strong players feel strong while still being pushed. The director buys enemies from the world's current species pool by cost, with spawn patterns: ring, flank, stream, ambush from screen edge. A "breather" wave every \~4 waves lowers intensity and spawns a resource cache, which creates rhythm.

| Archetype | Role | Counter it teaches |
| --- | --- | --- |
| Swarmer | Many, fast, weak | Area damage, chain lightning |
| Brute | Slow, armored | Corrosive, high single-target |
| Shooter | Keeps distance | Speed, side armor |
| Kamikaze | Rushes and explodes | Rear weapons, mines |
| Shielder | Projects shield on allies | Priority targeting, energy damage |
| Splitter | Splits on death | Overkill, fire DoT |
| Leech | Steals blocks off your vehicle | Protect the edges, magnets |
| Mini-boss / Boss | Multi-block, has phases, drops rare blocks | Everything above |

Every enemy is defined as a **genome**: a small block layout (cab + 1–6 blocks) plus behaviour parameters (aggression, preferred range, flocking weights). Its stats are compiled with the same compiler as the player's vehicle. Performance target: 300 active enemies at 60 fps on a mid-range phone, using pooling, a spatial hash and simple steering instead of pathfinding.

## Resources & world distribution

Six resources, each abundant in one or two worlds and scarce elsewhere, so every strong build needs materials from several worlds.

| Resource | Used for | Rustlands | Fungal Marsh | Crystal Tundra | Magma Rift | Storm Spires |
| --- | --- | --- | --- | --- | --- | --- |
| Scrap | Every block, repairs | High | Medium | Low | Medium | Low |
| Copper | Electric, energy blocks | Medium | Low | Low | Low | High |
| Bio-resin | Regen armor, organic perks | Low | High | None | Low | Low |
| Cryo-crystal | Lasers, shields | Low | Low | High | None | Medium |
| Pyro-ore | Fire, explosives | Low | None | Low | High | Low |
| Core shards | Legendary blocks, Cab upgrades | Bosses only, all worlds |  |  |  |  |

Resources appear in three ways: enemy drops (weighted by the enemy's blocks, so copper comes from electric enemies), map nodes you drive over (deposits that take 2–3 s to mine while you keep dodging), and breather-wave caches.

Each world also has a **hazard** that interacts with propulsion and damage types: mud slows wheels (tracks immune), ice adds drift, lava damages anything not hovering, storms randomly charge electric blocks. This makes the garage choice per world a real decision.

Distribution is data, not code: every world has a resource weight table, and the evolution system is allowed to shift it (see next section).

## Evolutionary worlds system

Each world is a living ecosystem with a **World Genome** that changes after every run based on what the player did. Evolution must be visible, explainable and bounded, or it feels like rubber-banding.

**World Genome fields:** species pool (enemy genomes + population share), resistance profile per damage type, resource weights, hazard intensity, dominant faction, mutation rate, world tier.

**Three evolution mechanisms, run at debrief:**

1. **Enemy breeding (genetic algorithm).** Fitness per enemy genome = damage dealt to the player + time survived + blocks stolen. Top 30% reproduce: crossover of block layouts and behaviour weights, then mutation (add, remove, swap or rotate a block; nudge a parameter). Bottom 30% go extinct. Population stays at 8–15 species per world. Result: if you kite at range, fast flankers emerge; if you face-tank, armored brutes thrive.
2. **Adaptive resistance.** The damage type that dealt >40% of kills gains +5% resistance in that world per run, capped at +35%; unused types slowly lose resistance. This pushes build variety without forbidding a favourite build.
3. **Ecology and resources.** Heavily mined deposits regenerate slower; untouched worlds become richer but more dangerous (higher tier). Factions can spread to neighbouring worlds on the map if the player ignores a world for several days, creating "invasions" with special rewards.

**Fairness guardrails:** mutations only use blocks the player has already seen; every change is shown on a debrief screen ("The Rustborn grew fire-resistant plating"); a seeded RNG makes every run reproducible for debugging; and a hard difficulty ceiling per tier.

**World eras:** after enough runs a world can hit an evolutionary milestone (an apex species appears as a new boss, the biome visually shifts). This gives long-term players visible, story-like change without a written campaign.

## Progression & retention

The "one more run" feeling comes from short runs, frequent choices, variable rewards and a long goal that is always visibly closer.

| Layer | Cadence | Mechanic |
| --- | --- | --- |
| Moment | every 30–45 s | Level-up card, block snap, evolution fusion |
| Run | 4–8 min | Boss, loot reveal, "new species discovered" |
| Session | 20–30 min | Craft a new permanent block, unlock grid size, beat a world tier |
| Day | daily | Daily mutator world (e.g. "lava everywhere, double pyro-ore"), invasion events |
| Long term | weeks | Research tree, Cab collection, world eras, blueprint library |

Additional hooks: a **Bestiary** that fills as species evolve (collection drive), **Blueprints** you can save and share as a short code string, a **Mastery** level per block type, and an **Endless mode** per world for leaderboards.

Keep it fair: no pay-to-win blocks, no energy timers in v1. If monetized later, cosmetics (paint, decals, cab skins) and a one-time premium unlock work best for this genre's reputation.

## Tuned values (prototype v0.2)

These are the starting numbers for /data/\*.json. They are tuned, not guessed: keep them unless a balance test says otherwise. World units: one player block is 18 units, one enemy block 9; the arena spans ±2,200.

**Player blocks**

| Block | HP | Mass | Power | Special | Craft cost |
| --- | --- | --- | --- | --- | --- |
| Cab | 170 | 3 | +6 | Root; losing it ends the run | starts owned |
| Wheel | 45 | 1 | 0 | Thrust 7, turn 3.6 | 20 scrap |
| Track | 85 | 2 | 0 | Thrust 9, turn 4.6, ignores mud, grips on ice | 30 scrap, 10 copper |
| Hover pad | 30 | 0.6 | −1 | Thrust 6, turn 4.0, immune to lava | 15 crystal, 10 copper |
| Armor plate | 120 | 2 | 0 | Takes 40% of hits aimed at a neighbour | 25 scrap |
| Regen moss | 80 | 1 | 0 | Armor, regrows 4 HP/s | 20 resin, 10 scrap |
| Battery | 40 | 1 | +4 | +1 Tesla chain / +20% laser damage when adjacent | 20 copper |
| Magnet | 40 | 1 | 0 | +90 pickup range (base 100) | 15 copper, 10 scrap |
| Repair arm | 45 | 1 | −1 | Heals adjacent blocks 7 HP/s | 25 resin |

**Weapons** (power −1 unless noted; arc follows block facing unless 360°)

| Weapon | Type | Damage | Rate/s | Range | Arc | Notes | Craft cost | Bot DPS\* |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Autocannon | kinetic | 11 | 4.5 | 300 | 130° | +12% rate per adjacent cannon | 30 scrap | 34 / 22 |
| Scattergun | kinetic | 10 × 6 pellets | 1.6 | 230 | 140° | Spread 0.42 rad | 35 scrap | 29 / 25 |
| Laser | energy | 30 | 1.4 | 360 | 70° | Instant beam, power −2 | 20 crystal, 10 copper | 27 / 23 |
| Tesla coil | electric | 13 | 1.2 | 220 | 360° | Chains 3 (+1 per adjacent battery), jump 175, 90% per jump, power −2 | 30 copper | 48 / 38 |
| Flamer | fire | 7 | 10 | 185 | 80° | Pierces 2, burn 16 DPS for 2 s | 25 pyro, 10 scrap | 22 / 14 |
| Mortar | explosive | 26 | 0.7 | 400 | 360° | Lobbed, 0.85 s flight, 70 splash | 20 pyro, 20 scrap | 47 / 36 |

\*Measured with two identical weapons in the starter build, a kiting bot, 150 s, 6 seeds; Rustlands / Crystal Tundra. Kiting under-rates short-range weapons.

**Enemy blocks**

| Block | HP | Mass | Effect | Drops |
| --- | --- | --- | --- | --- |
| Core | 20 | 1 | Root of every enemy | scrap |
| Spike | 8 | 0.5 | +6 melee DPS (base contact 4) | scrap |
| Plate | 30 | 1.5 | HP only | scrap |
| Gun | 10 | 0.8 | 6 damage shot every 1.8 s, speed 240 | copper |
| Bomb | 6 | 0.6 | Explodes on contact, 24 damage in a 50 radius | pyro |
| Thruster | 6 | 0.4 | +1 thrust | copper |
| Heat plating | 22 | 1.2 | 40% fire resistance | pyro |
| Insulation | 22 | 1.2 | 25% electric, 20% energy resistance | crystal |
| Reactive plating | 24 | 1.4 | 40% explosive, 15% kinetic resistance | resin |

**Formulas**

| System | Rule |
| --- | --- |
| Vehicle speed | clamp(90 × thrust / mass, 40, 290); no propulsion = 28 |
| Power | If demand > supply, every weapon fires at supply / demand (min 15%) |
| Enemy speed | (40 + 160 × (1 + thrust) / (2 + mass)) × species speed gene (0.75–1.35) |
| Enemy cost | 0.6 + HP/40 + (melee + 1.5 × gun + 0.3 × bomb) / 15 |
| Enemy HP scale | (1 + 0.4 × (tier − 1)) × (1 + t/260); damage × (1 + 0.12 × (tier − 1)) |
| Director budget/s | (0.7 + t/38) × (0.8 + 0.2 × tier) × clamp(√((level + 2)/(2 + t/25)), 0.75, 1.5); × 0.35 in breathers, × 0.3 during the apex; cap 60, max 220 enemies |
| Waves | 30 s each; every 4th is a breather with a 14-unit cache; mini-bosses at 2:00 and 4:00 (HP × 10), apex at 5:00 (HP × 16 × (1 + 0.15 × (era − 1))) |
| Contact damage | melee × 0.8 per second to the nearest block |
| XP | Kill = round(cost × 1.3), mini-boss × 8, apex × 25; next level = 5 + 4L + 0.2L² |
| Loot | 40% drop chance (bosses 100% + shards); half world table, half enemy materials; death keeps 50% |
| In-run upgrade card | +25% damage, +12% rate per level for that block type |
| Workshop Mk level L | +20% HP; weapons +15% damage, +5% rate; propulsion +8% thrust; battery/cab +1 power; magnet +25; healing +25%. Cost = craft cost × 1.5 × (L + 1), plus L − 1 shards from Mk III→IV; max Mk VI |
| Hazards | Mud: speed × (0.42 + 0.58 × track share). Ice: grip × (0.18 + 0.82 × track share). Lava: 2.5 damage every 0.25 s × (1 − hover share) |
| Evolution | Fitness = damage/spawn + 0.4 × lifetime/spawn. Top 30% parent, bottom 30% die (min 4 species, max 10). 1–2 mutations; needs ≥ 12 spawns. Resistance +5% for a type with > 40% of kills (cap 35%), −2% below 15% share. New era every 5 generations |

## Lessons from the prototype

What bot testing and play on the iPad taught us, and what the standalone game must keep.

1. **Measure balance, don't eyeball it.** The Tesla felt weak, but the data showed it was fine in the Rustlands and halved in the Tundra by insulation plus evolution stacking on top. The real outliers were the Scattergun and Flamer (3–4× below the cannon). Keep the per-weapon duel test as a permanent CI check.
2. **Kiting is the dominant strategy.** Survivor games reward running away, so short-range weapons need clearly higher damage per hit or extra effects to compete.
3. **Counters must not hard-lock a weapon.** World resistance and species resistance stack; cap their sum at 75% and keep any single plating at 40% or less. Evolution should push variety, not make a favourite build useless.
4. **The starting build must teach facing.** One forward and one rear cannon made the arc system obvious on the first run without a tutorial.
5. **Early runs should end around 3–4 minutes.** The garage and workshop carry long-term progression; a fresh player reaching the apex on run one removes the reason to build.
6. **Bosses must not out-gun the player.** The first apex (55× HP, 5-bullet volleys) was unwinnable; it now has 16× HP and 3-bullet volleys every 1.3 s.
7. **Settle the run's loot before the debrief.** The apex dropped shards after the run had already ended, so they were lost. On a win, all pickups still on the ground are collected automatically.
8. **The damage report is a design tool, not just a reward screen.** It shows which blocks pull their weight and should feed the balance dashboard of the headless sim.
9. **Evolution needs enough data.** Fewer than 12 enemy spawns produce noise, so the GA skips that run and says so.

## Technical architecture

Web-first TypeScript keeps iteration fastest for an AI-built game: every milestone runs instantly in a phone browser, and it installs on your iPad as a home-screen app (PWA) with no App Store account. Capacitor can wrap the same code natively later if ever needed.

&#91;embedded content: module architecture · 4 layers, 13 modules\]

The simulation layer runs without any rendering, which makes it testable, deterministic with a seed, and usable by the headless balance runner. The vehicle stat compiler is shared by player and enemies, so the block system, loot and evolution stay one system.

| Decision | Choice | Why |
| --- | --- | --- |
| Language / build | TypeScript strict + Vite | Fast reload, type safety catches AI mistakes early |
| Rendering | PixiJS v8 (WebGL/WebGPU) | Handles thousands of sprites on mobile |
| Physics | None; custom circle collisions + spatial hash | Arcade feel, predictable, cheap |
| Entity model | Lightweight ECS with typed arrays | 300+ enemies at 60 fps |
| Content | JSON files + zod validation | Balance without code changes |
| Tests | Vitest + headless sim | Catches broken synergies and runaway evolution |
| iPad delivery | PWA via vite-plugin-pwa; Capacitor optional later | No App Store or developer account; installs from Safari, runs offline |
| Alternative | Godot 4 (GDScript) | If you prefer native performance and an editor; slower AI iteration |

## Master prompt for Opus 5.5

Paste this as the system prompt or CLAUDE.md of the build session (best in Claude Code), then give one milestone per request. Attach this whole document as the design reference.

```markdown
# ROLE
You are the lead engineer and game designer of "Scrap Evolution", a mobile
survivor game for iPad (Safari PWA, portrait and landscape). You write production-quality TypeScript, think in
systems, and protect game feel above feature count.

# THE GAME (one paragraph)
The player drives a vehicle built from blocks on a 2D top-down grid
(TerraTech-style: blocks attach to a Cab; disconnected blocks fall off).
Movement uses a floating one-finger joystick; all weapons fire automatically
within their facing arcs (Survivor.io / Archero style). Runs last 4-8 min with
threat-budget waves, level-up cards (new block / upgrade / perk / evolution),
and a boss. Enemies are built from the same block system, drop their blocks as
salvage, and are bred per world by a genetic algorithm after each run. Worlds
have distinct resource tables and hazards, and adapt resistances to the
player's dominant damage type. Full design: see attached design document.

# REFERENCE IMPLEMENTATION (read first)
/prototype/scrap-evolution.html is a working, tuned, single-file prototype
(v0.2). It is the source of truth for behaviour and numbers: block and enemy
data, director, cards, workshop upgrades (Mk I-VI), damage report, GA,
adaptive resistance, hazards, save format. The design doc section "Tuned
values" lists the same numbers. Port it into the module architecture below;
do not redesign mechanics or retune numbers unless a milestone says so. Where
the prototype and the design doc disagree, the prototype wins and you note it.
The prototype's export code (base64 JSON, v: 1) must stay importable.

# TECH STACK (fixed unless I approve a change)
- TypeScript (strict), Vite, PixiJS v8 for rendering, no physics engine
- Lightweight custom ECS (typed component arrays), fixed 60 Hz simulation step,
  render interpolation
- Seeded PRNG for everything random; simulation must run headless (no Pixi)
- Vitest for tests
- Delivery: Progressive Web App for iPad Safari, no App Store. Use
  vite-plugin-pwa: manifest (display: standalone, icons, theme colour),
  service worker for full offline play, an "update available" prompt.
- iPad specifics: safe-area insets, touch-action: none, block pinch and
  double-tap zoom, unlock Web Audio on first touch, cap devicePixelRatio at 2,
  render at display rate (120 Hz ProMotion) with interpolation over the fixed
  60 Hz sim, camera zoom adapts to screen size and orientation.
- Saves in IndexedDB, plus export/import as a text code for backup.
- navigator.vibrate is unsupported on iOS: the haptics hook is a no-op there.
- Capacitor (native app) only later and optional.
- All content is data: /data/*.json (blocks, enemies, worlds, resources,
  cards) validated by zod schemas

# ARCHITECTURE (modules, one folder each under /src)
core (loop, ECS, rng, events) | data (schemas, loaders) | vehicle (block grid,
connectivity, stat compiler, damage + detach) | combat (targeting, projectiles,
damage types, status effects) | enemies (genomes, steering AI) | director
(threat budget, spawn patterns) | evolution (world genome, GA, resistance,
ecology) | economy (resources, crafting, meta progression) | input (floating
joystick) | ui (HUD, card picker, garage editor, debrief) | persistence
(versioned save + migrations) | sim (headless balance runner)
Rules: sim code never imports rendering; modules talk via the event bus or
explicit interfaces; the vehicle stat compiler is shared by player and enemies.

# WORKING RULES
1. Work one milestone at a time. Start each by restating the goal, listing the
   files you will touch, and any assumption. Then implement completely.
2. Every milestone ends in something runnable and playable on a phone browser.
3. No placeholder logic or TODO stubs in delivered code; if something is out
   of scope, say so explicitly.
4. Write unit tests for pure logic (connectivity, stat compiler, director
   budget, GA operators, save migrations).
5. Performance budget: 300 enemies + 500 projectiles at 60 fps on a mid-range
   phone. Use object pools and a spatial hash. Measure, don't guess.
6. Placeholder art = clean procedural shapes with a consistent palette;
   readability first (player, enemies, projectiles, pickups must be distinct).
7. Tunable numbers live in data files, never hard-coded.
8. Before changing a schema or the architecture, propose it and wait.
9. End each milestone with: what was built, how to test it, known issues,
   and 3 tuning knobs I should try.
10. Parity: for every ported system, write a test that runs the same seeded
    scenario as the prototype and compares results (e.g. weapon DPS duel,
    director spawn counts, GA output for a fixed seed) within 5%.
11. Keep the per-weapon DPS duel and a 1,000-run bot sim in CI; fail the build
    if any weapon falls below 60% or above 160% of the Autocannon.

# GAME-FEEL CHECKLIST (apply always)
screen shake scaled to damage, hit flash, damage numbers (toggle), pickup
magnet arc, satisfying block-snap animation + sound hook, slow-mo on level-up,
clear telegraphs for enemy attacks, haptics hook for mobile.

# CURRENT MILESTONE
<paste the milestone from the roadmap here>
```

## Running on your iPad (no App Store account)

The game ships as a Progressive Web App: open its URL in Safari, tap Share → Add to Home Screen, and it launches full-screen from its own icon, offline included. No Apple developer account, no Xcode, no expiry.

1. **While developing:** Claude Code runs `npm run dev -- --host` on your computer; open `http://<computer-ip>:5173` in Safari on the iPad (same Wi-Fi). Changes appear instantly. Offline mode doesn't work over plain http, which is fine here.
2. **For real play:** push the repo to GitHub and let GitHub Pages or Cloudflare Pages (both free, HTTPS) deploy the `dist` folder on every push.
3. **Install:** open that URL on the iPad in Safari → Share → Add to Home Screen. From then on, start it from the icon.
4. **Updates:** the service worker downloads new versions in the background and shows "Update available — restart".

Things to know on iPadOS: install it to the home screen rather than playing in a Safari tab, because iOS can clear website storage of uninstalled sites after weeks without use; still use the save export now and then. Vibration is not available to web apps on iOS, and sound starts only after the first touch.

If you ever want a true native app: Capacitor + Xcode on a Mac can install it with a free Apple ID, but that build expires every 7 days. Only the paid developer account removes that, so the PWA is the better route for personal use.

## Next steps & milestones

The prototype already proved the feel, the loop and the evolution. The standalone game is now a port with parity tests first, then new content.

**Before coding (one evening):**

- [ ] Create a GitHub repo and put the prototype file into `/prototype/scrap-evolution.html`.
- [ ] In the prototype, open World map → Back up save and keep the code; milestone S4 imports it.
- [ ] Install Claude Code. Put the master prompt into `CLAUDE.md` and this document, exported as Markdown, into `/docs/design.md`.
- [ ] Set up free HTTPS hosting (GitHub Pages or Cloudflare Pages) so the iPad can install the game as a PWA.

**Milestones (each = one Opus request, with a gate you check yourself):**

1. **S0 Scaffold:** Vite + TypeScript + PixiJS + Vitest, PWA manifest and service worker, deploy on every push. Gate: an empty app installs on the iPad home screen and opens offline.
2. **S1 Data + simulation core:** port all numbers into `/data/*.json` with zod schemas; port the vehicle compiler, combat, enemies and director as headless code. Gate: the weapon duel and director parity tests match the prototype within 5%.
3. **S2 Rendering + input:** Pixi renderer, floating joystick, camera, HUD, 120 Hz interpolation. Gate: plays like the prototype on the iPad, smooth with 220 enemies.
4. **S3 Screens:** world map, garage with workshop upgrades, level-up cards, placement, pause, debrief with damage report. Gate: the full loop works without the prototype.
5. **S4 Persistence:** IndexedDB save with versioned migrations and export/import. Gate: your prototype save code loads with all progress.
6. **S5 Evolution + balance tooling:** port the GA, resistance and eras; add the 1,000-run bot sim and CI weapon checks. Gate: CI passes and evolution reports read like the prototype's.
7. **S6 New content:** Fungal Marsh and Storm Spires, shielder/splitter/leech enemies, evolution fusion cards, a bestiary screen. Gate: every addition passes the balance checks.
8. **S7 Polish:** audio, slow-mo on level-up, damage numbers toggle, art pass, performance pass. Gate: someone else asks to play it.

**Balancing tip:** from S1 on, let Opus build the headless sim to auto-play 1,000 runs with scripted bots ("kiter", "tank"). This catches broken synergies and runaway evolution long before human testers do.
