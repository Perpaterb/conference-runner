import { describe, expect, it } from 'vitest'
import { deriveLiveStatus } from './live'

const base = {
  online: true,
  lastUpdatedAt: null as number | null,
  error: null as Error | null,
  fromCache: false,
}

describe('US-057: connection status', () => {
  it('is connecting before the first snapshot', () => {
    expect(deriveLiveStatus(base)).toBe('connecting')
  })

  it('is live once a snapshot has arrived from the backend', () => {
    expect(deriveLiveStatus({ ...base, lastUpdatedAt: 1000 })).toBe('live')
  })

  it('stays live however long the listener is quiet', () => {
    // Regression: an earlier version flipped to "polling" after 45 seconds of silence, which
    // fired a few minutes after every page load. Firestore sends nothing while nothing changes,
    // so silence is not a fault and must not be reported as one.
    expect(deriveLiveStatus({ ...base, lastUpdatedAt: 1 })).toBe('live')
  })

  it('reports polling when Firestore is answering from its cache', () => {
    expect(deriveLiveStatus({ ...base, lastUpdatedAt: 1000, fromCache: true })).toBe('polling')
  })

  it('reports offline when the browser has no network', () => {
    expect(deriveLiveStatus({ ...base, online: false })).toBe('offline')
  })

  it('prefers offline over polling, since it is the more useful thing to say', () => {
    expect(
      deriveLiveStatus({ ...base, online: false, lastUpdatedAt: 1000, fromCache: true }),
    ).toBe('offline')
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
    expect(deriveLiveStatus({ ...base, error, lastUpdatedAt: 1000 })).toBe('live')
  })
})
