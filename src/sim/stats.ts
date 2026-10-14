/**
 * Snapshot-able stats accumulator (PRD P3-S1 AC3, P3-S3 AC1–3; UX_SPEC §3.4 StatReadout/DpsGraph).
 * All damage values are integers, so totals are exact and bit-identical across runs.
 */
import { MAX_DPS_SERIES_SECONDS, TICKS_PER_SECOND } from './constants'
import type { DamageBreakdown, DamageSourceKind, DummyStats, StatsSnapshot } from './types'

const emptyDummy = (): DummyStats => ({ damage: 0, directDamage: 0, dotDamage: 0, hits: 0, crits: 0 })
const emptyBreakdown = (): DamageBreakdown => ({ weaponDamage: 0, weaponHits: 0, summonDamage: 0, summonHits: 0, tagBonusDamage: 0, dotDamage: 0 })

export class StatsAccumulator {
  private ticks = 0
  private directDamage = 0
  private dotDamage = 0
  private hits = 0
  private crits = 0
  private uses = 0
  private activations = 0
  private projectilesSpawned = 0
  private ammoConsumed = 0
  private consumablesUsed = 0
  private explosions = 0
  private manaConsumed = 0
  private debuffsApplied = 0
  private lastHit: StatsSnapshot['lastHit'] = null
  private tickDamage = 0
  private readonly window = new Array<number>(TICKS_PER_SECOND).fill(0)
  private windowIndex = 0
  private windowSum = 0
  private series: number[] = []
  private seriesStartSecond = 0
  private currentSecondDamage = 0
  private perDummy = new Map<string, DummyStats>()
  private breakdown = emptyBreakdown()
  private readonly dummyIds: readonly string[]

  constructor(dummyIds: readonly string[]) {
    this.dummyIds = [...dummyIds]
    this.reset()
  }

  reset(): void {
    this.ticks = 0
    this.directDamage = 0
    this.dotDamage = 0
    this.hits = 0
    this.crits = 0
    this.uses = 0
    this.activations = 0
    this.projectilesSpawned = 0
    this.ammoConsumed = 0
    this.consumablesUsed = 0
    this.explosions = 0
    this.manaConsumed = 0
    this.debuffsApplied = 0
    this.lastHit = null
    this.tickDamage = 0
    this.window.fill(0)
    this.windowIndex = 0
    this.windowSum = 0
    this.series = []
    this.seriesStartSecond = 0
    this.currentSecondDamage = 0
    this.perDummy = new Map(this.dummyIds.map((id) => [id, emptyDummy()]))
    this.breakdown = emptyBreakdown()
  }

  /** `tagBonus`: the part of a summon hit a whip tag added (README "Summons"). */
  damage(dummyId: string, amount: number, crit: boolean, source: DamageSourceKind, tick: number, tagBonus = 0): void {
    const d = this.perDummy.get(dummyId) ?? emptyDummy()
    this.perDummy.set(dummyId, d)
    d.damage += amount
    const b = this.breakdown
    if (source === 'minion' || source === 'sentry') {
      b.summonDamage += amount
      b.summonHits++
      b.tagBonusDamage += tagBonus
    } else if (source === 'dot') {
      b.dotDamage += amount
    } else {
      b.weaponDamage += amount
      b.weaponHits++
    }
    if (source === 'dot') {
      this.dotDamage += amount
      d.dotDamage += amount
    } else {
      this.directDamage += amount
      this.hits++
      d.directDamage += amount
      d.hits++
      if (crit) {
        this.crits++
        d.crits++
      }
      this.lastHit = { amount, crit, tick, dummyId }
    }
    this.tickDamage += amount
  }

  use(): void {
    this.uses++
  }
  activation(): void {
    this.activations++
  }
  projectile(): void {
    this.projectilesSpawned++
  }
  ammo(count: number): void {
    this.ammoConsumed += count
  }
  consumable(count: number): void {
    this.consumablesUsed += count
  }
  explosion(): void {
    this.explosions++
  }
  mana(amount: number): void {
    this.manaConsumed += amount
  }
  debuff(): void {
    this.debuffsApplied++
  }

  /** Closes the current tick: rolling window + per-second graph buckets. */
  endTick(): void {
    this.windowSum += this.tickDamage - this.window[this.windowIndex]
    this.window[this.windowIndex] = this.tickDamage
    this.windowIndex = (this.windowIndex + 1) % TICKS_PER_SECOND
    this.currentSecondDamage += this.tickDamage
    this.tickDamage = 0
    this.ticks++
    if (this.ticks % TICKS_PER_SECOND === 0) {
      this.series.push(this.currentSecondDamage)
      this.currentSecondDamage = 0
      if (this.series.length > MAX_DPS_SERIES_SECONDS) {
        this.series.shift()
        this.seriesStartSecond++
      }
    }
  }

  get elapsedTicks(): number {
    return this.ticks
  }

  snapshot(): StatsSnapshot {
    const elapsedSeconds = this.ticks / TICKS_PER_SECOND
    const totalDamage = this.directDamage + this.dotDamage
    const perDummy: Record<string, DummyStats> = {}
    for (const [id, d] of this.perDummy) perDummy[id] = { ...d }
    return {
      ticks: this.ticks,
      elapsedSeconds,
      totalDamage,
      directDamage: this.directDamage,
      dotDamage: this.dotDamage,
      hits: this.hits,
      crits: this.crits,
      critRate: this.hits > 0 ? this.crits / this.hits : 0,
      uses: this.uses,
      activations: this.activations,
      projectilesSpawned: this.projectilesSpawned,
      ammoConsumed: this.ammoConsumed,
      consumablesUsed: this.consumablesUsed,
      explosions: this.explosions,
      manaConsumed: this.manaConsumed,
      debuffsApplied: this.debuffsApplied,
      lastHit: this.lastHit ? { ...this.lastHit } : null,
      attacksPerSec: elapsedSeconds > 0 ? this.uses / elapsedSeconds : 0,
      estimatedDps: elapsedSeconds > 0 ? totalDamage / elapsedSeconds : 0,
      rollingDps: this.windowSum,
      dpsSeries: [...this.series],
      seriesStartSecond: this.seriesStartSecond,
      currentSecondDamage: this.currentSecondDamage,
      perDummy,
      breakdown: { ...this.breakdown },
    }
  }
}
