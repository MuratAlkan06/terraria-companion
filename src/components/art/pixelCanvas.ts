/**
 * Tiny builder for original pixel art (AMENDMENTS-001 A12). Draw with palette
 * characters, optionally auto-outline, then hand `rows()` to <PixelArt>.
 * '.' is transparent.
 */
export class PixelCanvas {
  readonly width: number
  readonly height: number
  private readonly grid: string[][]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.grid = Array.from({ length: height }, () => Array<string>(width).fill('.'))
  }

  get(x: number, y: number): string {
    return this.grid[y]?.[x] ?? '.'
  }

  set(x: number, y: number, c: string): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.grid[y][x] = c
    return this
  }

  /** Bresenham line, inclusive of both ends. */
  line(x0: number, y0: number, x1: number, y1: number, c: string): this {
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    let x = x0
    let y = y0
    for (;;) {
      this.set(x, y, c)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
    return this
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
    return this
  }

  /** Stamp a pre-drawn sprite; '.' cells in the stamp are skipped. */
  stamp(x: number, y: number, rows: readonly string[]): this {
    rows.forEach((row, j) => [...row].forEach((c, i) => c !== '.' && this.set(x + i, y + j, c)))
    return this
  }

  /** Surround every filled region with a 1px outline (4-neighbourhood). */
  outline(c = 'k'): this {
    const snapshot = this.grid.map((row) => [...row])
    const filled = (x: number, y: number) => (snapshot[y]?.[x] ?? '.') !== '.'
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (snapshot[y][x] !== '.') continue
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) this.grid[y][x] = c
      }
    }
    return this
  }

  rows(): string[] {
    return this.grid.map((row) => row.join(''))
  }
}
