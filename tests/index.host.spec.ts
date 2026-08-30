// @vitest-environment node
/**
 * Host half: the composer-effect bootstrap tapIndex transform. The injected
 * script must resolve each toggle from the merged section, fall back to the
 * legacy per-key format, then to the defaults — all without touching the
 * shell before mount.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

function captureTap(webServer: { tapIndex: (t: (html: string) => string) => void }): (html: string) => string {
  let tap: ((html: string) => string) | undefined
  webServer.tapIndex = (t: (html: string) => string): void => { tap = t }
  const httpCtx = { webServer, effect: (fn: () => void) => { fn() } }
  apply({ inject: (_names: string[], cb: (h: typeof httpCtx) => void) => { cb(httpCtx) } } as never)
  if (tap === undefined) throw new Error('tapIndex not registered')
  return tap
}

describe('host composer bootstrap', () => {
  it('registers a tapIndex transform through webServer', () => {
    const tap = captureTap({ tapIndex: () => {} })
    expect(typeof tap).toBe('function')
  })

  it('injects a script right after <body> with the three toggle attributes', () => {
    const tap = captureTap({ tapIndex: () => {} })
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const out = tap(html)
    expect(out).toContain('<script>')
    expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('<body>'))
    expect(out).toContain('data-dsh-aistudio-composer')
    expect(out).toContain('data-dsh-glass-composer')
    expect(out).toContain('data-dsh-glow-composer')
  })

  it('falls back to appending the script when no <body> tag matches', () => {
    const tap = captureTap({ tapIndex: () => {} })
    const out = tap('<html><head></head></html>')
    expect(out).toContain('<script>')
  })

  it('the emitted script reads the merged section field when present', () => {
    const tap = captureTap({ tapIndex: () => {} })
    const out = tap('<html><body></body></html>')
    expect(out).toContain('dsh-ui-appearance.settings')
    expect(out).toContain('aistudioComposer')
    expect(out).toContain('dsh.aistudioComposer')
  })
})
