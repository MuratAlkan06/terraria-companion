/**
 * The sim's deterministic trig (AMENDMENTS-016 B147, src/sim/trig.ts): pinned bits that every platform must
 * reproduce, accuracy measured against an exact 320-bit BigInt reference (not against `Math`, whose bits are
 * the platform-dependent thing being replaced), and the IEEE special cases.
 */
import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'
import { atan2, cos, sin } from './trig'

// ── exact reference: fixed point with P fractional bits ──────────────────────────────────────────────
const P = 320n
const ONE = 1n << P

/** atan(1/k) · 2^P (Machin series). */
function atanInverse(k: bigint): bigint {
  const k2 = k * k
  let sum = 0n
  let power = ONE / k
  for (let n = 0n; power !== 0n; n++) {
    sum += (n % 2n === 0n ? 1n : -1n) * (power / (2n * n + 1n))
    power /= k2
  }
  return sum
}
const PI_F = 16n * atanInverse(5n) - 4n * atanInverse(239n)

const view = new DataView(new ArrayBuffer(8))
/** |x| = mant · 2^exp exactly (exp = the ulp's exponent for a normal x). */
function decompose(x: number): { mant: bigint; exp: number } {
  view.setFloat64(0, Math.abs(x))
  const hi = view.getUint32(0)
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(view.getUint32(4))
  const biased = hi >>> 20
  return biased === 0 ? { mant: frac, exp: -1074 } : { mant: frac | (1n << 52n), exp: biased - 1075 }
}
/** x · 2^P, exact for |x| ≥ 2^-268. */
function toFixed(x: number): bigint {
  const { mant, exp } = decompose(x)
  const shift = BigInt(exp) + P
  const v = shift >= 0n ? mant << shift : mant >> -shift
  return x < 0 ? -v : v
}
/** |approx − ref| in ulps of the correctly rounded reference. */
function ulpError(approx: number, ref: bigint): number {
  const rounded = Number(ref) / 2 ** Number(P)
  const ulp = 1n << BigInt(decompose(rounded).exp + Number(P))
  const err = toFixed(approx) - ref
  return Number(((err < 0n ? -err : err) << 32n) / ulp) / 2 ** 32
}

function sinCosRef(x: number): { sin: bigint; cos: bigint } {
  const twoPi = 2n * PI_F
  const X = toFixed(x)
  let r = X - (X / twoPi) * twoPi
  if (r > PI_F) r -= twoPi
  if (r < -PI_F) r += twoPi
  const r2 = (r * r) / ONE
  let s = 0n
  let c = 0n
  let sTerm = r
  let cTerm = ONE
  for (let n = 1n; sTerm !== 0n || cTerm !== 0n; n++) {
    s += sTerm
    c += cTerm
    sTerm = -((sTerm * r2) / ONE) / ((2n * n) * (2n * n + 1n))
    cTerm = -((cTerm * r2) / ONE) / ((2n * n - 1n) * (2n * n))
  }
  return { sin: s, cos: c }
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1)
  for (;;) {
    const y = (x + n / x) >> 1n
    if (y >= x) return x
    x = y
  }
}
/** atan(t) · 2^P for 0 ≤ t ≤ 1 (fixed point): three half-angle steps, then the series. */
function atanFixed(t: bigint): bigint {
  let u = t
  for (let i = 0; i < 3; i++) u = (u * ONE) / (ONE + isqrt(ONE * ONE + u * u))
  const u2 = (u * u) / ONE
  let sum = 0n
  let power = u
  for (let n = 0n; power !== 0n; n++) {
    sum += (n % 2n === 0n ? 1n : -1n) * (power / (2n * n + 1n))
    power = (power * u2) / ONE
  }
  return 8n * sum
}
function atan2Ref(y: number, x: number): bigint {
  const Y = toFixed(y)
  const X = toFixed(x)
  const a = Y < 0n ? -Y : Y
  const b = X < 0n ? -X : X
  let phi = a <= b ? atanFixed((a * ONE) / b) : PI_F / 2n - atanFixed((b * ONE) / a)
  if (X < 0n) phi = PI_F - phi
  return Y < 0n ? -phi : phi
}

// ── deterministic samples ────────────────────────────────────────────────────────────────────────────
const DEG = Math.PI / 180
function angleSamples(): number[] {
  const rng = mulberry32(147)
  const xs: number[] = []
  for (let i = 0; i < 1500; i++) xs.push((rng.next() - 0.5) * 16 * Math.PI) // |x| ≤ 8π
  for (let d = -720; d <= 720; d++) xs.push(d * DEG) // whole degrees, as the sim's spreads and arcs
  for (let k = 1; k <= 64; k++) {
    // next to multiples of π/2: the reduction's cancellation cases
    const near = (k * Math.PI) / 2
    xs.push(near, near * (1 + Number.EPSILON), near * (1 - Number.EPSILON), -near)
  }
  for (let i = 0; i < 100; i++) xs.push((rng.next() - 0.5) * 2 ** (-30 + rng.next() * 28)) // small
  for (let i = 0; i < 100; i++) xs.push((rng.next() - 0.5) * 3e6) // medium, up to 2^20·π/2
  return xs.filter((x) => x !== 0)
}
function vectorSamples(): Array<[number, number]> {
  const rng = mulberry32(2147)
  const pairs: Array<[number, number]> = []
  const signed = () => (rng.next() < 0.5 ? -1 : 1) * (0.5 + rng.next()) * 2 ** Math.round((rng.next() - 0.5) * 60)
  for (let i = 0; i < 1500; i++) pairs.push([signed(), signed()])
  for (let dy = -10; dy <= 10; dy += 0.5) for (let dx = -10; dx <= 10; dx += 0.5) if (dx !== 0 && dy !== 0) pairs.push([dy, dx]) // aim deltas
  return pairs
}

describe('deterministic trig (B147)', () => {
  it('reproduces pinned bits on every platform (these literals are the engine’s own results)', () => {
    // Number literals of ≤ 17 significant digits parse to exactly one double in every engine, and toBe
    // compares with Object.is — so each line pins all 64 bits.
    expect(sin(0.5)).toBe(0.479425538604203)
    expect(sin(1)).toBe(0.8414709848078965)
    expect(sin(3)).toBe(0.1411200080598672)
    expect(sin(-10)).toBe(0.5440211108893698)
    expect(sin(100)).toBe(-0.5063656411097588)
    expect(sin(Math.PI)).toBe(1.2246467991473532e-16)
    expect(sin(10 * DEG)).toBe(0.17364817766693033)
    expect(sin(-0.0331)).toBe(-0.03309395621592434)
    expect(sin(12345.678)).toBe(-0.7040813137533816)
    expect(sin(1e10)).toBe(-0.48750568473044187) // past 2^20·π/2: the x % 2π fallback (exact: −0.4875060250875107)
    expect(cos(0.5)).toBe(0.8775825618903728)
    expect(cos(2)).toBe(-0.4161468365471424)
    expect(cos(Math.PI / 2)).toBe(6.123233995736766e-17)
    expect(cos(10 * DEG)).toBe(0.984807753012208)
    expect(cos(-7.25)).toBe(0.5679241732886948)
    expect(cos(12345.678)).toBe(0.7101193587160628)
    expect(atan2(1, 2)).toBe(0.4636476090008061)
    expect(atan2(-3, 7)).toBe(-0.4048917862850834)
    expect(atan2(0.5, -4)).toBe(3.017237659043032)
    expect(atan2(-2, -2)).toBe(-2.356194490192345)
    expect(atan2(1e-10, 1)).toBe(1e-10)
    expect(atan2(3, 1e-12)).toBe(1.5707963267945633)
    expect(atan2(0.1, 0.30000000000000004)).toBe(0.3217505543966422)
    // Inputs whose native Math result differs in the last bit on at least one platform (macOS arm64,
    // Node 23): the engine's own bits, not the platform's.
    expect(sin(0.48)).toBe(0.46177917554148284)
    expect(cos(0.1)).toBe(0.9950041652780258)
    expect(atan2(4.8, -1.6666666666666667)).toBe(1.9049943710604)
  })

  it('sin and cos are within 1 ulp of the exact value (320-bit reference)', () => {
    let worstSin = 0
    let worstCos = 0
    for (const x of angleSamples()) {
      const ref = sinCosRef(x)
      worstSin = Math.max(worstSin, ulpError(sin(x), ref.sin))
      worstCos = Math.max(worstCos, ulpError(cos(x), ref.cos))
    }
    expect(worstSin).toBeLessThan(1)
    expect(worstCos).toBeLessThan(1)
  })

  it('atan2 is within 1.5 ulp of the exact value (320-bit reference)', () => {
    // fdlibm rounds the quotient y/x (≤ ½ ulp) before its < 1 ulp atan, so atan2's bound is their sum.
    // Measured worst on this sample: 1.0021 ulp, at atan2(664486425, 1238907201.75) — the same error
    // V8's own fdlibm-derived Math.atan2 makes there.
    let worst = 0
    for (const [y, x] of vectorSamples()) worst = Math.max(worst, ulpError(atan2(y, x), atan2Ref(y, x)))
    expect(worst).toBeLessThan(1.5)
  })

  it('symmetry holds exactly: sin(−x) = −sin(x), cos(−x) = cos(x), atan2(−y, x) = −atan2(y, x)', () => {
    for (const x of angleSamples()) {
      expect(sin(-x)).toBe(-sin(x))
      expect(cos(-x)).toBe(cos(x))
    }
    for (const [y, x] of vectorSamples()) expect(atan2(-y, x)).toBe(-atan2(y, x))
  })

  it('special values follow IEEE / fdlibm', () => {
    expect(sin(0)).toBe(0)
    expect(sin(-0)).toBe(-0)
    expect(cos(-0)).toBe(1)
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(sin(v)).toBeNaN()
      expect(cos(v)).toBeNaN()
    }
    expect(Math.abs(sin(1e300))).toBeLessThanOrEqual(1)
    expect(Math.abs(cos(-1e300))).toBeLessThanOrEqual(1)
    const PI = Math.PI
    const table: Array<[number, number, number]> = [
      [0, 1, 0],
      [-0, 1, -0],
      [0, -1, PI],
      [-0, -1, -PI],
      [0, -0, PI],
      [-0, -0, -PI],
      [0, 0, 0],
      [1, 0, PI / 2],
      [-1, -0, -PI / 2],
      [Infinity, Infinity, PI / 4],
      [-Infinity, Infinity, -PI / 4],
      [Infinity, -Infinity, (3 * PI) / 4],
      [-Infinity, -Infinity, (-3 * PI) / 4],
      [1, Infinity, 0],
      [-1, Infinity, -0],
      [1, -Infinity, PI],
      [-1, -Infinity, -PI],
      [Infinity, 5, PI / 2],
      [-Infinity, -5, -PI / 2],
      [1, 1, PI / 4],
      [1e300, 1e-300, PI / 2],
      [1e-300, -1e300, PI],
    ]
    for (const [y, x, want] of table) expect(atan2(y, x), `atan2(${y}, ${x})`).toBe(want)
    expect(atan2(NaN, 1)).toBeNaN()
    expect(atan2(1, NaN)).toBeNaN()
  })
})
