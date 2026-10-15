/**
 * Deterministic trigonometry for the sim (AMENDMENTS-016 B147) — the engine owns its math, as it owns its RNG
 * (mulberry32). `Math.sin` / `Math.cos` / `Math.atan2` are NOT bit-reproducible across platforms: V8 builds
 * its trig into the binary, and the arm64 build (macOS, linux) and the x64 build (CI's ubuntu) differ in the
 * last bits — which moved one golden's event digest. These ports use only IEEE-754 basic operations
 * (+, −, ×, ÷, which JS rounds exactly once each, with no fused multiply-add), comparisons, `Math.abs`, `%`
 * (exact) and bit reads through a big-endian DataView, so every conforming JS engine on every CPU computes
 * the same bits. Every constant is built from its fdlibm hex bit pattern, never parsed from a long decimal.
 *
 * Port of FreeBSD msun (fdlibm): k_sin.c, k_cos.c, the medium-size path of e_rem_pio2.c, s_sin.c, s_cos.c,
 * s_atan.c, e_atan2.c. The sim calls only these; the Lab's rendering may keep native Math.
 *
 * Precision (src/sim/trig.test.ts measures it against a 320-bit BigInt reference on ~3 000 inputs each):
 * - sin / cos: kernel polynomials within 2^-58 of the function on [−π/4, π/4] (fdlibm's Remez bounds);
 *   argument reduction by π/2 in three 33-bit pieces, iterated to 151 bits under cancellation — every
 *   result within 1 ulp for |x| < 2^20·π/2 (≈ 1.6 × 10^6 rad); measured worst 0.663 ulp (sin) and 0.702
 *   ulp (cos). Beyond 2^20·π/2 (fdlibm's Payne–Hanek path is not ported) x is first reduced by `x % (2π)` —
 *   still deterministic and within [−1, 1], with an absolute error that grows with |x| (≈ 4 × 10^-17 · |x|).
 *   Sim angles stay within a few π.
 * - atan2: fdlibm's atan (reduction to |t| < 7/16 around atan(½), atan(1), atan(1.5) or atan(∞), then an
 *   odd polynomial of degree 23; < 1 ulp) applied to the rounded quotient y/x — within 1.5 ulp; measured
 *   worst 1.002 ulp. The IEEE special cases (±0, ±Infinity, NaN) as fdlibm defines them.
 * sin(−x) = −sin(x) and cos(−x) = cos(x) hold exactly.
 *
 * Original notice, preserved as its license requires:
 *
 * @license
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * (e_rem_pio2.c, k_cos.c: optimized by Bruce D. Evans.)
 */

const bits = new DataView(new ArrayBuffer(8))

/** The double with IEEE-754 high / low 32-bit words `hi` / `lo` (fdlibm's hex constants). */
function fromWords(hi: number, lo: number): number {
  bits.setUint32(0, hi)
  bits.setUint32(4, lo)
  return bits.getFloat64(0)
}

/** fdlibm GET_HIGH_WORD: the sign, exponent and top 20 mantissa bits of `x`, as a signed int32. */
function highWord(x: number): number {
  bits.setFloat64(0, x)
  return bits.getInt32(0)
}

/** fdlibm GET_LOW_WORD: the low 32 mantissa bits of `x`. */
function lowWord(x: number): number {
  bits.setFloat64(0, x)
  return bits.getUint32(4)
}

// k_sin.c
const S1 = fromWords(0xbfc55555, 0x55555549) // -1.66666666666666324348e-01
const S2 = fromWords(0x3f811111, 0x1110f8a6) //  8.33333333332248946124e-03
const S3 = fromWords(0xbf2a01a0, 0x19c161d5) // -1.98412698298579493134e-04
const S4 = fromWords(0x3ec71de3, 0x57b1fe7d) //  2.75573137070700676789e-06
const S5 = fromWords(0xbe5ae5e6, 0x8a2b9ceb) // -2.50507602534068634195e-08
const S6 = fromWords(0x3de5d93a, 0x5acfd57c) //  1.58969099521155010221e-10

// k_cos.c
const C1 = fromWords(0x3fa55555, 0x5555554c) //  4.16666666666666019037e-02
const C2 = fromWords(0xbf56c16c, 0x16c15177) // -1.38888888888741095749e-03
const C3 = fromWords(0x3efa01a0, 0x19cb1590) //  2.48015872894767294178e-05
const C4 = fromWords(0xbe927e4f, 0x809c52ad) // -2.75573143513906633035e-07
const C5 = fromWords(0x3e21ee9e, 0xbdb4b1c4) //  2.08757232129817482790e-09
const C6 = fromWords(0xbda8fae9, 0xbe8838d4) // -1.13596475577881948265e-11

// e_rem_pio2.c
const INV_PIO2 = fromWords(0x3fe45f30, 0x6dc9c883) // 53 bits of 2/π
const PIO2_1 = fromWords(0x3ff921fb, 0x54400000) // first 33 bits of π/2
const PIO2_1T = fromWords(0x3dd0b461, 0x1a626331) // π/2 − PIO2_1
const PIO2_2 = fromWords(0x3dd0b461, 0x1a600000) // second 33 bits of π/2
const PIO2_2T = fromWords(0x3ba3198a, 0x2e037073) // π/2 − (PIO2_1 + PIO2_2)
const PIO2_3 = fromWords(0x3ba3198a, 0x2e000000) // third 33 bits of π/2
const PIO2_3T = fromWords(0x397b839a, 0x252049c1) // π/2 − (PIO2_1 + PIO2_2 + PIO2_3)
/** 1.5 × 2^52: (v + TO_INT) − TO_INT rounds v to the nearest integer, ties to even (fdlibm rnint). */
const TO_INT = 6755399441055744
/** The large-argument fallback's modulus (2 × Math.PI, exact). */
const TWO_PI = 2 * fromWords(0x400921fb, 0x54442d18)

// s_atan.c
const ATAN_HI = [
  fromWords(0x3fddac67, 0x0561bb4f), // atan(0.5) hi
  fromWords(0x3fe921fb, 0x54442d18), // atan(1.0) hi
  fromWords(0x3fef730b, 0xd281f69b), // atan(1.5) hi
  fromWords(0x3ff921fb, 0x54442d18), // atan(inf) hi
] as const
const ATAN_LO = [
  fromWords(0x3c7a2b7f, 0x222f65e2), // atan(0.5) lo
  fromWords(0x3c81a626, 0x33145c07), // atan(1.0) lo
  fromWords(0x3c700788, 0x7af0cbbd), // atan(1.5) lo
  fromWords(0x3c91a626, 0x33145c07), // atan(inf) lo
] as const
const AT0 = fromWords(0x3fd55555, 0x5555550d) //  3.33333333333329318027e-01
const AT1 = fromWords(0xbfc99999, 0x9998ebc4) // -1.99999999998764832476e-01
const AT2 = fromWords(0x3fc24924, 0x920083ff) //  1.42857142725034663711e-01
const AT3 = fromWords(0xbfbc71c6, 0xfe231671) // -1.11111104054623557880e-01
const AT4 = fromWords(0x3fb745cd, 0xc54c206e) //  9.09088713343650656196e-02
const AT5 = fromWords(0xbfb3b0f2, 0xaf749a6d) // -7.69187620504482999495e-02
const AT6 = fromWords(0x3fb10d66, 0xa0d03d51) //  6.66107313738753120669e-02
const AT7 = fromWords(0xbfadde2d, 0x52defd9a) // -5.83357013379057348645e-02
const AT8 = fromWords(0x3fa97b4b, 0x24760deb) //  4.97687799461593236017e-02
const AT9 = fromWords(0xbfa2b444, 0x2c6a6c2f) // -3.65315727442169155270e-02
const AT10 = fromWords(0x3f90ad3a, 0xe322da11) //  1.62858201153657823623e-02

// e_atan2.c
const TINY = 1.0e-300
const PI_O_4 = fromWords(0x3fe921fb, 0x54442d18)
const PI_O_2 = fromWords(0x3ff921fb, 0x54442d18)
const PI = fromWords(0x400921fb, 0x54442d18)
const PI_LO = fromWords(0x3ca1a626, 0x33145c07)

/** __kernel_sin: sin(x + y) for |x| ≲ π/4, `y` the tail of x (`iy` 0: y is 0). */
function kernelSin(x: number, y: number, iy: 0 | 1): number {
  const z = x * x
  const w = z * z
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6)
  const v = z * x
  if (iy === 0) return x + v * (S1 + z * r)
  return x - ((z * (0.5 * y - v * r) - y) - v * S1)
}

/** __kernel_cos: cos(x + y) for |x| ≲ π/4, `y` the tail of x. */
function kernelCos(x: number, y: number): number {
  const z = x * x
  let w = z * z
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6))
  const hz = 0.5 * z
  w = 1 - hz
  return w + (((1 - w) - hz) + (z * r - x * y))
}

/** The reduced argument of the last `remPio2` call: y0 + y1 = x − n·π/2. */
let reducedHead = 0
let reducedTail = 0

/**
 * __ieee754_rem_pio2, the medium-size path (taken for every |x| > π/4; fdlibm's small-|x| shortcuts are
 * speed paths of the same math, and its Payne–Hanek path for |x| ≥ 2^20·π/2 is replaced by `x % (2π)`).
 * `ix`: the high word of |x|. Returns n (an integer-valued double); the remainder is reducedHead + reducedTail.
 */
function remPio2(x: number, ix: number): number {
  if (ix >= 0x413921fb) {
    x = x % TWO_PI // |x| ≳ 2^20·π/2: deterministic, accuracy degrades (see the header)
    ix = highWord(x) & 0x7fffffff
  }
  const fn = x * INV_PIO2 + TO_INT - TO_INT
  let r = x - fn * PIO2_1
  let w = fn * PIO2_1T // 1st round, good to 85 bits
  const j = ix >> 20
  let y0 = r - w
  if (j - ((highWord(y0) >> 20) & 0x7ff) > 16) {
    // 2nd round, good to 118 bits
    let t = r
    w = fn * PIO2_2
    r = t - w
    w = fn * PIO2_2T - ((t - r) - w)
    y0 = r - w
    if (j - ((highWord(y0) >> 20) & 0x7ff) > 49) {
      // 3rd round, good to 151 bits — covers all cases
      t = r
      w = fn * PIO2_3
      r = t - w
      w = fn * PIO2_3T - ((t - r) - w)
      y0 = r - w
    }
  }
  reducedHead = y0
  reducedTail = (r - y0) - w
  return fn
}

/** Deterministic sin (radians). */
export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    // |x| ≲ π/4
    if (ix < 0x3e500000) return x // |x| < 2^-26 (keeps −0)
    return kernelSin(x, 0, 0)
  }
  if (ix >= 0x7ff00000) return x - x // ±Infinity, NaN → NaN
  switch (remPio2(x, ix) & 3) {
    case 0:
      return kernelSin(reducedHead, reducedTail, 1)
    case 1:
      return kernelCos(reducedHead, reducedTail)
    case 2:
      return -kernelSin(reducedHead, reducedTail, 1)
    default:
      return -kernelCos(reducedHead, reducedTail)
  }
}

/** Deterministic cos (radians). */
export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) {
    // |x| ≲ π/4
    if (ix < 0x3e46a09e) return 1 // |x| < 2^-27·√2
    return kernelCos(x, 0)
  }
  if (ix >= 0x7ff00000) return x - x // ±Infinity, NaN → NaN
  switch (remPio2(x, ix) & 3) {
    case 0:
      return kernelCos(reducedHead, reducedTail)
    case 1:
      return -kernelSin(reducedHead, reducedTail, 1)
    case 2:
      return -kernelCos(reducedHead, reducedTail)
    default:
      return kernelSin(reducedHead, reducedTail, 1)
  }
}

/** s_atan.c: arctangent (radians, in [−π/2, π/2]). */
function atan(x: number): number {
  const hx = highWord(x)
  const ix = hx & 0x7fffffff
  let id: number
  if (ix >= 0x44100000) {
    // |x| ≥ 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lowWord(x) !== 0)) return x + x // NaN
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3]
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x // |x| < 2^-27
    id = -1
  } else {
    x = Math.abs(x)
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 ≤ |x| < 11/16
        id = 0
        x = (2 * x - 1) / (2 + x)
      } else {
        // 11/16 ≤ |x| < 19/16
        id = 1
        x = (x - 1) / (x + 1)
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2
      x = (x - 1.5) / (1 + 1.5 * x)
    } else {
      // 2.4375 ≤ |x| < 2^66
      id = 3
      x = -1 / x
    }
  }
  const z = x * x
  const w = z * z
  // the sum of AT[i]·z^(i+1), split into odd and even polynomials
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))))
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))))
  if (id < 0) return x - x * (s1 + s2)
  const r = ATAN_HI[id] - ((x * (s1 + s2) - ATAN_LO[id]) - x)
  return hx < 0 ? -r : r
}

/** Deterministic atan2 (radians, in [−π, π]): the angle of the vector (x, y). */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return x + y
  const hx = highWord(x)
  const hy = highWord(y)
  const ix = hx & 0x7fffffff
  const iy = hy & 0x7fffffff
  if (x === 1) return atan(y)
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2) // 2·sign(x) + sign(y)

  if (y === 0) {
    // atan2(±0, +anything) = ±0; atan2(±0, −anything) = ±π
    if (m <= 1) return y
    return m === 2 ? PI + TINY : -PI - TINY
  }
  if (x === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY

  if (ix === 0x7ff00000) {
    // x is ±Infinity
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4 + TINY
        case 1:
          return -PI_O_4 - TINY
        case 2:
          return 3 * PI_O_4 + TINY
        default:
          return -3 * PI_O_4 - TINY
      }
    }
    switch (m) {
      case 0:
        return 0
      case 1:
        return -0
      case 2:
        return PI + TINY
      default:
        return -PI - TINY
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY // y is ±Infinity

  const k = (iy - ix) >> 20
  let z: number
  if (k > 60) {
    // |y/x| > 2^60
    z = PI_O_2 + 0.5 * PI_LO
    m &= 1
  } else if (hx < 0 && k < -60) {
    z = 0 // 0 > |y|/x > −2^-60
  } else {
    z = atan(Math.abs(y / x))
  }
  switch (m) {
    case 0:
      return z
    case 1:
      return -z
    case 2:
      return PI - (z - PI_LO)
    default:
      return (z - PI_LO) - PI
  }
}
