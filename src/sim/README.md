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

## API surface

| Export | Purpose |
|---|---|
| `createLabSim(options)` → `{ ok: true, sim } \| { ok: false, refusal }` | Build a sim, or a typed refusal. Never throws on data. |
| `assessWeapon(weapon)` → `{ simulable: true, archetype, requiresAmmoClass, requiresBuffIds } \| { simulable: false, refusal }` | Weapon-only verdict (no ammo/buffs needed). Use it for the in-Lab browser's "simulated vs limitation" badge (P3-S2) and the coverage report (P3-S13). |
| `cadenceTicksFor(weapon, useAnimationTicks)` | The effective ticks per attack, incl. the weapon's reuse delay (see "Cadence"). |
| `APPROXIMATIONS`, `sim.approximations` | Plain-language assumptions; `sim.approximations` is the subset for the equipped weapon — render it verbatim in the AssumptionsTip paired with every EstimateLabel. Modeling-convention entries carry a `ruling` (see "Modeling conventions"). |
| `IMPLEMENTED_ARCHETYPES` | `swing-melee`, `thrust`, `bow-gun`, `magic-bolt`, `returning`, `piercing-beam`. |
| `dummyRow(count, firstX?, spacingTiles?)`, `DUMMY_ROW_SPACING_TILES` | Multiple Dummies: a row of standard dummies (see "Units and coordinates"). |
| `DEFAULT_LAB_SETTINGS`, `DEFAULT_DUMMY`, `DEFAULT_SEED`, `TIMED_TEST_DURATIONS`, `timedTestTicks`, `TICKS_PER_SECOND`, `BASE_CRIT_PCT`, `mulberry32` | Constants / utilities. |
| `type *` from `./types` | All public types (`LabSim`, `SimSnapshot`, `SimEvent`, `RenderState`, `SimRefusal`, …). |

### `LabSimOptions`

| Field | Notes |
|---|---|
| `weapon` | A schema `Weapon`. Required fields are read through `getField`; unverified ⇒ refusal. |
| `seed?` | uint32 (default 1). |
| `ammo?` | Required for `bow-gun`: an `Item` whose `ammoStats.ammoClass` equals the weapon's. |
| `buffs?` | Buff registry; required when the weapon has `modifiers.dot`. |
| `dummies?` | `DummySpec[]` — `{ id?, x, y, widthTiles?, heightTiles?, defense? }` (boss-sized = bigger box, armored = `defense`). |
| `settings?` | Partial `LabSettings` (below). |
| `arena?` | Projectile despawn bounds (must contain the origin). |

`LabSettings` (defaults in `DEFAULT_LAB_SETTINGS`):

| Setting | Default | Meaning |
|---|---|---|
| `ignoreMana` | `false` | "ignore mana (test mode)": never blocks, pool stays full, costs still counted in `manaConsumed`. Show the amber chip. |
| `maxMana` | `200` | Capacity (20 base + 9 crystals; wiki Mana). |
| `manaRegen` | `'wiki-1.4.5.7'` | Or `'none'`. |
| `insufficientMana` | `'slow-cast'` | `'slow-cast'` (AMENDMENTS-008 B35): the pinned 1.4.5.8 game rule — since 1.4.5.7 a magic weapon without enough mana still casts, at 40% attack speed (use time × 2.5; [wiki Mana](https://terraria.wiki.gg/wiki/Mana)); paying nothing on such casts is a labeled assumption. `'block'`: the labeled "stop at zero" test setting — casting stops until mana covers the cost. |
| `homingEnabled` | `true` | P3-S8 AC2 toggle. |
| `damageVariance` | `true` | Wiki ±15% per-hit variance; `false` gives constant per-hit numbers. |

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
| `weapon` | `WeaponSummary`: `cadenceTicks` (incl. `reuseDelayTicks`), `nominalAttacksPerSec`, `critChancePct`, `baseHitDamage` (after a projectile's `damageMultiplierPct`), `manaCostPerUse`, `returnsToHand` (a returning weapon: an attack lasts until it is back), … for the EquippedBar. |

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
| TimedTestControl | `snapshot().timedTest` (`status`, `remainingSec`, `result`) — announce `finished` via `aria-live` |
| Multiple dummies (primary = first dummy vs all) | `stats.perDummy[id]`; a finished test's `result.perDummy` |

### Events (`SimEvent`, deterministic log)

`use-start`, `use-blocked` (`block` setting only; once per out-of-mana streak), `projectile-spawn`,
`projectile-despawn` (`pierce-exhausted` / `lifetime` / `out-of-bounds` / `returned` — a returning
weapon caught: the next attack may start on the following tick), `damage`
(`source: 'melee' | 'projectile' | 'dot'`, `sourceId` `use:<n>` / `proj:<id>` / `beam` / `buff:<id>`,
`amount`, `crit`, `x`, `y` = impact point; crits render larger, DoT smaller), `debuff-applied`
(`refreshed`), `debuff-expired`. Every event has `tick` and `seq`. `snapshot().eventDigest` is an
FNV-1a fingerprint of the whole stream since the last reset.

### Render state

`renderState()` → `player`, `facing`, `aim`, `dummies[]` (center, size, defense, active
debuffs), `projectiles[]` (`prevX/prevY` → `x/y`, velocity in tiles/s, `spriteKey`; a returning
weapon in flight is its one projectile), and `blade` (`swing` | `thrust` | `beam`: `prevAngle → angle`,
`prevLength → length`, radians, 0 = +x, π/2 = down; a `beam` runs from the player along `angle` for
`length` tiles while the attack is held). Interpolate with `alpha`.

## Refusals (render, don't guess)

`refusal.kind === 'not-simulable'` → LimitationCard / banner:

| `reason` | UI |
|---|---|
| `limitation` | LimitationCard from `refusal.limitation` (`inGameBehavior`, `reason`, `sourceUrl`). |
| `custom-scenario` | Custom-scenario banner (`scenarioId`). |
| `archetype-not-implemented` | Not-simulated card (minion-sentry, whip, explosive-aoe). |
| `modifier-not-implemented` | bounce / chain (the registry stubs throw `NotImplementedError`; the guard turns that into this result); homing on a returning weapon or a held beam (their flight / line ignores steering — refused, never ignored). |
| `missing-required-field` / `unverified-required-field` | `fields` lists dot-paths. Normally unreachable: the pipeline downgrades such weapons to limitations (§2.1 rule 3); this is defense in depth. |
| `invalid-data` | Contradictory or malformed values. |
| `dependency-data-unavailable` | The chosen ammo or referenced buff lacks verified data (e.g. ammo with no damage value). |

`refusal.kind === 'invalid-setup'` → user-fixable: `ammo-required`, `ammo-incompatible`,
`buff-registry-required`, `invalid-settings`, `invalid-dummy`, `invalid-arena`.

Required weapon fields for every archetype: `damageClass`, `damage`, `critPct`,
`useTimeTicks`, `useAnimationTicks`; plus `shootSpeedTps` (bow-gun, returning, and piercing-beam
`pierce-projectile` params without a projectile spec) and `manaCost` (magic-bolt). `autoReuse`/`manaCost`/`reuseDelayTicks` may be absent (defaults: false / no cost /
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
- Crit: `4% + weapon critPct` for melee/ranged/magic, ×2 after defense; summon and classless never crit ([Critical hit](https://terraria.wiki.gg/wiki/Critical_hit); AMENDMENTS-004 B17). `BASE_CRIT_PCT = 4` is a labeled constant.
- Bow/gun: weapon damage + ammo damage (wiki Damage).
- Per-projectile percentage (`ProjectileSpec.damageMultiplierPct`, AMENDMENTS-010 B48(b)): the
  projectile's base damage is ⌊damage × pct / 100⌋ before variance — rounded down as in the wiki's
  own figures (Sapphire Staff "60% of the weapon's damage (10 base damage)" for 18; Amber Staff
  "80% … (16 base damage)" for 21). Set only from a quoted wiki percentage.
- Knockback ignored: dummies never move (Target Dummy is "unresponsive to knockback", [Target Dummy](https://terraria.wiki.gg/wiki/Target_Dummy)).

## Determinism contract

- One mulberry32 stream, drawn only inside `tick()` in a fixed order (see `world.ts` header). Every
  damage value is an integer, so totals are exact.
- Frame rate only changes how many ticks run per `advance()` call, never what a tick does; timed
  tests count ticks, not wall time.
- Proven in `determinism.test.ts` across 30/60/144 fps, jittered and spiky frame patterns, and
  arbitrary `step()` chunking. A pinned golden fingerprint catches unintended semantic drift;
  intentional changes re-pin it with a [Changelog](#changelog) entry (AMENDMENTS-008 B38).
- Limitation: `Math.sin/cos/atan2` are engine-implemented, so results are bit-identical within one
  JS engine (V8 in Node and Chrome); low-order bits could differ across engines (e.g. Firefox).

## Extending

- **New archetype** (minion-sentry, whip, explosive-aoe): add `interpreters/<name>.ts` implementing
  `ArchetypeInterpreter` (`prepare` → `Behavior` with `activate` / optional `tickUse` / `ready` /
  `blade`), register it in `interpreters/index.ts` — which also flips the pipeline's recorded
  "params complete, pending interpreter" weapons on the next `npm run pipeline:build`
  (AMENDMENTS-013 B61). The kernel does not switch on archetype; its generic hooks are a use gate
  (`Behavior.ready`), guided projectiles (`ProjectileLaunch.guide`: steer / stop at a hit / `caught`),
  per-world persistent hit sources (`KernelApi.persistentSource`), and `attacking` / `arena` /
  `activeProjectiles` on `KernelApi`. A `Behavior` is shared by every world a sim builds (reset makes a
  new world): it keeps no per-world state of its own.
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
| knockback | ✓ | Ignored (Target Dummy never moves). |
| dummy-hitbox | ◇ | 2×3 tiles = placed size ✓; NPC pixel hitbox undocumented. |
| boomerang-flight | ✓/◇ | Turns back at its first hit ✓ (wiki Combat Wrench: most boomerangs "instantly turn around after hitting enemies") or at its throw range; back at the throw speed ◇ (in-game it returns faster); one out at a time ◇. |
| flail-launch | ✓/◇ | Extends until it strikes or reaches its length, then retracts ✓ (wiki Flails); retract speed = extend speed ◇ ("slightly faster", no number); the struck dummy isn't hit again on the way back ◇. |
| yoyo-control | ✓/◇ | Re-hits every 10 ticks ✓ (wiki Yoyos); follows the aim within its reach at the weapon velocity, stays out while held ◇; spin-time limit, bouncing and its own acceleration not modeled. |
| beam-geometry | ◇ | A line from the player toward the current aim to the arena edge, through every dummy; one hit per dummy per `tickRateTicks`; off while released and during a cooldown. |

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

The four B63 labels surface once the whip / minion-sentry / explosive-aoe interpreters ship (P3-S9–
S11); until then those weapons are emitted as limitations (B61).

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
