import { describe, expect, it } from 'vitest'
import { LIVE_TIMEOUT_MS, deriveLiveStatus } from './live'

const base = { online: true, lastUpdatedAt: null as number | null, error: null as Error | null, now: 1_000_000 }

describe('US-057: connection status', () => {
  it('is connecting before the first snapshot', () => {
    expect(deriveLiveStatus(base)).toBe('connecting')
  })

  it('is live just after a snapshot', () => {
    expect(deriveLiveStatus({ ...base, lastUpdatedAt: base.now - 1000 })).toBe('live')
  })

  it('falls back to polling once the socket has gone quiet', () => {
    expect(
      deriveLiveStatus({ ...base, lastUpdatedAt: base.now - LIVE_TIMEOUT_MS - 1 }),
    ).toBe('polling')
  })

  it('reports offline when the browser has no network', () => {
    expect(deriveLiveStatus({ ...base, online: false })).toBe('offline')
  })
})

describe('regression: a rejected read must not hang on "connecting"', () => {
  // A signed-out visitor used to sit on a spinner forever, because a permission-denied read
  // never yields a snapshot and the status never left "connecting".
  it('reports error when a read fails before any snapshot arrives', () => {
    const error = new Error('Missing or insufficient permissions.')
    expect(deriveLiveStatus({ ...base, error })).toBe('error')
  })

  it('reports error even while the browser is offline, so the caller stops waiting', () => {
    const error = new Error('Missing or insufficient permissions.')
    expect(deriveLiveStatus({ ...base, error, online: false })).toBe('error')
  })

  it('keeps showing data already received when a later refresh fails', () => {
    const error = new Error('transient')
    expect(deriveLiveStatus({ ...base, error, lastUpdatedAt: base.now - 1000 })).toBe('live')
  })
})
