# DATA SCHEMA SPECIFICATION — Terraria Companion Website (v1)

> **AMENDED BY [AMENDMENTS-001.md](./AMENDMENTS-001.md) (binding — read together).**

Status: P0 design, for freeze · 2026-10-12 · Authored by database-api-designer agent.
Sources: docs/ADR-001.md, docs/PRD.md, docs/REQUIREMENTS.md, docs/TASK_CONTRACT.md. Target: shared module `src/schemas/` consumed by both `pipeline/` and the app. Zod 4 (`zod@^4`, syntax verified current via Context7).

**Orchestrator ruling (2026-10-12):** APPROVED — archetype union has 9 arms; homing is a cross-cutting modifier layer (`LabModifiers.homing`), not a 10th arm. This satisfies PRD P3-S8 AC2 ("same weapon with homing disabled flies straight") which a dedicated arm cannot. PRD's own archetype table already marks homing as "(modifier layer on 4/5)".

## Scope
- **In:** Zod schema code, derived-field rules, validation rules, file/chunk names, persistence v1 + migration convention, gaps.json/meta.json shapes, data-access + storage contracts.
- **Out:** implementation code, UI copy, scoring formulas for Loadout Builder/Feature A (separate design), sprite pipeline beyond manifest shape.
- **Constraints:** ADR-001 D1/D2/D6/D7 binding; verified-or-Unknown (REQUIREMENTS §13); no runtime wiki calls; stable integer item IDs as PKs.

## 1. Entities and relationships

**Identifier spaces.**
- **Game item ID** (positive int from `Module:Iteminfo/data`) — PK for Weapon, ArmorPiece, Accessory, Item. One shared ID space; an ID appears in exactly one of the four collections.
- **Curated slug** (`[a-z0-9-]+`) — PK for ArmorSet, Boss, ProgressionNode, Buff, RecipeGroup, CustomScenario, Condition. Recipe and DropSource get deterministic synthetic string IDs (§3).

**Cross-type `TypedRef` string:** `i:<itemId>`, `set:<slug>`, `boss:<slug>`, `node:<slug>`, `buff:<slug>`, `rcp:<id>`, `drop:<id>`, `grp:<slug>`, `scn:<slug>`, `cond:<slug>`. Typed fields use bare keys; TypedRef only in polymorphic contexts (search docs, favorites, recent, plan steps).

**Relationships:** ArmorSet→pieces (1 chest, 1 legs, 1..N class-variant helmets; back-ref `setId`); Recipe→result (N:1; alternatives = multiple Recipe rows); ingredient = item | recipe-group; RecipeGroup→2..N members; DropSource→item (N:1) + source (NPC name/ids, optional bossId); Boss↔Node 1:1 (validated symmetric); Edge from/to nodes (directed); Item→buffGrants; Accessory tinkering `combinedFrom[]`/`upgradesTo[]` (derived from Tinkerer's Workshop recipes); any item → derived `gatedBy`; Weapon→labBehavior (1:1 mandatory); custom-scenario weapons → CustomScenario.

**Denormalization rule:** `gatedBy`, `combinedFrom/upgradesTo`, `Boss.dropIds`, `Item.isStation` are pipeline-derived, never hand-authored, so Feature A/B honesty checks are O(1) lookups. Sources of truth remain Recipes/Drops/edges; `validate` asserts derived↔source consistency. No other denormalization in v1.

## 2. Zod schemas

**Global nullability policy (binding):** emitted JSON never uses `null` for unknown. Present = value. Absent + listed in `_prov.unverifiedFields` = unknown → UI renders "Unknown". Absent + not listed = not applicable → UI omits row. Present + listed is FORBIDDEN at emit (pipeline strips value, keeps listing). `null` appears only in persistence schemas (deliberate empty slot).

**Unit conventions (binding):** distances in **tiles** (16 px @1x), durations in **ticks** (60/s), velocities in **tiles/second**, rates as fractions (0,1], percentages as ints named `*Pct`.

### 2.0 Shared primitives (`src/schemas/common.ts`)
```ts
import * as z from "zod";

export const ItemId = z.int().positive();
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTime = z.iso.datetime();
export const WikiUrl = z.url().startsWith("https://terraria.wiki.gg/");
export const TypedRef = z.string().regex(
  /^(i:\d+|(set|boss|node|buff|grp|scn|cond):[a-z0-9-]+|(rcp|drop):[a-z0-9-]+)$/
);

export const GAME_VERSION = "1.4.5.8" as const;
export const DATA_SCHEMA_VERSION = 1 as const;

export const Stage = z.enum(["early-prehm","late-prehm","early-hm","mid-hm","endgame"]);
export type Stage = z.infer<typeof Stage>;
export const STAGE_ORDER: Record<Stage, number> =
  { "early-prehm":0, "late-prehm":1, "early-hm":2, "mid-hm":3, "endgame":4 };

export const DamageClass = z.enum(["melee","ranged","magic","summon","other"]);
export const Difficulty = z.enum(["classic","expert","master"]);
export const WorldEvil = z.enum(["corruption","crimson"]);
export const ConditionSlug = Slug;  // validated against conditions.json registry
export const AmmoClass = Slug;      // validated against ammoStats.ammoClass value set
```

### 2.1 Provenance envelope (`_prov`, uniform on every record)
```ts
export const SourceKind = z.enum([
  "iteminfo","cargo:Items","cargo:Recipes","cargo:Drops","cargo:NPCs",
  "cargo:Equipinfo","cargo:Weapon_source","cargo:Exclusive","cargo:Imageinfo",
  "cargo:Modifiers","curated",
]);
export const ProvSource = z.strictObject({
  kind: SourceKind,
  url: WikiUrl,
  rev: z.int().positive().optional(),  // REQUIRED for kind "iteminfo" (ADR D1 caveat)
  fetchedAt: IsoDate,
  overlay: Slug.optional(),            // REQUIRED for kind "curated"
});
export const Prov = z.strictObject({
  gameVersion: z.literal(GAME_VERSION),
  sources: z.array(ProvSource).min(1),
  verified: z.boolean(),
  unverifiedFields: z.array(z.string()),  // dot-paths, e.g. "rates.expert"
  editorialFields: z.array(z.string()),   // dot-paths sourced ONLY from curated overlays
});
```

**Field-level verification semantics (binding):**
1. `verified===true` ⇔ `unverifiedFields` empty AND passed cross-check AND no field in the 1.4.5.7→1.4.5.8 patch-diff set without re-confirmation.
2. Absent + listed = unknown (render "Unknown"); absent + not listed = not applicable (omit). UI MUST render "Unknown" for listed fields.
3. **Simulation consequence:** if any field required by a weapon's archetype is unverified, pipeline downgrades `labBehavior` to `{kind:"limitation", reason:"required simulation parameter unverified…"}` during validate. The sim never consumes unknowns.
4. **Editorial vs extracted:** curated-only fields go in `editorialFields` (suggestedEquipment, prepChecklist, guidance, attack-pattern tags). Editorial never flips `verified` false, but every overlay entry carries a `sourceUrl` for factual claims (enforced by overlay schemas). UI labels editorial fields "editorial guidance".
5. **Shared accessor contract:** `getField(record, dotPath) => { status: "verified"|"unverified"|"not-applicable"|"editorial", value? }`. All UI/sim reads go through it; direct field access in UI is a lintable violation.

### 2.2 Shared item core, acquisition, gating
```ts
export const Rarity = z.union([
  z.int().min(-1).max(11),
  z.enum(["rainbow","fiery-red","amber"]),  // TO-VERIFY-IN-P2 exact encoding
]);

export const GatedBy = z.strictObject({
  bosses: z.array(Slug),               // node slugs that MUST be defeated first
  conditions: z.array(ConditionSlug),  // world conditions not implied by bosses
  stage: Stage,                        // display tag = max(stage of gates); bosses[] authoritative
});
// Derived by pipeline (§7b). If underivable: absent + "gatedBy" in unverifiedFields
// ⇒ consumers treat gating as UNKNOWN and NEVER "obtainable now" (Feature A/B rule).

export const Acquisition = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("craft"),    recipeIds: z.array(z.string()).min(1) }),
  z.strictObject({ method: z.literal("drop"),     dropIds: z.array(z.string()).min(1) }),
  z.strictObject({ method: z.literal("purchase"), npcName: z.string().min(1),
                   priceCopper: z.int().positive().optional(), conditions: z.array(ConditionSlug) }),
  z.strictObject({ method: z.literal("loot"),     containers: z.array(z.string()).min(1),
                   locations: z.array(z.string()) }),
  z.strictObject({ method: z.literal("fishing"),  biomes: z.array(z.string()).min(1),
                   conditions: z.array(ConditionSlug) }),
  z.strictObject({ method: z.literal("other"),    description: z.string().min(1), sourceUrl: WikiUrl }),
]);

const itemCommon = {
  id: ItemId, name: z.string().min(1),
  slug: Slug,                          // unique across the whole item ID space
  rarity: Rarity.optional(),
  stage: Stage.optional(),             // DERIVED from gatedBy else curated (risk A3)
  tags: z.array(Slug),
  wikiUrl: WikiUrl,
  sprite: z.string().optional(),       // path under /sprites/…; absent ⇒ placeholder (D3)
  valueCopper: z.int().nonnegative().optional(),
  maxStack: z.int().positive().optional(),
  gatedBy: GatedBy.optional(),
  acquisition: z.array(Acquisition),   // empty ⇒ "acquisition" ∈ unverifiedFields
  _prov: Prov,
};
```

### 2.3 StatEffect (armor/sets/accessories/buffs — powers P3-S14 + loadout math)
```ts
export const StatKind = z.enum([
  "damage-pct","damage-flat","crit-pct","melee-speed-pct","attack-speed-pct",
  "defense-flat","damage-reduction-pct","move-speed-pct","jump-boost","flight-time-ticks",
  "max-mana-flat","mana-cost-pct","mana-regen","minion-slots","sentry-slots","whip-range-pct",
  "life-regen","max-life-flat","mining-speed-pct","aggro-flat",
]); // CLOSED enum: pipeline FAILS on unclassifiable effect → explicit extension, never silent text

export const StatEffect = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stat"), stat: StatKind, value: z.number(),
                   scope: DamageClass.optional() }),  // absent = all classes
  z.strictObject({ kind: z.literal("special"),        // real but unmodeled — Lab lists "not simulated"
                   text: z.string().min(1), simulated: z.literal(false), sourceUrl: WikiUrl }),
]);
```

### 2.4 Weapon + Lab behavior
```ts
export const ProjectileSpec = z.strictObject({
  velocityTps: z.number().positive(),
  gravity: z.boolean().optional(),           // simplified: arcing vs straight (v1 fidelity)
  lifetimeTicks: z.int().positive().optional(),
  pierce: z.union([z.int().nonnegative(), z.literal("infinite")]).optional(),
  spriteKey: z.string().optional(),
});

// Cross-cutting modifiers (bounce, chain, DoT/debuff, multi-hit, homing per P3-S8)
export const LabModifiers = z.strictObject({
  bounce:  z.strictObject({ count: z.int().positive(), speedRetention: z.number().gt(0).lte(1) }).optional(),
  chain:   z.strictObject({ maxTargets: z.int().min(2), rangeTiles: z.number().positive() }).optional(),
  dot:     z.strictObject({ buffId: Slug, chancePct: z.int().min(1).max(100).optional(),
                            durationTicks: z.int().positive() }).optional(),  // dps lives on the Buff
  multiHit: z.strictObject({ localImmunityTicks: z.int().positive() }).optional(),
  homing:  z.strictObject({ strength: z.number().gt(0).lte(1),
                            acquisitionRangeTiles: z.number().positive() }).optional(),
});

export const ArchetypeParams = z.discriminatedUnion("archetype", [
  z.strictObject({ archetype: z.literal("swing-melee"),
    arcDegrees: z.number().gt(0).lte(360), reachTiles: z.number().positive(),
    emitted: ProjectileSpec.optional() }),
  z.strictObject({ archetype: z.literal("thrust"), reachTiles: z.number().positive() }),
  z.strictObject({ archetype: z.literal("returning"),
    variant: z.enum(["boomerang","flail","yoyo"]),
    throwRangeTiles: z.number().positive(),
    returnMode: z.enum(["auto-return","manual-recall","tethered"]),
    control: z.enum(["fire-and-forget","cursor-follow"]),
    hitsPerPass: z.int().positive().optional() }),
  z.strictObject({ archetype: z.literal("bow-gun"),
    ammoClass: AmmoClass, projectilesPerUse: z.int().positive(),
    spreadDegrees: z.number().min(0), inheritsAmmoProjectile: z.boolean() }),
  z.strictObject({ archetype: z.literal("magic-bolt"),
    projectilesPerUse: z.int().positive(), spreadDegrees: z.number().min(0),
    projectile: ProjectileSpec }),
  z.strictObject({ archetype: z.literal("piercing-beam"),
    mode: z.enum(["pierce-projectile","channel-beam"]),
    pierce: z.union([z.int().positive(), z.literal("infinite")]).optional(),  // iff pierce-projectile
    tickRateTicks: z.int().positive().optional(),                             // iff channel-beam
    projectile: ProjectileSpec.optional() }),
  z.strictObject({ archetype: z.literal("minion-sentry"),
    variant: z.enum(["minion","sentry"]), slotCost: z.number().positive(),
    aiClass: z.enum(["melee-contact","ranged-shot","hover-strike","ground-melee"]),
    attackRateTicks: z.int().positive(), projectile: ProjectileSpec.optional(),
    sentryRangeTiles: z.number().positive().optional() }),                    // iff sentry
  z.strictObject({ archetype: z.literal("whip"),
    arcDegrees: z.number().gt(0).lte(360), rangeTiles: z.number().positive(),
    tagDamageFlat: z.int().nonnegative(), tagCritPct: z.int().min(0).max(100).optional(),
    falloffPerTarget: z.number().min(0).lt(1).optional() }),
  z.strictObject({ archetype: z.literal("explosive-aoe"),
    blastRadiusTiles: z.number().positive(), trigger: z.enum(["impact","timed"]),
    fuseTicks: z.int().positive().optional(),                                 // iff timed
    selfKnockback: z.boolean().optional(), falloff: z.enum(["none","linear"]) }),
]);

export const LabBehavior = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("archetype"), params: ArchetypeParams,
                   modifiers: LabModifiers.optional() }),
  z.strictObject({ kind: z.literal("custom-scenario"), scenarioId: Slug,
                   note: z.string().optional() }),
  z.strictObject({ kind: z.literal("limitation"),       // P3-S13 AC3 shape
    inGameBehavior: z.string().min(1), reason: z.string().min(1), sourceUrl: WikiUrl }),
]);

export const Weapon = z.strictObject({
  ...itemCommon,
  type: z.literal("weapon"),
  damageClass: DamageClass,
  damage: z.int().nonnegative(),
  critPct: z.int().min(0).max(100),    // weapon bonus; sim adds universal base 4% (sim-core constant, labeled)
  useTimeTicks: z.int().positive(),
  useAnimationTicks: z.int().positive().optional(), // attacksPerSec = 60/useAnimationTicks — TO-VERIFY-IN-P2
  knockback: z.number().nonnegative(),
  autoReuse: z.boolean().optional(),
  manaCost: z.int().positive().optional(),
  ammoClass: AmmoClass.optional(),
  shootSpeedTps: z.number().positive().optional(),
  behaviorText: z.string().optional(),
  labBehavior: LabBehavior,            // MANDATORY — zero unhandled weapons (P3-S13)
});

export const CustomScenario = z.strictObject({   // overlay → lab-scenarios.json
  id: Slug, name: z.string().min(1),
  description: z.string().min(1),      // explains the special setup in-UI (P3-S13 AC2)
  weaponIds: z.array(ItemId).min(1), sourceUrl: WikiUrl, _prov: Prov,
});
```
Core combat numbers (damage, crit, use time, mana, knockback) live on the Weapon, NOT in archetype params — the sim reads both; params describe only shape/behavior.

### 2.5 Armor, ArmorSet, Accessory
```ts
export const ArmorPiece = z.strictObject({
  ...itemCommon, type: z.literal("armor"),
  slot: z.enum(["head","chest","legs"]),
  defense: z.int().nonnegative(),
  effects: z.array(StatEffect),        // per-piece (not set bonus)
  setId: Slug.optional(),
});

export const ArmorSet = z.strictObject({
  id: Slug, name: z.string().min(1),
  pieces: z.strictObject({ helmets: z.array(ItemId).min(1), chest: ItemId, legs: ItemId }),
  variants: z.array(z.strictObject({   // exactly one per helmet (validated bijection)
    helmetId: ItemId, class: DamageClass,       // "other" for classless sets
    setBonus: z.array(StatEffect).min(1),       // non-stat bonuses use kind:"special"
    setBonusText: z.string().min(1),
  })).min(1),
  stage: Stage.optional(), wikiUrl: WikiUrl, _prov: Prov,
});

export const Accessory = z.strictObject({
  ...itemCommon, type: z.literal("accessory"),
  categories: z.array(z.enum(["mobility","defense","offense","utility"])).min(1),
  effects: z.array(StatEffect).min(1),
  combinedFrom: z.array(ItemId),       // DERIVED from Tinkerer's-Workshop recipes
  upgradesTo: z.array(ItemId),         // DERIVED inverse
  wingStats: z.strictObject({
    flightTimeTicks: z.int().positive().optional(),
    verticalSpeedTps: z.number().positive().optional(),
    hover: z.boolean().optional(),
  }).optional(),
});
```

### 2.6 Item (encyclopedia superset)
```ts
export const ItemCategory = z.enum([
  "material","potion","food","ammo","tool","hook","mount",
  "station","summoning","exploration-utility","other",
]);

export const Item = z.strictObject({
  ...itemCommon, type: z.literal("item"),
  category: ItemCategory,
  consumable: z.boolean().optional(),
  isStation: z.boolean(),              // DERIVED: referenced as station by ≥1 recipe
  ammoStats: z.strictObject({
    ammoClass: AmmoClass, damage: z.int().nonnegative(),
    velocityBonusTps: z.number().optional(), knockback: z.number().nonnegative().optional(),
    projectile: ProjectileSpec.optional(),
  }).optional(),
  toolStats: z.strictObject({
    pickaxePowerPct: z.int().positive().optional(),
    axePowerPct: z.int().positive().optional(),
    hammerPowerPct: z.int().positive().optional(),
  }).optional(),
  hookStats: z.strictObject({
    reachTiles: z.number().positive().optional(), hookCount: z.int().positive().optional(),
    simultaneousLatches: z.int().positive().optional(),
  }).optional(),
  mountStats: z.strictObject({ description: z.string().min(1), sourceUrl: WikiUrl }).optional(),
  buffGrants: z.array(z.strictObject({
    buffId: Slug, durationTicks: z.int().positive().optional(),
  })).optional(),
  summonsBossNode: Slug.optional(),
});
```

### 2.7 Recipe, RecipeGroup, DropSource
```ts
export const RecipeStation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("item"), itemId: ItemId }),
  z.strictObject({ kind: z.literal("environment"), condition: ConditionSlug, name: z.string().min(1) }),
]);

export const Recipe = z.strictObject({
  id: z.string(),                      // `${resultItemId}-${fnv1a32hex(canonicalJson)}` — stable across runs
  resultItemId: ItemId, resultAmount: z.int().positive(),
  stations: z.array(RecipeStation),    // empty = by-hand (explicit, not unknown)
  ingredients: z.array(z.strictObject({
    amount: z.int().positive(),
    ref: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("item"),  itemId: ItemId }),
      z.strictObject({ kind: z.literal("group"), groupId: Slug }),  // "Any Iron Bar"
    ]),
  })).min(1),
  _prov: Prov,
});

export const RecipeGroup = z.strictObject({
  id: Slug, name: z.string().min(1), memberItemIds: z.array(ItemId).min(2), _prov: Prov,
});

const DropRate = z.number().gt(0).lte(1);
export const DropSource = z.strictObject({
  id: z.string(),                      // `${itemId}-${npcSlugOrId}-${fnv1a32hex(conditions)}`
  itemId: ItemId,
  source: z.strictObject({
    npcName: z.string().min(1),
    npcIds: z.array(z.int().positive()).optional(),  // TO-VERIFY-IN-P2
    bossId: Slug.optional(), treasureBag: z.boolean().optional(),
  }),
  quantity: z.strictObject({ min: z.int().positive(), max: z.int().positive() }),
  rates: z.strictObject({              // absent + listed = Unknown
    classic: DropRate.optional(), expert: DropRate.optional(), master: DropRate.optional(),
  }),
  conditions: z.array(ConditionSlug),
  _prov: Prov,
});
```

### 2.8 Boss, ProgressionNode, ProgressionEdge
```ts
export const AttackPatternTag = z.enum([
  "charges","dashes","flies","ground-bound","burrows","teleports",
  "projectile-spam","homing-projectiles","summons-adds","inflicts-debuffs",
  "high-contact-damage","multi-phase","enrage-mechanic","despawn-leash",
]); // curated taxonomy; extend enum explicitly (Feature A mobility analysis keys off these)

const BossStats = z.strictObject({
  hp: z.int().positive(), defense: z.int().nonnegative(),
  contactDamage: z.int().positive().optional(),
});

export const Boss = z.strictObject({
  id: Slug, name: z.string().min(1),
  nodeId: Slug,                        // 1:1 with node (validated symmetric)
  npcIds: z.array(z.int().positive()).optional(),  // multi-part bosses — TO-VERIFY-IN-P2
  wikiUrl: WikiUrl, sprite: z.string().optional(),
  stage: Stage, worldEvil: WorldEvil.optional(),   // ONLY on EoW / BoC
  summon: z.strictObject({
    items: z.array(ItemId), conditions: z.array(ConditionSlug),
    text: z.string().min(1), sourceUrl: WikiUrl,
  }),
  location: z.strictObject({
    biomes: z.array(z.string()).min(1),
    time: z.enum(["day","night","any","dusk"]), text: z.string().optional(),
  }),
  statsByDifficulty: z.strictObject({
    classic: BossStats.optional(), expert: BossStats.optional(), master: BossStats.optional(),
  }),
  attackPatternTags: z.array(AttackPatternTag).min(1),   // curated ⇒ editorialFields
  dropIds: z.array(z.string()),        // DERIVED from DropSource.source.bossId
  suggestedEquipment: z.array(z.strictObject({           // curated ⇒ editorialFields
    class: DamageClass, weapons: z.array(ItemId).min(1),
    armorSetIds: z.array(Slug), accessories: z.array(ItemId),
    buffs: z.array(Slug), note: z.string().optional(),
  })),
  prepChecklist: z.array(z.strictObject({                // curated ⇒ editorialFields
    text: z.string().min(1), itemIds: z.array(ItemId).optional(), sourceUrl: WikiUrl.optional(),
  })),
  strategies: z.array(z.strictObject({                   // curated ⇒ editorialFields
    class: DamageClass.optional(), difficulty: Difficulty.optional(),
    text: z.string().min(1), sourceUrl: WikiUrl,
  })),
  _prov: Prov,
});

export const ProgressionNode = z.strictObject({
  id: Slug, kind: z.enum(["boss","event","milestone"]),
  bossId: Slug.optional(),             // REQUIRED iff kind==="boss" (refinement in validate)
  name: z.string().min(1), stage: Stage,
  worldEvil: WorldEvil.optional(), wikiUrl: WikiUrl, _prov: Prov,
});

export const ProgressionEdge = z.strictObject({
  from: Slug, to: Slug,
  type: z.enum(["required-gate","recommended-next","optional",
                "alternative-route","early-challenge-possible"]),
  note: z.string().optional(),
  sourceUrl: WikiUrl,                  // per-edge provenance (P2-S6 AC2)
  _prov: Prov,
});
```

### 2.9 Buff, Condition registry
```ts
export const Buff = z.strictObject({
  id: Slug, gameBuffId: z.int().positive().optional(),  // TO-VERIFY-IN-P2
  name: z.string().min(1), isDebuff: z.boolean(),
  effects: z.array(StatEffect),
  dot: z.strictObject({ dps: z.number().positive() }).optional(),  // iff damaging debuff
  sprite: z.string().optional(), wikiUrl: WikiUrl, _prov: Prov,
});

export const Condition = z.strictObject({    // conditions.json registry
  id: Slug,                            // "hardmode", "post-plantera", "blood-moon", "near-water"…
  name: z.string().min(1),
  kind: z.enum(["world-state","event","biome","environment","time"]),
  satisfiedByNode: Slug.optional(),    // hardmode ⇐ node "wall-of-flesh" — makes gating derivation pure
  description: z.string().min(1), wikiUrl: WikiUrl, _prov: Prov,
});
```

### 2.10 SearchDoc (MiniSearch input)
```ts
export const SearchDoc = z.strictObject({
  id: TypedRef, name: z.string().min(1),
  type: z.enum(["weapon","armor","accessory","item","boss","set","buff"]),
  class: DamageClass.optional(), stage: Stage.optional(),
  rarity: Rarity.optional(), tags: z.array(Slug),
});
// MiniSearch: fields ["name","tags"]; storeFields ["type","class","stage","rarity"];
// idField "id"; prefix:true, fuzzy:0.2, boost {name:2}; facet filters over storeFields.
```

## 3. Indexes and keys

| Entity | PK | Constraints | Emitted structure |
|---|---|---|---|
| Weapon/ArmorPiece/Accessory/Item | game item ID | ID + slug unique across all four | detail = `Record<itemId, Record>`; list = arrays |
| ArmorSet | slug | helmets no dupes; variants ⇄ helmets bijective | map by slug |
| Recipe | `${resultItemId}-${fnv1a32hex(canonical)}` (sorted stations + ingredient pairs) | collision ⇒ validate failure, suffix `-2` | array sorted by resultItemId |
| DropSource | `${itemId}-${npcNameSlug}-${fnv1a32hex(sortedConditions)}` | unique | array sorted by itemId |
| Groups/Boss/Node/Buff/Scenario/Condition | slug | unique per collection | maps by slug |
| ProgressionEdge | composite (from,to,type) | unique triple; no self-loops | array in progression.json |

**Runtime-built inverse indexes (NOT emitted):** `recipesByResult`, `recipesByIngredient` (crafting tree + Feature B), `dropsByItem`, `dropsByBoss`, `edgesByFrom/byTo`, `setByPieceId` — contract `getIndexes(): DataIndexes`, built lazily. Emit only if a budget breaks (ADR D7).

## 4. Contracts (no server — ADR D8)

### 4a. Data access (`src/data-access/`)
| Contract | Signature | Error cases |
|---|---|---|
| Load meta | `loadMeta(): Promise<Meta>` | `ChunkLoadError`; `SchemaVersionError` if dataSchemaVersion mismatch |
| Load list | `loadList(type): Promise<ListRecord[]>` | `ChunkLoadError`; `DataValidationError` (dev-only Zod parse) |
| Load detail | `loadDetail(type, id): Promise<DetailRecord>` | `ChunkLoadError`; `NotFoundError{ref}` → styled 404 |
| Load graph | `loadProgression(): Promise<{nodes, edges}>` | `ChunkLoadError` |
| Load search docs | `loadSearchDocs(): Promise<SearchDoc[]>` | `ChunkLoadError`; search UI shows designed error state |
| Field read | `getField(record, dotPath): FieldView` | never throws; unknown path = not-applicable (dev-warn) |
| Indexes | `getIndexes(): Promise<DataIndexes>` | propagates ChunkLoadError |
| Gating check | `isObtainableNow(item, progress, settings): {status:"yes"\|"gated"\|"unknown", missing:{bosses,conditions}}` | pure; "unknown" whenever gatedBy unverified/absent — Feature A/B MUST surface "Unknown", never "yes" |

### 4b. Storage (`src/storage/`, ADR D6)
| Contract | Signature | Error cases |
|---|---|---|
| Load | `loadDomain<D>(domain): {data,migratedFrom?} \| {quarantined,key} \| {empty}` | corrupt/unmigratable ⇒ `tc.quarantine.<domain>.<ISO>` + visible notice |
| Save | `saveDomain(domain, data): void` | `StorageQuotaError` ⇒ visible warning, state kept in memory; atomic single setItem |
| Export build | `exportBuild(build): string` | — |
| Import build | `importBuild(text): {build} \| {error:"malformed-code"\|"unknown-items", unknownNames?}` | explicit failures |

`DomainKey = "builds"|"favorites"|"progress"|"plans"|"recent"|"settings"|"readiness"`. Note: `tc.v1.readiness` extends ADR D6's key list (same convention) — required by Feature A AC4.

## 5. Emitted file layout (`src/data/`, each ≤300 KB gz per ADR D7)

| File | Shape |
|---|---|
| `meta.json` / `gaps.json` | Meta / Gaps (§7d) |
| `search-docs.json` | `SearchDoc[]` (~6.4k) |
| `weapons.list.json` | list fields: id,name,slug,type,damageClass,stage,rarity,damage,useTimeTicks,sprite,tags,labKind |
| `weapons.detail.json` | `Record<itemId, Weapon>` (full incl. labBehavior, acquisition, _prov) |
| `armor.list/detail.json` | list adds slot,defense,setId |
| `armor-sets.json` | `Record<slug, ArmorSet>` |
| `accessories.list/detail.json` | list adds categories |
| `items.list/detail.json` | list adds category; FIRST sharding candidate: `items.detail.<n>.json` by ID ranges + `items.detail.index.json` |
| `recipes.json` / `recipe-groups.json` | `Recipe[]` / map |
| `drops.json` | `DropSource[]` |
| `bosses.json` / `progression.json` / `buffs.json` / `conditions.json` / `lab-scenarios.json` | maps / `{nodes, edges}` |
| `public/sprites/manifest.json` | `{files:[{path, wikiFileUrl, rights:"re-logic"}], fallbackMode:boolean}` (D3 takedown lever) |

**List vs detail rule:** list carries exactly browse/filter/sort/compare-picker + search-card fields; a list record MUST be a projection of its detail record (validated at emit).

## 6. Error taxonomy
**App:** `ChunkLoadError{file,cause}`, `SchemaVersionError{expected,found}`, `NotFoundError{ref}`, `DataValidationError{file,zodIssues}` (dev), `StorageQuotaError{domain}`, `{quarantined,key}`, import `"malformed-code"|"unknown-items"`.
**Pipeline (build-failing):** `E_FETCH`, `E_PARSE_LUA`, `E_PARSE_CARGO`, `E_SCHEMA{ref,zodIssues}`, `E_DANGLING_REF{fromRef,field,toRef}`, `E_DUPLICATE_ID`, `E_LIST_DETAIL_DRIFT`, `E_GRAPH_CYCLE` (required-gate subgraph), `E_SUGGESTION_GATING{bossId,itemRef}` (suggested equipment gated behind the boss itself or later), `E_UNVERIFIED_VALUE_EMITTED`, `E_LAB_UNHANDLED{itemId}`, `E_BUDGET{file,gzBytes}`, `E_FIXTURE{name}`. Expected data gaps are NOT errors — they downgrade to `verified:false` + gaps.json entries.

## 7. Validation + pipeline stage contract

### 7a. Referential integrity (validate stage; failure = build fails)
1. Every Recipe result/ingredient/group-member/station itemId exists.
2. Every DropSource.itemId exists; bossId resolves.
3. `Boss.dropIds` exactly equals derived set (consistency).
4. Boss.nodeId ⇄ Node.bossId symmetric 1:1; bossId present iff kind "boss".
5. Boss summon items / prepChecklist / suggestedEquipment all resolve. ADDITIONALLY: every suggested item's `gatedBy.bosses` must be strictly upstream of this boss in the required-gate DAG — **Feature A honesty enforced at build time** (`E_SUGGESTION_GATING`).
6. ArmorSet pieces resolve w/ matching slot; back-refs consistent; variants bijective over helmets.
7. `combinedFrom/upgradesTo` exactly match Tinkerer's-Workshop derivation (symmetry).
8. Edges resolve; no self-loops; required-gate subgraph is a DAG; EoW/BoC both carry worldEvil + joined by alternative-route edges.
9. All slug references (gatedBy, conditions, dot.buffId, buffGrants, scenarioId) resolve to registries.
10. `Weapon.ammoClass` matches ≥1 Item with equal `ammoStats.ammoClass` (P3-S4 ammo picker non-empty by construction).
11. Every entity appears exactly once in search-docs; every SearchDoc ref resolves.
12. Conditional refinements: piercing-beam pierce iff pierce-projectile, tickRateTicks iff channel-beam; fuseTicks iff timed; sentryRangeTiles iff sentry.
13. **Fixtures (P2-S6 AC3 as data tests):** wall-of-flesh --required-gate--> hardmode milestone; plantera has required-gate paths from all three mech bosses; deerclops + queen-bee optional (no required-gate into main line); weapon count reconciles vs wiki category count in gap report (P2-S2 AC1).

### 7b. gatedBy derivation (pure, deterministic)
Per item: union over acquisition routes of (route conditions + drop conditions + recursive ingredient gating via recipes, cycle-guarded) → map conditions with `satisfiedByNode` to boss nodes → transitive-reduce against required-gate DAG → `{bosses, conditions, stage=max implied}`. Multiple routes: gate set = **minimum over routes** (any one obtainable route suffices — powers "Find an Easier Route"). Any unverified input in the chain → omit gatedBy, list in unverifiedFields, emit `gating-underived` gap.

### 7c. Stages
| Stage | Input → Output | Failure |
|---|---|---|
| fetch | SyncPlan → `raw/` cache (gitignored): iteminfo.lua+{rev,fetchedAt}, cargo pages, images; FetchRecord each | E_FETCH; backoff per D2 |
| parse | raw/ → ParsedSources (raw-row schemas LENIENT/passthrough — distinct from strict emit schemas) | E_PARSE_* |
| merge | parsed + overlays (`pipeline/overlays/*.json`, schema-validated incl. mandatory sourceUrl) → MergedEntity[] w/ per-field source tags; **Iteminfo wins numeric conflicts**; overlay fields tagged editorial | E_SCHEMA |
| cross-check | merged → + Discrepancy[]; mismatch ⇒ strip value, add unverifiedFields, verified:false, gap entry; count reconciliation | never fatal |
| validate | merged + derived (gatedBy, dropIds, combinedFrom/upgradesTo, isStation, lab downgrade §2.1-3) → strict-parsed collections | all §6 pipeline errors |
| emit | collections → `src/data/*.json` + meta + gaps + sprite manifest; gz budgets; list⊂detail check | E_BUDGET, E_LIST_DETAIL_DRIFT |

### 7d. Meta + Gaps
```ts
export const Meta = z.strictObject({
  gameVersion: z.literal(GAME_VERSION),
  dataSchemaVersion: z.literal(DATA_SCHEMA_VERSION),
  generatedAt: IsoDateTime,
  iteminfo: z.strictObject({ rev: z.int().positive(), syncedTo: z.string() }),  // "1.4.5.7" caveat
  counts: z.record(z.string(), z.int().nonnegative()),
  license: z.string(),
  gapSummary: z.strictObject({ total: z.int().nonnegative(),
                               byKind: z.record(z.string(), z.int().nonnegative()) }),
});

export const GapEntry = z.strictObject({
  ref: TypedRef, field: z.string().optional(),
  kind: z.enum(["missing-field","source-mismatch","sync-lag-1457","missing-sprite",
                "count-reconciliation","unverified-drop-rate","gating-underived",
                "lab-limitation-default"]),
  detail: z.string().min(1), sources: z.array(z.url()),
});
export const Gaps = z.strictObject({
  generatedAt: IsoDateTime, gameVersion: z.literal(GAME_VERSION),
  summary: z.strictObject({
    perEntity: z.record(z.string(), z.strictObject({
      total: z.int(), verified: z.int(), withUnverifiedFields: z.int() })),
    labCoverage: z.strictObject({        // P3-S13 coverage report source
      archetype: z.int(), customScenario: z.int(), limitation: z.int(),
      unhandled: z.literal(0),           // schema itself enforces the gate
    }),
  }),
  entries: z.array(GapEntry),
});
```

## 8. Persistence (ADR D6, `tc.v1.*`)

### 8a. Envelope + domain schemas
```ts
export const envelope = <T extends z.ZodType>(data: T) => z.strictObject({
  v: z.int().positive(), savedAt: IsoDateTime,
  gameVersion: z.string(),   // mismatch ⇒ advisory banner, not an error
  data,
});

export const LoadoutClass = z.enum(["melee","ranged","magic","summon","hybrid"]);
export const Goal = z.enum(["max-damage","survivability","mobility","exploration","boss","balanced"]);

export const LoadoutSlots = z.strictObject({   // null = deliberately empty (only legal null)
  mainWeapon: ItemId.nullable(), altWeapon: ItemId.nullable(),
  helmet: ItemId.nullable(), chest: ItemId.nullable(), legs: ItemId.nullable(),
  accessories: z.array(ItemId.nullable()).min(5).max(7),  // 5 classic / 6 expert / 7 master
  ammo: z.array(ItemId), buffs: z.array(ItemId),  // buff-granting ITEMS (potions), not buff slugs
  summon: ItemId.nullable(),
});

export const SavedBuildV1 = z.strictObject({
  buildId: z.string().min(8), name: z.string().min(1),
  createdAt: IsoDateTime, updatedAt: IsoDateTime,
  stage: Stage, class: LoadoutClass, difficulty: Difficulty,
  goal: Goal.optional(), slots: LoadoutSlots, notes: z.string().optional(),
});
export const BuildsV1 = envelope(z.strictObject({ builds: z.array(SavedBuildV1) }));

export const ProgressV1 = envelope(z.strictObject({
  worldEvil: WorldEvil.nullable(),
  nodeStates: z.record(Slug, z.enum(["defeated","skipped"])),  // absent = not attempted
}));

export const PlanStepV1 = z.strictObject({
  stepId: z.string(),      // deterministic: hash of (kind, refs, amount)
  kind: z.enum(["craft","gather","defeat-boss","purchase","fish","loot","event","other"]),
  text: z.string().min(1),
  itemId: ItemId.optional(), amount: z.int().positive().optional(),
  nodeId: Slug.optional(),
  groupKey: z.string(),    // biome/enemy/boss/activity grouping (P6-S6 AC2)
  refs: z.array(TypedRef),
});
export const PlanV1 = z.strictObject({
  planId: z.string().min(8), targetItemId: ItemId,
  createdAt: IsoDateTime, updatedAt: IsoDateTime,
  status: z.enum(["active","done"]),
  stageAtCreation: Stage,
  snapshot: z.strictObject({ generatedAt: IsoDateTime, gameVersion: z.string(),
                             steps: z.array(PlanStepV1).min(1) }),  // regenerable snapshot
  owned: z.record(z.string(), z.int().nonnegative()),   // itemId(string) → qty
  checkedStepIds: z.array(z.string()),
});
export const PlansV1 = envelope(z.strictObject({ plans: z.array(PlanV1) }));

export const FavoritesV1 = envelope(z.strictObject({ refs: z.array(TypedRef) }));
export const RecentV1 = envelope(z.strictObject({
  entries: z.array(z.strictObject({ ref: TypedRef, viewedAt: IsoDateTime })).max(20) }));
export const SettingsV1 = envelope(z.strictObject({
  selectedStage: Stage.nullable(), spriteFallback: z.boolean(),
  labIgnoreManaDefault: z.boolean(),
}));
export const ReadinessV1 = envelope(z.strictObject({    // tc.v1.readiness (Feature A AC4)
  bossId: Slug.nullable(), difficulty: Difficulty, class: LoadoutClass,
  loadout: LoadoutSlots,
  analyzedAt: IsoDateTime.nullable(),  // analysis recomputed deterministically from inputs
}));
```

### 8b. Migration convention
`migrations: Record<DomainKey, Array<(prev: unknown) => unknown>>` — index `i` migrates `i+1 → i+2`. loadDomain: peek `{v}` leniently → run `migrations[domain].slice(v-1)` → strict-parse current schema → on throw, quarantine + return quarantine result. New field with default = new version + trivial migration (no silent widening). CI runs round-trip tests on recorded v1 fixtures.

### 8c. Status transitions
- **Node:** not-attempted (absent) → defeated | skipped; any→any; global reset confirmed (P5-S4 AC3), clears nodeStates only.
- **Plan:** active → done when checkedStepIds ⊇ all stepIds (auto); un-check reverts (P6-S6 AC4); delete confirmed. Stale snapshot (gameVersion ≠ meta) ⇒ banner + offered regeneration, never silent rewrite.
- **Record verification:** extracted → cross-checked → verified | unverified (gap-listed) → re-verified via curated confirmation or next sync.
- **Storage payload:** valid → migrated → quarantined (terminal until user exports/deletes; visible).
- **Sprite mode:** normal → fallbackMode (manifest flag, D3 takedown lever).

## 9. Risks + TO-VERIFY-IN-P2

**Risks:** A1 item-ID stability across patches (assumed; mitigated by envelope gameVersion + name-fallback import). A2 Iteminfo 1.4.5.7 sync lag (gap kind `sync-lag-1457`). A3 `stage` is derived/curated, not a wiki field — items without stage are EXCLUDED from stage-legal recommendations (under-recommend, never leak gated items). A4 buff stats overlay-heavy (bounded: only Lab/loadout-referenced buffs need structure in v1). A5 schema evolution: DATA_SCHEMA_VERSION bumps on breaking changes only; app+data deploy atomically. A6 strictObject everywhere: new emitted fields require schema change first (intentional).

**TO-VERIFY-IN-P2 (resolve with live wiki access; never guess):**
1. Cargo Items exact columns (type/class, rarity encoding). 2. Recipe-group encoding in Recipes.ingredients/ings/args. 3. Drops NPC IDs vs names; multi-part boss attribution. 4. NPCs table per-difficulty hp/defense. 5. Equipinfo columns (defense, tooltip, wing flight time). 6. Weapon_source → Acquisition mapping. 7. Exclusive table semantics (desktop-only filter). 8. Imageinfo → sprite file resolution. 9. Special rarity tiers encoding. 10. useTime vs useAnimation semantics per class (sim attack rate). 11. Ammo damage/velocity modifier location. 12. Structured buff-ID source. 13. Cargo paging default (500 assumed).
