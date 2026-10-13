/**
 * FNV-1a 32-bit running digest over the event stream — a cheap determinism fingerprint. Numbers are
 * hashed by their exact float64 bit pattern, so any bit-level divergence changes the digest.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export class Digest {
  private h = FNV_OFFSET
  private readonly view = new DataView(new ArrayBuffer(8))

  private byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME) >>> 0
  }

  num(n: number): void {
    this.view.setFloat64(0, n)
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i))
  }

  str(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      this.byte(c)
      this.byte(c >>> 8)
    }
    this.byte(0) // terminator: "ab"+"c" ≠ "a"+"bc"
  }

  value(): string {
    return this.h.toString(16).padStart(8, '0')
  }
}
