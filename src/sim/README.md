# Weapon Lab simulation core (`src/sim/`)

ADR-001 D5 **layer 1**: hand-rolled pure TypeScript, fixed 60 Hz timestep, one seeded
mulberry32 stream, **no renderer / DOM / framework imports** (enforced by `boundaries.test.ts`).
Same seed + loadout + inputs ⇒ bit-identical results at any frame rate (proved in
`determinism.test.ts`). Runs headless in Node. Nothing here is player-visible on its own: the
PixiJS render layer and the HTML HUD (UX_SPEC §3.4) consume this API.

Import only from `src/sim` (the `index.ts` barrel). Everything else is internal.

## Quick start (what the Lab route does)

```ts
import { createLabSim } from '../sim'

const created = createLabSim({ weapon, ammo, buffs, seed: 1 }) // weapon: a parsed Weapon record
if (!created.ok) return renderRefusal(created.refusal)        // LimitationCard / setup prompt
const sim = created.sim

// requestAnimationFrame loop
function frame(dtMs: number) {
  sim.setInput({ attacking: pointerHeld, aim: cursorWorldTiles }) // ignored (config-locked) during timed tests
  const { alpha } = sim.advance(dtMs)       // runs whole 1/60 s ticks, keeps the remainder
  for (const e of sim.drainEvents()) spawnFloatingNumber(e) // see "Events"
  draw(sim.renderState())                   // interpolate prev → current with alpha
  hud(sim.snapshot())                       // stats, mana, timed test, digest
}
```

## Units and coordinates

Tiles (16 px at 1×), ticks (60/s), velocities in tiles/second at every public boundary
(DATA_SCHEMA_SPEC §2 unit rules). World origin = the player's center; **x right, y down**.
Default target: one Target Dummy (2×3 tiles, defense 0) centered at (2, 0) — point-blank.
Multiple Dummies (PRD P3-S6): `dummyRow(count, firstX)` — a row, centres `DUMMY_ROW_SPACING_TILES`
(3) apart, ids `dummy-0…` nearest first; the first is the primary target (auto-aim's dummy).
Dummy roster v2 (PRD P3-S12): a Boss-Sized Dummy is a bigger box (`widthTiles` / `heightTiles`), an
Armored Dummy has `defense`, and a Moving Dummy has a `motion` — from its home (`x`, `y`) `rangeTiles`
along `axis` (`horizontal`: toward +x, away from a player facing it; `vertical`: up, −y) and back, again
and again, at a constant `speedTps`, turning instantly at each end (src/sim/motion.ts — see "Dummy motion").
Summons (PRD P3-S9) are world agents with positions in the same space; the "ground" a ground minion
stands on is its target dummy's foot line (the sim has no terrain).

## API surface

| Export | Purpose |
|---|---|
| `createLabSim(options)` → `{ ok: true, sim } \| { ok: false, refusal }` | Build a sim, or a typed refusal. Never throws on data. |
| `assessWeapon(weapon)` → `{ simulable: true, archetype, requiresAmmoClass, requiresBuffIds } \| { simulable: false, refusal }` | Weapon-only verdict (no ammo/buffs needed). Use it for the in-Lab browser's "simulated vs limitation" badge (P3-S2) and the coverage report (P3-S13). |
| `cadenceTicksFor(weapon, useAnimationTicks)` | The effective ticks per attack, incl. the weapon's reuse delay (see "Cadence"). |
| `APPROXIMATIONS`, `sim.approximations` | Plain-language assumptions; `sim.approximations` is the subset for the equipped weapon — render it verbatim in the AssumptionsTip paired with every EstimateLabel. Modeling-convention entries carry a `ruling` (see "Modeling conventions"). |
| `IMPLEMENTED_ARCHETYPES` | Every schema archetype since P3-S11: `swing-melee`, `thrust`, `bow-gun`, `magic-bolt`, `returning`, `piercing-beam`, `minion-sentry`, `whip`, `explosive-aoe`. |
| `dummyRow(count, firstX?, spacingTiles?)`, `DUMMY_ROW_SPACING_TILES` | Multiple Dummies: a row of standard dummies (see "Units and coordinates"). |
| `dummyPathOffset(motion, tick)`, `DEFAULT_DUMMY_WIDTH_TILES`, `DEFAULT_DUMMY_HEIGHT_TILES` | P3-S12: a Moving Dummy's distance from home at a world tick (the closed form the kernel uses); the standard dummy's 2 × 3-tile size (a Boss-Sized Dummy scales it). |
| `DEFAULT_LAB_SETTINGS`, `DEFAULT_DUMMY`, `DEFAULT_SEED`, `TIMED_TEST_DURATIONS`, `timedTestTicks`, `TICKS_PER_SECOND`, `BASE_CRIT_PCT`, `MAX_MINION_SLOTS`, `MAX_SENTRY_SLOTS`, `WHIP_TAG_DURATION_TICKS`, `GROUND_Y_TILES`, `mulberry32` | Constants / utilities (`GROUND_Y_TILES`: the flat ground the player and the default dummies stand on — a thrown explosive lands on it; the Lab arena draws its ground line there). |
| `type *` from `./types` | All public types (`LabSim`, `SimSnapshot`, `SimEvent`, `RenderState`, `SimRefusal`, …). |

### `LabSimOptions`

| Field | Notes |
|---|---|
| `weapon` | A schema `Weapon`. Required fields are read through `getField`; unverified ⇒ refusal. |
| `seed?` | uint32 (default 1). |
| `ammo?` | Required for `bow-gun`: an `Item` whose `ammoStats.ammoClass` equals the weapon's. |
| `buffs?` | Buff registry; required when the weapon has `modifiers.dot`. |
| `dummies?` | `DummySpec[]` — `{ id?, x, y, widthTiles?, heightTiles?, defense?, motion? }` (boss-sized = bigger box, armored = `defense`, moving = `motion: { axis, speedTps, rangeTiles }`; a malformed one is `invalid-dummy`). |
| `settings?` | Partial `LabSettings` (below). |
| `arena?` | Projectile despawn bounds (must contain the origin). |
| `minionLoadout?` | P3-S10 summoner loop: a MINION summon weapon whose minions are out beside the equipped (non-summon) weapon — every world starts with as many as the minion slots hold (`Behavior.fillSlots`); their hits use the loadout weapon's crit (0) and modifiers (its DoT). Not simulable, a sentry weapon, or beside a summon weapon → `invalid-setup` / `invalid-loadout`. |

`LabSettings` (defaults in `DEFAULT_LAB_SETTINGS`):

| Setting | Default | Meaning |
|---|---|---|
| `ignoreMana` | `false` | "ignore mana (test mode)": never blocks, pool stays full, costs still counted in `manaConsumed`. Show the amber chip. |
| `maxMana` | `200` | Capacity (20 base + 9 crystals; wiki Mana). |
| `manaRegen` | `'wiki-1.4.5.7'` | Or `'none'`. |
| `insufficientMana` | `'slow-cast'` | `'slow-cast'` (AMENDMENTS-008 B35): the pinned 1.4.5.8 game rule — since 1.4.5.7 a magic weapon without enough mana still casts, at 40% attack speed (use time × 2.5; [wiki Mana](https://terraria.wiki.gg/wiki/Mana)); paying nothing on such casts is a labeled assumption. `'block'`: the labeled "stop at zero" test setting — casting stops until mana covers the cost. |
| `homingEnabled` | `true` | P3-S8 AC2 toggle. |
| `damageVariance` | `true` | Wiki ±15% per-hit variance; `false` gives constant per-hit numbers. |
| `minionSlots` | `1` | 1..`MAX_MINION_SLOTS` (11). VERIFIED default and maximum ([wiki Minion-summoning weapons](https://terraria.wiki.gg/wiki/Minion-summoning_weapons)); stands in for gear until P3-S14. Lowered mid-world: the oldest minions leave first (in-game: random). |
| `sentrySlots` | `1` | 1..`MAX_SENTRY_SLOTS` (6), VERIFIED ([wiki Sentry-summoning weapons](https://terraria.wiki.gg/wiki/Sentry-summoning_weapons)). |

### `LabSim` methods

| Method | Behavior |
|---|---|
| `advance(dtMs)` → `{ ticksRun, alpha }` | Feed the frame delta. Clamped to 250 ms per call (tab switches); clamped time is dropped, which delays but never changes results. |
| `step(n = 1)` → ticks run | Headless stepping. |
| `setInput({ attacking?, aim? })` | `aim: null` auto-aims at the first dummy. Rejected with `config-locked` during a timed test. |
| `updateSettings(patch)` | Validated; `config-locked` during a timed test. |
| `reset({ seed? })` | **The single ResetButton action**: stats, projectiles, debuffs, mana, RNG (re-seeded), timed test aborted. Input and dummies are kept. |
| `setDummies(dummies, { seed? })` | Replace the target dummies (e.g. `dummyRow(3, 6)`), then a full `reset()`. `config-locked` during a timed test; invalid dummies → `invalid-dummy` (current ones kept). |
| `resetStats()` | Zero stats + graph only (world keeps running). |
| `startTimedTest(10 \| 30, { seed? })` | Full reset, then exactly 600/1800 ticks with attack held and aim frozen; config locked; then the sim **halts** (`advance`/`step` run 0 ticks) until `reset()` or another `startTimedTest` ("Run again" reproduces the result exactly). |
| `snapshot()` | Plain-data `SimSnapshot` (safe to keep; deep copies). |
| `renderState()` | Positions for the renderer (`alpha` included). |
| `drainEvents()` | Pending events, oldest first; clears the queue. |
| `weapon` | `WeaponSummary`: `cadenceTicks` (incl. `reuseDelayTicks`), `nominalAttacksPerSec`, `critChancePct`, `baseHitDamage` (after a projectile's `damageMultiplierPct`), `manaCostPerUse`, `returnsToHand` (a returning weapon: an attack lasts until it is back), `consumable` (a thrown explosive: each throw uses the item itself up), … for the EquippedBar. |
| `loadout` | The minion loadout's `WeaponSummary`, else `null`. `approximations` lists the weapon's, then the loadout's (deduplicated), then the target's: `dummy-motion` while a moving dummy is among the current dummies (it follows `setDummies`). |

### HUD mapping (UX_SPEC §3.4)

| HUD element | Source |
|---|---|
| Per-hit damage | `stats.lastHit` (`amount`, `crit`) |
| Total damage / hits / crits | `stats.totalDamage`, `stats.hits`, `stats.crits` (DoT ticks are not hits) |
| Attacks/sec | `stats.attacksPerSec` (session) or `weapon.nominalAttacksPerSec` |
| Est. DPS (EstimateLabel) | `stats.estimatedDps` (session average); `stats.rollingDps` = trailing 1 s |
| DpsGraph | `stats.dpsSeries` (completed seconds, oldest first; `seriesStartSecond` offset) + `currentSecondDamage` |
| DoT breakdown | `stats.dotDamage`, `stats.directDamage`, `stats.debuffsApplied`, `renderState().dummies[].debuffs` |
| ManaBar | `snapshot().mana` (`null` for weapons without a mana cost) |
| AmmoCounter | `stats.ammoConsumed` |
| Consumables counter (P3-S11: "Explosives used") | `stats.consumablesUsed` (`weapon.consumable`); a finished test's `result.consumablesUsed` — and `result.explosions` (the rest were still on their fuses at the end) |
| Blast readout (P3-S11 AC1) | event `explosion` (centre, `radiusTiles`) + its `damage` events (same `sourceId`, each with `blastKeptPct`) |
| Debuff Dummy (P3-S11 AC3) | `renderState().dummies[].debuffs` (`buffId`, `remainingTicks`, `durationTicks`); `stats.debuffsApplied` |
| TimedTestControl | `snapshot().timedTest` (`status`, `remainingSec`, `result`) — announce `finished` via `aria-live` |
| Multiple dummies (primary = first dummy vs all) | `stats.perDummy[id]`; a finished test's `result.perDummy` |
| Summons vs slots (P3-S9) | `snapshot().summons` (`minions`, `minionSlotsUsed`, `minionSlots`, `sentries`, …); positions `renderState().agents` |
| Damage by source (P3-S9 AC3, P3-S10 AC2/AC3) | `stats.breakdown` / `result.breakdown`: `weaponDamage` (+ hits) + `summonDamage` (+ hits) + `dotDamage` = total; `tagBonusDamage` ⊂ `summonDamage` |
| Whip tags (P3-S10 AC1) | `renderState().dummies[].tag` (`remainingTicks`, `durationTicks`, `damageFlat`, `critPct`); events `tag-applied` / `tag-expired` |
| Moving Dummy (P3-S12 AC2): where it is, its path, missed shots | `renderState().dummies[]` `prevX/prevY → x/y` (interpolate with `alpha`) and `path` (`fromX/fromY` = home → `toX/toY`; frame and draw the whole path once); `stats.projectilesMissed` of `stats.projectilesSpawned` — a projectile that despawned without landing a hit (out of bounds, lifetime, back in hand, or gone off with no dummy in its blast); a finished test's `result.projectilesMissed` / `result.projectilesSpawned` |
| Boss-Sized / Armored Dummy (P3-S12 AC1 / AC3) | `renderState().dummies[]` `width` / `height` / `defense` (the spec's) — every hit's `amount` already has the defense applied (see "Damage math") |

### Events (`SimEvent`, deterministic log)

`use-start`, `use-blocked` (`block` setting only; once per out-of-mana streak), `projectile-spawn`,
`projectile-despawn` (`pierce-exhausted` / `lifetime` / `out-of-bounds` / `returned` — a returning
weapon caught: the next attack may start on the following tick — / `detonated` — a thrown explosive went
off), `explosion` (P3-S11: `projectileId`, centre `x` / `y`, `radiusTiles`; emitted before its hits), `damage`
(`source: 'melee' | 'projectile' | 'dot' | 'minion' | 'sentry'`, `sourceId` `use:<n>` / `proj:<id>` /
`beam` / `buff:<id>` / `minion:<agentId>` / `sentry:<agentId>`, `amount`, `crit`, `x`, `y` = impact
point, and on a summon's hit on a whip-tagged dummy `tagBonus` — see "Summons and whips"; on a blast's
hit `blastKeptPct` — the whole percent of the blast's damage it took, 100 without falloff; crits render
larger, DoT smaller), `debuff-applied` (`refreshed`), `debuff-expired`, `summon` (`agentId`, `kind`,
`x`, `y`, `loadout`), `dismiss` (`replaced` / `slots`), `tag-applied` (`refreshed`), `tag-expired`.
Every event has `tick` and `seq`. `snapshot().eventDigest` is an FNV-1a fingerprint of the whole
stream since the last reset.

### Render state

`renderState()` → `player`, `facing`, `aim`, `dummies[]` (center, `prevX/prevY` — the centre a tick earlier,
equal to it for a dummy that never moves — `path` (a Moving Dummy's two ends, else null), size, defense, active debuffs —
`buffId`, `remainingTicks` and the `durationTicks` they were last (re)applied with), `projectiles[]` (`prevX/prevY` → `x/y`, velocity in tiles/s, `spriteKey`; a returning
weapon in flight is its one projectile), `blade` (`swing` | `thrust` | `beam` | `whip`: `prevAngle →
angle`, `prevLength → length`, radians, 0 = +x, π/2 = down; a `beam` runs from the player along
`angle` for `length` tiles while the attack is held; a `whip`'s `length` is its range), each dummy's
whip `tag`, and `agents` (minions and sentries, oldest first: `kind`, `aiClass`, `prevX/prevY → x/y`,
`facing`, `targetId`, `lastAttackTick`, `loadout`). Interpolate with `alpha`.

## Refusals (render, don't guess)

`refusal.kind === 'not-simulable'` → LimitationCard / banner:

| `reason` | UI |
|---|---|
| `limitation` | LimitationCard from `refusal.limitation` (`inGameBehavior`, `reason`, `sourceUrl`). |
| `custom-scenario` | Custom-scenario banner (`scenarioId`). |
| `archetype-not-implemented` | Not-simulated card. Unreachable with schema data since P3-S11 (every archetype is registered); kept as defense in depth. |
| `modifier-not-implemented` | bounce / chain (the registry stubs throw `NotImplementedError`; the guard turns that into this result); homing on a returning weapon, a held beam, a whip, a summon or a thrown explosive (their flight / line / sweep / attack / arc ignores steering — refused, never ignored); multiHit on a thrown explosive (one explosion hits each dummy once). |
| `missing-required-field` / `unverified-required-field` | `fields` lists dot-paths. Normally unreachable: the pipeline downgrades such weapons to limitations (§2.1 rule 3); this is defense in depth. |
| `invalid-data` | Contradictory or malformed values. |
| `dependency-data-unavailable` | The chosen ammo or referenced buff lacks verified data (e.g. ammo with no damage value). |

`refusal.kind === 'invalid-setup'` → user-fixable: `ammo-required`, `ammo-incompatible`,
`buff-registry-required`, `invalid-settings`, `invalid-dummy`, `invalid-arena`, `invalid-loadout`.

Required weapon fields for every archetype: `damageClass`, `damage`, `critPct` (NOT for summon-class
weapons — AMENDMENTS-013 B64: summon damage cannot crit, B17, so the pipeline emits no `critPct` for
any whip, minion or sentry weapon; a present value is still checked, a listed-unverified one still
blocks; NOR for classless weapons — P3-S11 / AMENDMENTS-015 B85(b): the wiki Critical hit page says
damage of no class "can never deal critical hits", so their `critPct` is not applicable — the pipeline
emits it absent and not listed (B17's "Unknown" superseded), and a record that still lists it is not
blocked either (`simRequiredWeaponFields(archetype, damageClass)`) — labeled `classless-crit`; a present
value is still checked), `useTimeTicks`, `useAnimationTicks`;
plus `shootSpeedTps` (bow-gun, returning, explosive-aoe, and piercing-beam `pierce-projectile` params
without a projectile spec) and `manaCost` (magic-bolt). `autoReuse`/`manaCost`/`reuseDelayTicks` may be absent (defaults: false / no cost /
no cooldown) but block if listed unverified. Any `labBehavior.*` path or
`simRequiredWeaponFields(archetype)` path listed unverified blocks (mirrors the pipeline rule). A
`_prov.modeledFields` path that no ratified modeling convention governs is `invalid-data` (B49:
a modeled value is never silent).

## Cadence (which use-time field drives the attack rate, and why)

- **Attack cadence = `useAnimationTicks`.** AMENDMENTS-004 B14: the wiki's "use time" is Iteminfo
  `useAnimation`, which is what the game waits between uses. `useTimeTicks` would overstate the
  rate of e.g. the Copper Broadsword (useTime 20 vs useAnimation 21).
- **Autoswing melee attack one tick sooner**, as the wiki documents: "the actual use time
  (`useAnimation`) of autoswing melee weapons is one tick lower than the `useAnimation` stated"
  (https://terraria.wiki.gg/wiki/Use_time). Applied when `damageClass === 'melee' && autoReuse`.
- **Reuse delay (`Weapon.reuseDelayTicks`, Iteminfo `reuseDelay`) is a cooldown AFTER each use**
  (AMENDMENTS-010 B48(a)). VERIFIED ([wiki Use time](https://terraria.wiki.gg/wiki/Use_time)):
  "reuseDelay is applied after the itemAnimation counter turns to zero"; the Clockwork Assault Rifle
  (useTime 4, useAnimation 12, reuseDelay 14) has a "14-tick interval between the three round
  bursts", and its article: "adding a cooldown of 14 ticks (0.23 seconds) after each useAnimation".
  So the attack interval is useAnimation (autoswing-adjusted) **+ reuseDelay** (26 ticks for the
  rifle). **Finding:** before this change the cadence omitted it — a reuse-delay weapon would have
  attacked up to 2.5× too often (Sky Fracture 12 vs 12 + 18 ticks) — which is why P3-S0 kept the
  three reuse-delay family weapons as limitations. 33 emitted weapons carry a reuse delay (mostly
  minion staves, 2 ticks). No activation, swing or stab happens during the cooldown; the blade pose
  is `null`. Two interactions the wiki does not document are Lab choices (no emitted simulable
  weapon has both a reuse delay and a mana cost): low-mana `slow-cast` stretches the use but not the
  cooldown, and mana regenerates at the not-casting rate during the cooldown. Both are labeled
  approximations (`slow-cast-cooldown`, `cooldown-mana-regen`; AMENDMENTS-012 B57(e)), shown for any
  weapon with both.
- **`useTimeTicks` is the activation interval inside one use.** Shots/emissions happen at offsets
  0, useTime, 2·useTime, … < use length (wiki: Golden Shower 6/18 "firing 3 times per" use).
  `projectilesPerUse` is spawned **per activation**; ammo is paid per activation, mana once per use.
- Every weapon repeats while attack is held (as if auto-reuse); this is listed as an assumption.

## Damage math (verified against the wiki, 2026-10-13)

Order (wiki Damage): **variance → defense → crit**.
- Variance: ×0.85–1.15, rounded half-to-even ([Damage](https://terraria.wiki.gg/wiki/Damage)); drawn in whole percent steps.
- Defense: `⌊damage − defense/2⌋`, minimum 1, no difficulty scaling for enemies ([Defense](https://terraria.wiki.gg/wiki/Defense)). Armor penetration and per-difficulty multipliers: out of scope.
- Crit: `4% + weapon critPct` for melee/ranged/magic, ×2 after defense; summon and classless never crit ([Critical hit](https://terraria.wiki.gg/wiki/Critical_hit); AMENDMENTS-004 B17) — except a minion's or sentry's hit on a dummy tagged by a whip with a tag critical strike chance ([Whips](https://terraria.wiki.gg/wiki/Whips): "the only way summons can deal critical hits"). `BASE_CRIT_PCT = 4` is a labeled constant.
- Whip tag on a summon hit: the tag damage joins the hit's base damage BEFORE variance and defense (the wiki says only that it "is added to the damage dealt" — a labeled Lab choice, `whip-tag`); its crit chance is the hit's. `tagBonus` = the hit's amount minus what the same variance roll deals without the tag (no tag damage, no crit) — exact integer attribution.
- Bow/gun: weapon damage + ammo damage (wiki Damage).
- Per-projectile percentage (`ProjectileSpec.damageMultiplierPct`, AMENDMENTS-010 B48(b)): the
  projectile's base damage is ⌊damage × pct / 100⌋ before variance — rounded down as in the wiki's
  own figures (Sapphire Staff "60% of the weapon's damage (10 base damage)" for 18; Amber Staff
  "80% … (16 base damage)" for 21). Set only from a quoted wiki percentage.
- Knockback ignored: hits never move a dummy (Target Dummy is "unresponsive to knockback", [Target Dummy](https://terraria.wiki.gg/wiki/Target_Dummy)); a Moving Dummy keeps to its path.
- Armored Dummy (P3-S12 AC3): its `defense` goes through the same verified formula above — nothing else is
  modeled for it (no armor penetration, no difficulty scaling, no damage reduction).

## Determinism contract

- One mulberry32 stream, drawn only inside `tick()` in a fixed order (see `world.ts` header). Every
  damage value is an integer, so totals are exact.
- Frame rate only changes how many ticks run per `advance()` call, never what a tick does; timed
  tests count ticks, not wall time.
- **Dummy motion (P3-S12)** is a closed form of the world tick, never integrated: at the start of the tick
  that reaches tick t (kernel step 0, world.ts header) a moving dummy's centre is home + direction ×
  `dummyPathOffset(motion, t)` = the distance `speedTps × t ÷ 60` folded into the 0 → `rangeTiles` → 0
  path (a triangle wave), its box rebuilt from the spec's size — so no rounding accumulates, every world
  starts it at home (reset, `setDummies`, a timed test: "Run again" reproduces), and hits and the
  auto-aim that tick see it where it is. The auto-aim never leads it. Proven in `dummies.test.ts`
  (bit-identical across `step` chunking and jittered `advance`, exact over 100 k ticks) and by the
  Moving scenarios in `determinism.test.ts` (30/60/144 fps, jittered, spiky; golden-pinned).
- Proven in `determinism.test.ts` across 30/60/144 fps, jittered and spiky frame patterns, and
  arbitrary `step()` chunking. A pinned golden fingerprint catches unintended semantic drift;
  intentional changes re-pin it with a [Changelog](#changelog) entry (AMENDMENTS-008 B38).
- Limitation: `Math.sin/cos/atan2` are engine-implemented, so results are bit-identical within one
  JS engine (V8 in Node and Chrome); low-order bits could differ across engines (e.g. Firefox).

## Extending

- **New archetype** (every schema archetype is registered since P3-S11): add `interpreters/<name>.ts` implementing
  `ArchetypeInterpreter` (`prepare` → `Behavior` with `activate` / optional `tickUse` / `ready` /
  `blade` / `fillSlots`), register it in `interpreters/index.ts` — which also flips the pipeline's
  recorded "params complete, pending interpreter" weapons on the next `npm run pipeline:build`
  (AMENDMENTS-013 B61). The kernel does not switch on archetype; its generic hooks are a use gate
  (`Behavior.ready`), guided projectiles (`ProjectileLaunch.guide`: steer / stop at a hit / `caught`),
  per-world persistent hit sources (`KernelApi.persistentSource`), `attacking` / `arena` /
  `activeProjectiles` / `autoAim` / `freshPress` on `KernelApi`, and (P3-S9/S10) persistent AGENTS
  (`summon` / `dismiss` / `agents`, each stepped by its own `AgentBrain` after the use cycle), a
  per-hit damage override (`strike(…, damage)`), hit OWNERS (`HitSource.owner`: another weapon's crit
  and modifiers — the minion loadout's), whip TAGS (`tagDummy`, `focusIndex`) and (P3-S11) area hits:
  `explode` (one hit per dummy in a circle, with falloff), a guide's `touch` (a contact that is no hit)
  and `detonated` (removal after an explosion), `consumeItem` (a consumable weapon used up). A `Behavior` is
  shared by every world a sim builds (reset makes a new world): it keeps no per-world state of its own
  (per-agent state lives in its brain, per-use state may be keyed by the `ActiveUse`).
- **New modifier** (bounce, chain): replace the throwing stub in `modifiers.ts` with a
  `ModifierRuntime` using the hooks in `contracts.ts`. Bounce/chain will likely need one more hook
  (projectile-hit → redirect); add it to `ModifierRuntime` and call it from the projectile step.

## Approximations

See `approximations.ts` for the user-facing copy. Summary (✓ = rule verified on the wiki,
◇ = Lab modeling choice):

| Id | Kind | Note |
|---|---|---|
| fixed-tick | ✓ | 60 ticks/s. |
| crit-base, defense, damage-variance | ✓ | Rules verified; variance in whole-percent steps ◇. |
| cadence | ✓ | B14 + autoswing −1 tick. Copy reworded in plain language (B48) — the Lab's local `inPlainWords` cadence override (src/lab/labAssumptions.ts) is now redundant (and lacks the reuse-delay entry's context); remove it in the next Lab pass. |
| reuse-delay | ✓ | Cooldown after each use added to the attack interval (B48(a)); shown only for weapons with one. |
| auto-reuse | ◇ | Held attack repeats every weapon at full rate. |
| melee-once-per-use | ◇ | One hit per dummy per swing/thrust unless multiHit. |
| swing-geometry | ◇ | Sweeping line of `reachTiles` over `arcDegrees`, centered on facing. |
| thrust-geometry | ◇ | Triangle extend/retract toward the aim. |
| thrust-reach | ◇ B46 | Reach = sprite diagonal × scale ÷ 16 + 1 tile — modeling convention; shown when `modeledFields` lists it. |
| projectile-point | ◇ | Points with swept collision; no tile collision, no per-projectile hitbox. |
| projectile-damage | ◇ | Projectiles deal weapon (+ammo) damage × a quoted `damageMultiplierPct` (rounded down); nothing else per projectile. |
| spread | ◇ | Even fan for multi-projectile; seeded random inaccuracy for single projectiles. |
| slight-spread | ◇ B47 | "Slight spread" with no stated angle = 10° — modeling convention; shown when `modeledFields` lists it. |
| gravity | ◇ | Generic constants (15-tick delay, 0.1 px/tick², 16 px/tick cap) — NOT verified game values. |
| projectile-lifetime | ◇ | 600-tick cap when the data gives none (not a game value). |
| no-shared-immunity | ◇ | Separate projectiles never block each other's hits. |
| ammo | ◇ | One ammo per activation; no ammo saving (chances, or burst weapons such as the Clockwork Assault Rifle where only the first shot uses ammo); speed = (weapon + bonus) × multiplier. |
| mana-cost | ◇ | Paid once per use. |
| mana-regen | ✓ | 1.4.5.7+ formula, standing still, no bonuses. |
| insufficient-mana | ✓/◇ | Default `slow-cast` = verified 1.4.5.7+ rule (B35), paying nothing ◇; `block` = stop-at-zero test setting. |
| slow-cast-cooldown | ◇ B57(e) | A slow cast (× 2.5) does not lengthen the reuse-delay cooldown after it — undocumented; shown when the weapon has a mana cost and a reuse delay. |
| cooldown-mana-regen | ◇ B57(e) | Mana regenerates at the not-casting rate during the reuse-delay cooldown — undocumented; shown when the weapon has a mana cost and a reuse delay. |
| homing | ◇ | Nearest dummy in range; velocity-direction blend by `strength`, speed kept. |
| dot | ◇ | dps from the Buff; ignores defense, no crit, refresh-not-stack — undocumented on the wiki. |
| multi-hit | ◇ | `localImmunityTicks` re-hit cooldown per source per dummy. |
| knockback | ✓ | Ignored: hits never push a dummy (the Target Dummy is unaffected; a Moving Dummy keeps to its path). |
| dummy-hitbox | ◇ | 2×3 tiles = placed size ✓; NPC pixel hitbox undocumented. |
| boomerang-flight | ✓/◇ | Turns back at its first hit ✓ (wiki Combat Wrench: most boomerangs "instantly turn around after hitting enemies") or at its throw range; back at the throw speed ◇ (in-game it returns faster); one out at a time ◇. |
| flail-launch | ✓/◇ | Extends until it strikes or reaches its length, then retracts ✓ (wiki Flails); retract speed = extend speed ◇ ("slightly faster", no number); the struck dummy isn't hit again on the way back ◇. |
| yoyo-control | ✓/◇ | Re-hits every 10 ticks ✓ (wiki Yoyos); follows the aim within its reach at the weapon velocity, stays out while held ◇; spin-time limit, bouncing and its own acceleration not modeled. |
| beam-geometry | ◇ | A line from the player toward the current aim to the arena edge, through every dummy; one hit per dummy per `tickRateTicks`; off while released and during a cooldown. |
| whip-swing | ✓/◇ | A line of `rangeTiles` sweeps the arc once per use, one hit per dummy per swing; each further dummy takes the wiki multihit penalty off the previous hit, rounded down ✓ (a 0-damage dummy isn't hit); never crits ✓; segmented hitbox not modeled ◇. |
| whip-tag | ✓/◇ | 4 s tag ✓ ([Whips](https://terraria.wiki.gg/wiki/Whips), `WHIP_TAG_DURATION_TICKS`), refreshed by a new strike; tag damage on minion/sentry hits ✓ added before variance/defense ◇; tag crit chance ✓; summons focus the last whipped dummy ✓; no whip stacking, no minion tag multipliers ◇. |
| summon-slots | ✓/◇ | 1 minion / 1 sentry slot by default ✓, slot cost; a full summon replaces the OLDEST ◇; a held attack summons only into free slots ◇ (a new press replaces). |
| summon-attack | ◇ | One attack per `attackRateTicks`, every attack lands, first one interval after appearing, rhythm kept on target switches; movement drawn, not simulated. A minion appears at the aim point (auto-aim: beside the player). |
| summon-target | ✓/◇ | The last whipped dummy ✓ (a sentry: if in range), else the nearest to the player (a sentry: to itself, within range) ◇. |
| minion-melee-contact / -ground-melee / -hover-strike / -ranged-shot | ◇ | The B63 P-6 classes' Lab models (minionSentry.ts header); a ranged shot without a data speed lands the tick it is fired. |
| sentry-placement | ◇ | Exactly at the aim point (auto-aim: 2 tiles ahead), never moves; attacks dummies whose centre is within `sentryRangeTiles`; the 10-minute lifetime is not modeled. |
| classless-crit | ✓ | A classless weapon never crits ([Critical hit](https://terraria.wiki.gg/wiki/Critical_hit): "can never deal critical hits") — not applicable, never Unknown (AMENDMENTS-015 B85(b)). Shown for damage class "other". |
| explosive-throw | ◇ | Thrown at the throw speed in an arc (generic gravity) that lands on the ground below the aim point, where it rests — no bounce, roll or stick; flat ground only. |
| explosive-fuse | ✓/◇ | Goes off `fuseTicks` after the throw ✓ (wiki: "explodes N seconds after being thrown"), wherever it is; passes through dummies without a hit ◇; a short timed test ends before the last throws go off. |
| explosive-impact | ◇ | Goes off at its first dummy touch (no hit of its own) or when it lands. |
| blast-area | ✓/◇ | One explosion per throw ✓; every dummy whose hitbox reaches into the radius takes one hit ◇; knockback, self-damage, self-knockback, blocks and liquids not modeled. |
| blast-falloff | ◇ | `linear` only: 100 % at the centre → 0 % at the edge by the distance to the nearest hitbox point, whole percent rounded down — a Lab formula (no wiki curve). |
| explosive-consumable | ◇ | One item used per throw (`consumablesUsed`); never runs out. |
| dummy-motion | ◇ | P3-S12 Moving Dummy: a straight back-and-forth path at a constant speed, instant turnaround, never pushed off; Space / timed tests aim where it is without leading; summon attacks still land. Listed while a moving dummy is a target. |

## Modeling conventions (AMENDMENTS-010 B44 / B46 / B47, AMENDMENTS-013 B63, record marker B49)

Some archetype params are not stated by the wiki and come from a ratified **modeling convention**
(`MODELING_CONVENTIONS` in src/schemas/weapon.ts — each names its ruling). A weapon lists every
such param path in `_prov.modeledFields`; the guard maps each entry to its convention and adds that
convention's labeled approximation (with `ruling`) to `sim.approximations`, so the AssumptionsTip
always says the value is modeled. A listed entry no convention governs is refused (`invalid-data`).

**Entry format (AMENDMENTS-014 B72(b), binding):** an entry is the param's dot-path
(`labBehavior.params.<param>`); where more than one convention governs that path for the archetype
it MUST be qualified `<path>#<convention id>` (e.g.
`labBehavior.params.attackRateTicks#summon-hit-cap`). An unqualified entry for a shared path resolves
to no convention and is refused — it can never pick up the wrong label (`modelingConventionFor`).

| Convention | Ruling | Params | Engine label |
|---|---|---|---|
| swing-geometry | B44 | swing `arcDegrees`, `reachTiles` | none here — the Lab UI's own `swing-reach-arc` assumption labels it (src/lab/labAssumptions.ts); fold it into the engine registry when the Lab drops its local copy |
| thrust-reach | B46 | thrust `reachTiles` | `thrust-reach` |
| slight-spread | B47 | bow-gun `spreadDegrees` (10°) | `slight-spread` |
| whip-arc | B63 P-1 | whip `arcDegrees` (180° forward; every whip record) | `whip-arc` |
| summon-average-rate | B63 P-2 | minion-sentry `attackRateTicks` — shared path: entry `…attackRateTicks#summon-average-rate` | `summon-average-rate` |
| summon-hit-cap | B63 P-3 | minion-sentry `attackRateTicks` (an UPPER BOUND) — shared path: entry `…attackRateTicks#summon-hit-cap` | `summon-hit-cap` |
| square-blast-radius | B63 P-5 | explosive-aoe `blastRadiusTiles` (inscribed circle of a stated square area) | `square-blast-radius` |

The whip and summon-rate B63 labels surface with the whip / minion-sentry interpreters (P3-S9 / P3-S10,
2026-10-14), `square-blast-radius` with the explosive-aoe interpreter (P3-S11, 2026-10-14).

The pipeline applies B46 only where the weapon's article states no range. Where it states one, that
range is the thrust `reachTiles` (AMENDMENTS-012 B56): extracted wiki data, not listed in
`modeledFields`, so no `thrust-reach` label (the gap report keeps the B46-vs-stated table as a
calibration record).

## Param semantics (AMENDMENTS-008 B37 — binding for pipeline / overlay authors)

`ProjectileSpec.pierce` = extra dummies passed through after the first hit (0/absent = stops at the
first); `projectilesPerUse` = projectiles per activation (bursts come from useTime < useAnimation,
never from projectilesPerUse); ammo `ProjectileSpec.velocityTps` is not used for speed (only
`velocityBonusTps` / `velocityMultiplier`); magic-bolt speed = `params.projectile.velocityTps` (not
`weapon.shootSpeedTps`); `ProjectileSpec.damageMultiplierPct` = % of the damage the projectile would
otherwise deal, rounded down.

**returning** (P3-S7) — the weapon itself flies at `weapon.shootSpeedTps`, out and back; one out at a
time (the next use waits until it is caught). Each `variant` requires its family's documented flight
(any other combination is `invalid-data`): `boomerang` and `flail` = `auto-return` + `fire-and-forget`
(straight toward the aim latched at the throw; turns back at its first hit — wiki Combat Wrench / Flails
— or at `throwRangeTiles`; back straight to the player); `yoyo` = `tethered` + `cursor-follow` (toward
the current aim, clamped to `throwRangeTiles` from the player, while attack is held; back when released).
A *pass* is one way (out, back; a yoyo's time out is one pass). `hitsPerPass` = max hits on each dummy
per pass; absent = once per dummy per pass, except that a yoyo re-hits every 10 ticks (wiki Yoyos); a
weapon `multiHit` sets the re-hit interval instead; hitsPerPass > 1 with no re-hit interval is
`invalid-data`. Turning starts a new pass (pass-scoped blocks lift; a running re-hit cooldown stays),
except that the dummy which turned it isn't hit again on the way back.

**piercing-beam** (P3-S6) — `pierce-projectile`: one projectile per activation; `pierce` = extra
dummies after the first (as B37), `infinite` = all on its line; speed = `projectile.velocityTps`, else
`weapon.shootSpeedTps`; a `projectile.pierce` that differs from `pierce` is `invalid-data`; the params
carry no ammo, so a weapon with `ammoClass` is refused. `channel-beam`: while a use is in progress AND
attack is held, a line from the player toward the current aim to the arena edge hits every dummy on it
once per `tickRateTicks` (a per-world hit source, so the cadence runs on across uses); mana per use as
any weapon; damage × `projectile.damageMultiplierPct` when a projectile spec is given.

**minion-sentry** (P3-S9) — a use summons ONE agent: `variant` `minion` (at the aim point; auto-aim:
beside the player) or `sentry` (exactly at the aim point, stationary; auto-aim: 2 tiles ahead).
`slotCost` counts against `minionSlots` / `sentrySlots`; full slots → the oldest of that kind is
dismissed (`replaced`); a cost above all the slots summons nothing. `Behavior.ready` lets a HELD attack
summon only into free slots — a new press (`KernelApi.freshPress`) may replace (otherwise Space or a
timed test would replace the minion every use and it would never attack). `attackRateTicks` = one
attack per that many ticks (stated, or B63 P-2 average / P-3 hit cap — labeled from `modeledFields`),
first one interval after it appears. `aiClass` (B63 P-6) picks the Lab model; `ranged-shot` shoots
(instant without a `projectile`; with `projectile.velocityTps` a kernel projectile of the summon's
kind), the contact classes strike by touch (a contact class with a `projectile` is `invalid-data`).
`sentryRangeTiles` = targeting radius to a dummy's centre. Damage = weapon damage × the projectile's
`damageMultiplierPct` when given; crit 0 (summon class, B64) except through a whip tag.

**whip** (P3-S10) — a line of `rangeTiles` sweeps `arcDegrees` (B63 P-1: 180°, centred in front of
the player — `swingAngle`) once per use; each dummy at most once per swing; the n-th dummy hit takes
`falloffPerTarget` off the previous hit n times, each step rounded down (integer basis points); a
0-damage dummy is neither hit nor tagged. Each landed hit tags the dummy for `WHIP_TAG_DURATION_TICKS`
(wiki: 4 s; the params carry no duration, so Constellation's 8 s would need a schema field — it is a
reviewed limitation) with `tagDamageFlat` / `tagCritPct`, and makes it the summons' focus.

**explosive-aoe** (P3-S11) — a THROWN explosive: the weapon item itself, used up by each throw
(`consumeItem`, `stats.consumablesUsed`; never ammo — a weapon with `ammoClass` is `invalid-data`: a
launcher's blast is its ammo's). Each activation throws one from the player's centre toward the aim at
`weapon.shootSpeedTps` (required) horizontally, in an arc under the generic gravity solved to land on the
ground (`GROUND_Y_TILES`) below the aim point (`THROWN_REST_HEIGHT_TILES` above it), where it rests
(`throwArc` / `arcPoint` / `landingPoint`). `trigger` `timed`: it goes off `fuseTicks` after the throw
(its age), wherever it is, flying through dummies without a hit; `impact`: at its first dummy touch
(`touch`, at the touch point — no hit of its own) or when it lands. The explosion (`explode`) hits every
dummy whose hitbox reaches into the circle of `blastRadiusTiles` ONCE, at the hitbox point nearest the
centre: `falloff` `none` = full damage; `linear` = ⌊(R − d) × 100 ÷ R⌋ % of it by that distance d
(`blastKeptPct`, a Lab formula), a dummy kept 0 % not hit — then variance, defense and crit as any hit
(classless: no crit). `selfKnockback` and the thrower's self-damage are not modeled (stationary player).
Homing and multiHit are refused (`modifier-not-implemented`).

## Resolved questions

1. **`simRequiredWeaponFields` predated B14** (omitted `useAnimationTicks` and melee `autoReuse`).
   Resolved by AMENDMENTS-008 B36, applied in P3-S0; B48 adds `reuseDelayTicks` (part of the
   cadence) to the same list.
2. **Param semantics for overlay authors** — ratified by AMENDMENTS-008 B37 (section above).
3. **Reuse delay** — the cadence omitted Iteminfo `reuseDelay`; resolved by AMENDMENTS-010 B48(a)
   (see "Cadence").

## Changelog

Intentional engine behavior changes and the golden fingerprints they re-pin (`GOLDEN_30S` in
`determinism.test.ts`, 30 s at 144 fps, Node / V8; AMENDMENTS-008 B38).

- **2026-10-14: dummy roster v2 — Moving, Boss-Sized, Armored (PRD P3-S12).** `DummySpec.motion`
  (`DummyMotion`: `axis` `horizontal` | `vertical`, `speedTps`, `rangeTiles`; validated — a malformed one is
  `invalid-dummy`) and kernel step 0, which moves a dummy with a path to the closed-form point of the tick
  (src/sim/motion.ts, `dummyPathOffset`; a no-op for a dummy without one). `renderState().dummies[]` gains
  `prevX` / `prevY` (interpolation) and `path` (both ends), and reports `width` / `height` from the spec;
  `stats.projectilesMissed` (a projectile that despawned without landing a hit — the kernel's despawns go
  through one place that counts it) with `result.projectilesMissed` / `result.projectilesSpawned`;
  `LabSim.approximations` adds the new `dummy-motion` while a moving dummy is a target; the `knockback`
  copy no longer says dummies never move. The caller's dummy specs are copied deeply (a path included).
  Boss-Sized and Armored need no engine change (`widthTiles` / `heightTiles` / `defense` predate this; the
  verified defense formula is unchanged). Public constants `DEFAULT_DUMMY_WIDTH_TILES` /
  `DEFAULT_DUMMY_HEIGHT_TILES`. Fingerprints: the sixteen earlier scenarios are **unchanged** (proved by the
  unchanged pins — no event, digest or hit changes for dummies without a path). New scenarios pinned:
  moving horizontal vs arcing arrows `{ total: 289, dot: 0, hits: 19, crits: 2, uses: 72, digest:
  '6ca22c50' }` (49 of 72 arrows miss); moving vertical vs straight bolts `{ 569, 0, 36, 2, 90, 'd84bf0f0' }`
  (47 of 90 miss); a sword vs a horizontal mover (out of reach and back) `{ 383, 0, 23, 4, 95, '6c46d2ed' }`;
  a sentry vs a vertical mover (in and out of range) `{ 1435, 0, 81, 0, 1, 'ef52d63b' }`; a bomb vs a
  horizontal mover (it lands where the dummy was) `{ 2535, 0, 25, 0, 72, '4cfb6878' }` (40 throws reach no
  dummy); Boss-Sized 6 × 9 vs a 5-pellet 40° fan `{ 2980, 0, 225, 25, 45, '21b37d05' }` (every pellet lands);
  Armored defense 20 `{ 2164, 0, 95, 14, 95, '96c724bf' }`.

- **2026-10-14: explosions counted (P3-S11 design review #8).** `stats.explosions` / `result.explosions`
  count `explosion` events, so the results can say how many thrown explosives were still on their fuses
  at the end (`consumablesUsed − explosions`). A stat only — no event, digest or hit changes: every
  fingerprint is unchanged. Public constant `THROWN_REST_HEIGHT_TILES` (the Lab camera frames a blast
  where a throw comes to rest).

- **2026-10-14: explosive-aoe interpreter, classless crit, Debuff Dummy state (PRD P3-S11).** New
  interpreter `explosive-aoe`, registered — every schema archetype now is (the B61 flip: `pipeline:build`
  emits the recorded thrown explosives whose core fields verify). Guard: `critPct` is not required for
  classless weapons (wiki Critical hit: such damage "can never deal critical hits"; label
  `classless-crit`; `simRequiredWeaponFields(archetype, damageClass)`). Kernel hooks, inert for every
  earlier archetype: `explode` (+ event `explosion`, `blastKeptPct` on its hits), a guide's `touch` and
  `detonated` (despawn reason), `consumeItem` (`stats.consumablesUsed`, `result.consumablesUsed`,
  `WeaponSummary.consumable`). `renderState().dummies[].debuffs[].durationTicks` (the Debuff Dummy's
  bar; the refresh rule itself is unchanged). New approximations `classless-crit`, `explosive-throw`,
  `explosive-fuse`, `explosive-impact`, `blast-area`, `blast-falloff`, `explosive-consumable`; constant
  `GROUND_Y_TILES`. Fingerprints: the fourteen earlier scenarios are **unchanged** (proved by the
  unchanged pins). New scenarios pinned: bomb (timed fuse 180, radius 4, armored row of 3 — reaches two)
  `{ total: 12768, dot: 0, hits: 130, crits: 0, uses: 72, digest: 'f5b11d7b' }` — 65 of the 72 throws go
  off inside 30 s; grenade (impact, linear falloff radius 6, ranged crits, DoT chance)
  `{ 4046, 183, 80, 6, 40, '63bd07b6' }`.

- **2026-10-14: minion-sentry + whip interpreters, summons, whip tags, minion loadout, B64 (PRD P3-S9 /
  P3-S10).** New interpreters `minion-sentry` and `whip`, registered (the B61 flip: `pipeline:build`
  emits the 10 recorded minion staves and 6 whips — simulable 118 → 134). Guard: `critPct` is not
  required for summon-class weapons (AMENDMENTS-013 B64). Kernel hooks, inert for every earlier
  archetype: agents (`summon` / `dismiss` / `agents`, stepped after the use cycle), `autoAim`,
  `freshPress`, `strike(…, damage)`, `HitSource.owner`, whip tags (`tagDummy`, `focusIndex`, a tag
  countdown after the debuffs). API: `LabSettings.minionSlots` / `sentrySlots`,
  `LabSimOptions.minionLoadout`, `LabSim.loadout`, `snapshot().summons`, `stats.breakdown` /
  `result.breakdown`, `renderState().agents` and `dummies[].tag`, blade kind `whip`, damage sources
  `minion` / `sentry` with `tagBonus`, events `summon` / `dismiss` / `tag-applied` / `tag-expired`,
  setup refusal `invalid-loadout`. New approximations `whip-swing`, `whip-tag`, `summon-slots`,
  `summon-attack`, `summon-target`, `minion-melee-contact`, `minion-ground-melee`,
  `minion-hover-strike`, `minion-ranged-shot`, `sentry-placement`; `crit-base` copy names the tag-crit
  exception. Fingerprints: the ten earlier scenarios are **unchanged** (proved by the unchanged pins).
  New scenarios pinned: minion (ground-melee, two slots, row) `{ total: 2622, dot: 0, hits: 295,
  crits: 0, uses: 2, digest: '8e35ff66' }`; sentry (ranged-shot, range, armored row) `{ 3967, 0, 177,
  0, 2, '4fbff848' }`; ranged minion (projectile, pierce) `{ 4173, 0, 280, 0, 2, '3830f899' }`; whip +
  minion loadout (tags, tag crit, falloff, minion DoT) `{ 9644, 89, 537, 33, 60, '12a71806' }` — its
  crits are all tagged summon hits (summon damage never crits otherwise).

- **2026-10-13: returning + piercing-beam interpreters, Multiple Dummies (PRD P3-S6 / P3-S7).**
  New interpreters `returning` (boomerang / launched flail / yoyo variants) and `piercing-beam`
  (`pierce-projectile` / `channel-beam`), registered (the B61 flip: `pipeline:build` emits the 22
  recorded returning weapons). Generic kernel hooks, inert for every earlier archetype: a use gate
  (`Behavior.ready`), guided projectiles (`ProjectileLaunch.guide` + `hitCooldownTicks`; despawn reason
  `returned`), per-world persistent hit sources, `KernelApi.attacking` / `arena` / `activeProjectiles`,
  `blade(use, k)` with a `beam` pose. API: `dummyRow`, `DUMMY_ROW_SPACING_TILES`, `LabSim.setDummies`,
  `WeaponSummary.returnsToHand`, `TimedTestResult.perDummy`. New approximations `boomerang-flight`,
  `flail-launch`, `yoyo-control`, `beam-geometry`. Fingerprints: the five earlier scenarios are
  **unchanged** (proved by the unchanged pins). New scenarios pinned: boomerang (turns at its first hit,
  dummy row) `{ total: 1073, dot: 0, hits: 86, crits: 3, uses: 86, digest: 'd0de41e8' }`; launched
  flail (turns on strike, DoT chance) `{ 1129, 109, 67, 7, 67, '92a82efb' }`; yoyo (tethered dwell at the
  auto-aim point) `{ 3288, 0, 180, 15, 1, '2bfbdb43' }`; pierce bolt (pierce 2 vs an armored row of 4,
  slow-cast) `{ 2576, 0, 129, 8, 44, 'f5383fcd' }`; channel beam (tick rate across uses, reuse delay)
  `{ 15858, 0, 738, 54, 82, 'c0eea291' }`.

- **2026-10-13: cooldown × mana labels (AMENDMENTS-012 B57(e)).** New approximations
  `slow-cast-cooldown` and `cooldown-mana-regen` name the two existing, undocumented Lab choices
  (see "Cadence"); listed for a weapon with both a mana cost and a reuse delay. Labels only — no
  engine behavior change; every `GOLDEN_30S` fingerprint is unchanged (none re-pinned).

- **2026-10-13: reuse delay, per-projectile damage %, convention labels (AMENDMENTS-010 B48 / B49).**
  (1) A weapon's `reuseDelayTicks` is a cooldown after each use: attack interval = use length +
  reuse delay ([wiki Use time](https://terraria.wiki.gg/wiki/Use_time)); `WeaponSummary` gains
  `reuseDelayTicks` and its `cadenceTicks` / `nominalAttacksPerSec` include the delay;
  `activationsPerUse` counts the use only. (2) `ProjectileSpec.damageMultiplierPct` scales a
  projectile's base damage (rounded down). (3) New approximations `reuse-delay`, `thrust-reach` (B46),
  `slight-spread` (B47); the `cadence` copy is reworded in plain language (no game-internal field
  names); `projectile-damage` and `ammo` copy updated. Fingerprints: all four existing scenarios
  were computed **before** the change and are pinned **unchanged** after it (weapons without a reuse
  delay or multiplier are bit-identical) — sword `{ total: 1049, dot: 0, hits: 95, crits: 10, uses:
  95, digest: 'ae897f46' }`, shotgun `{ 5278, 0, 360, 48, 45, '97dabadc' }`, staff `{ 799, 97, 42,
  4, 42, '876a8729' }` (= the B35 value below), burst staff `{ 4073, 0, 258, 13, 43, 'b6630161' }`.
  New scenario "burst rifle (reuse delay, slight spread)" (useTime 4 / useAnimation 12 / reuse delay
  14, 10° spread): `{ total: 3278, dot: 0, hits: 207, crits: 11, uses: 70, digest: '9bcbb3a6' }` —
  70 uses = ⌈1800 / 26⌉.

- **2026-10-13: `insufficientMana` default `'block'` → `'slow-cast'` (AMENDMENTS-008 B35).** By
  default, casting with too little mana now continues at 40% attack speed (use time × 2.5), the
  pinned 1.4.5.8 behavior ([wiki Mana](https://terraria.wiki.gg/wiki/Mana)), instead of stopping.
  `'block'` remains as the labeled "stop at zero" test setting; "ignore mana (test mode)" is
  unchanged. Fingerprint: `{ total: 719, dot: 94, hits: 37, crits: 4, uses: 37, digest: 'bc6387c3' }`
  → `{ total: 799, dot: 97, hits: 42, crits: 4, uses: 42, digest: '876a8729' }` (10 paid + 32 slow
  casts instead of 37 paid). With `insufficientMana: 'block'` the scenario still reproduces the
  old values exactly.
