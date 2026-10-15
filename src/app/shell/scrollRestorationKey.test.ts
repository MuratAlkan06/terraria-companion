import { describe, expect, it } from 'vitest'
import { scrollRestorationKey } from './scrollRestorationKey'

describe('scrollRestorationKey', () => {
  it('keys fresh document loads (shared "default" key) by path, so pages never share a position', () => {
    const home = scrollRestorationKey({ key: 'default', pathname: '/', search: '' })
    const missing = scrollRestorationKey({ key: 'default', pathname: '/nonexistent', search: '' })
    expect(home).toBe('/')
    expect(missing).toBe('/nonexistent')
    expect(home).not.toBe(missing)
  })

  it('includes the query string for fresh loads', () => {
    expect(scrollRestorationKey({ key: 'default', pathname: '/compare', search: '?a=1' })).toBe('/compare?a=1')
  })

  it('keeps the unique history key for in-app navigations', () => {
    expect(scrollRestorationKey({ key: 'k3x9a1', pathname: '/', search: '' })).toBe('k3x9a1')
  })
})
