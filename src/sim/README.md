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

## API surface

| Export | Purpose |
|---|---|
| `createLabSim(options)` → `{ ok: true, sim } \| { ok: false, refusal }` | Build a sim, or a typed refusal. Never throws on data. |
| `assessWeapon(weapon)` → `{ simulable: true, archetype, requiresAmmoClass, requiresBuffIds } \| { simulable: false, refusal }` | Weapon-only verdict (no ammo/buffs needed). Use it for the in-Lab browser's "simulated vs limitation" badge (P3-S2) and the coverage report (P3-S13). |
| `cadenceTicksFor(weapon, useAnimationTicks)` | The effective ticks per attack (see "Cadence"). |
| `APPROXIMATIONS`, `sim.approximations` | Plain-language assumptions; `sim.approximations` is the subset for the equipped weapon — render it verbatim in the AssumptionsTip paired with every EstimateLabel. |
| `IMPLEMENTED_ARCHETYPES` | `swing-melee`, `thrust`, `bow-gun`, `magic-bolt`. |
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
| `reset({ seed? })` | **The single ResetButton action**: stats, projectiles, debuffs, mana, RNG (re-seeded), timed test aborted. Input is kept. |
| `resetStats()` | Zero stats + graph only (world keeps running). |
| `startTimedTest(10 \| 30, { seed? })` | Full reset, then exactly 600/1800 ticks with attack held and aim frozen; config locked; then the sim **halts** (`advance`/`step` run 0 ticks) until `reset()` or another `startTimedTest` ("Run again" reproduces the result exactly). |
| `snapshot()` | Plain-data `SimSnapshot` (safe to keep; deep copies). |
| `renderState()` | Positions for the renderer (`alpha` included). |
| `drainEvents()` | Pending events, oldest first; clears the queue. |
| `weapon` | `WeaponSummary`: `cadenceTicks`, `nominalAttacksPerSec`, `critChancePct`, `baseHitDamage`, `manaCostPerUse`, … for the EquippedBar. |

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
| Multiple dummies | `stats.perDummy[id]` |

### Events (`SimEvent`, deterministic log)

`use-start`, `use-blocked` (`block` setting only; once per out-of-mana streak), `projectile-spawn`,
`projectile-despawn` (`pierce-exhausted` / `lifetime` / `out-of-bounds`), `damage`
(`source: 'melee' | 'projectile' | 'dot'`, `amount`, `crit`, `x`, `y` = impact point; crits render
larger, DoT smaller), `debuff-applied` (`refreshed`), `debuff-expired`. Every event has `tick` and
`seq`. `snapshot().eventDigest` is an FNV-1a fingerprint of the whole stream since the last reset.

### Render state

`renderState()` → `player`, `facing`, `aim`, `dummies[]` (center, size, defense, active
debuffs), `projectiles[]` (`prevX/prevY` → `x/y`, velocity in tiles/s, `spriteKey`), and
`blade` (`swing` | `thrust`: `prevAngle → angle`, `prevLength → length`, radians, 0 = +x, π/2 = down).
Interpolate with `alpha`.

## Refusals (render, don't guess)

`refusal.kind === 'not-simulable'` → LimitationCard / banner:

| `reason` | UI |
|---|---|
| `limitation` | LimitationCard from `refusal.limitation` (`inGameBehavior`, `reason`, `sourceUrl`). |
| `custom-scenario` | Custom-scenario banner (`scenarioId`). |
| `archetype-not-implemented` | "Not simulated yet" card (returning, piercing-beam, minion-sentry, whip, explosive-aoe). |
| `modifier-not-implemented` | bounce / chain. The registry stubs throw `NotImplementedError`; the guard turns that into this result. |
| `missing-required-field` / `unverified-required-field` | `fields` lists dot-paths. Normally unreachable: the pipeline downgrades such weapons to limitations (§2.1 rule 3); this is defense in depth. |
| `invalid-data` | Contradictory or malformed values. |
| `dependency-data-unavailable` | The chosen ammo or referenced buff lacks verified data (e.g. ammo with no damage value). |

`refusal.kind === 'invalid-setup'` → user-fixable: `ammo-required`, `ammo-incompatible`,
`buff-registry-required`, `invalid-settings`, `invalid-dummy`, `invalid-arena`.

Required weapon fields for every archetype: `damageClass`, `damage`, `critPct`,
`useTimeTicks`, `useAnimationTicks`; plus `shootSpeedTps` (bow-gun) and `manaCost`
(magic-bolt). `autoReuse`/`manaCost` may be absent (defaults: false / no cost) but block if
listed unverified. Any `labBehavior.*` path or `simRequiredWeaponFields(archetype)` path listed
unverified blocks (mirrors the pipeline rule).

## Cadence (which use-time field drives the attack rate, and why)

- **Attack cadence = `useAnimationTicks`.** AMENDMENTS-004 B14: the wiki's "use time" is Iteminfo
  `useAnimation`, which is what the game waits between uses. `useTimeTicks` would overstate the
  rate of e.g. the Copper Broadsword (useTime 20 vs useAnimation 21).
- **Autoswing melee attack one tick sooner**, as the wiki documents: "the actual use time
  (`useAnimation`) of autoswing melee weapons is one tick lower than the `useAnimation` stated"
  (https://terraria.wiki.gg/wiki/Use_time). Applied when `damageClass === 'melee' && autoReuse`.
- **`useTimeTicks` is the activation interval inside one use.** Shots/emissions happen at offsets
  0, useTime, 2·useTime, … < cadence (wiki: Golden Shower 6/18 "firing 3 times per" use).
  `projectilesPerUse` is spawned **per activation**; ammo is paid per activation, mana once per use.
- Every weapon repeats while attack is held (as if auto-reuse); this is listed as an assumption.

## Damage math (verified against the wiki, 2026-10-13)

Order (wiki Damage): **variance → defense → crit**.
- Variance: ×0.85–1.15, rounded half-to-even ([Damage](https://terraria.wiki.gg/wiki/Damage)); drawn in whole percent steps.
- Defense: `⌊damage − defense/2⌋`, minimum 1, no difficulty scaling for enemies ([Defense](https://terraria.wiki.gg/wiki/Defense)). Armor penetration and per-difficulty multipliers: out of scope.
- Crit: `4% + weapon critPct` for melee/ranged/magic, ×2 after defense; summon and classless never crit ([Critical hit](https://terraria.wiki.gg/wiki/Critical_hit); AMENDMENTS-004 B17). `BASE_CRIT_PCT = 4` is a labeled constant.
- Bow/gun: weapon damage + ammo damage (wiki Damage).
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

- **New archetype** (returning, piercing-beam, minion-sentry, whip, explosive-aoe): add
  `interpreters/<name>.ts` implementing `ArchetypeInterpreter` (`prepare` → `Behavior` with
  `activate` / optional `tickUse` / `blade`), register it in `interpreters/index.ts`. The kernel
  does not change.
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
| cadence | ✓ | B14 + autoswing −1 tick. |
| auto-reuse | ◇ | Held attack repeats every weapon at full rate. |
| melee-once-per-use | ◇ | One hit per dummy per swing/thrust unless multiHit. |
| swing-geometry | ◇ | Sweeping line of `reachTiles` over `arcDegrees`, centered on facing. |
| thrust-geometry | ◇ | Triangle extend/retract toward the aim. |
| projectile-point | ◇ | Points with swept collision; no tile collision, no per-projectile hitbox. |
| projectile-damage | ◇ | Projectiles deal weapon (+ammo) damage; no per-projectile multipliers in the data. |
| spread | ◇ | Even fan for multi-projectile; seeded random inaccuracy for single projectiles. |
| gravity | ◇ | Generic constants (15-tick delay, 0.1 px/tick², 16 px/tick cap) — NOT verified game values. |
| projectile-lifetime | ◇ | 600-tick cap when the data gives none (not a game value). |
| no-shared-immunity | ◇ | Separate projectiles never block each other's hits. |
| ammo | ◇ | One ammo per activation; no ammo-save chances; speed = (weapon + bonus) × multiplier. |
| mana-cost | ◇ | Paid once per use. |
| mana-regen | ✓ | 1.4.5.7+ formula, standing still, no bonuses. |
| insufficient-mana | ✓/◇ | Default `slow-cast` = verified 1.4.5.7+ rule (B35), paying nothing ◇; `block` = stop-at-zero test setting. |
| homing | ◇ | Nearest dummy in range; velocity-direction blend by `strength`, speed kept. |
| dot | ◇ | dps from the Buff; ignores defense, no crit, refresh-not-stack — undocumented on the wiki. |
| multi-hit | ◇ | `localImmunityTicks` re-hit cooldown per source per dummy. |
| knockback | ✓ | Ignored (Target Dummy never moves). |
| dummy-hitbox | ◇ | 2×3 tiles = placed size ✓; NPC pixel hitbox undocumented. |

## Open questions (need an orchestrator ruling)

1. **`simRequiredWeaponFields` (src/schemas/weapon.ts) predates B14.** It omits
   `useAnimationTicks` (now the cadence) and `autoReuse` (now affects melee cadence), so the
   pipeline won't downgrade a weapon whose cadence is unverified. The engine still refuses such a
   weapon (`unverified-required-field`), but the UI would show a generic card instead of a
   pipeline-authored limitation. Fix belongs to the schema owner.
2. **Param semantics P3-S0 overlay authors must follow:** `ProjectileSpec.pierce` = extra dummies
   passed through after the first hit (0/absent = stops at the first); `projectilesPerUse` =
   projectiles per activation; ammo `ProjectileSpec.velocityTps` is not used for speed (only
   `velocityBonusTps` / `velocityMultiplier`); magic-bolt speed = `params.projectile.velocityTps`
   (not `weapon.shootSpeedTps`).

## Changelog

Intentional engine behavior changes and the golden fingerprint they re-pin (`GOLDEN_STAFF_30S` in
`determinism.test.ts`, Node / V8; AMENDMENTS-008 B38).

- **2026-10-13: `insufficientMana` default `'block'` → `'slow-cast'` (AMENDMENTS-008 B35).** By
  default, casting with too little mana now continues at 40% attack speed (use time × 2.5), the
  pinned 1.4.5.8 behavior ([wiki Mana](https://terraria.wiki.gg/wiki/Mana)), instead of stopping.
  `'block'` remains as the labeled "stop at zero" test setting; "ignore mana (test mode)" is
  unchanged. Fingerprint: `{ total: 719, dot: 94, hits: 37, crits: 4, uses: 37, digest: 'bc6387c3' }`
  → `{ total: 799, dot: 97, hits: 42, crits: 4, uses: 42, digest: '876a8729' }` (10 paid + 32 slow
  casts instead of 37 paid). With `insufficientMana: 'block'` the scenario still reproduces the
  old values exactly.
