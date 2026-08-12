import { describe, expect, it } from 'vitest'
import { eventPhase, findGaps, heightForRange, layoutSessions, offsetForEpoch } from './layout'
import type { SessionDoc } from './types'

const MIN = 60_000

function session(id: string, startMin: number, endMin: number): SessionDoc {
  return {
    id,
    title: id,
    description: '',
    location: '',
    startAt: startMin * MIN,
    endAt: endMin * MIN,
    groupIds: [],
    allGroups: true,
  }
}

describe('layoutSessions (US-052)', () => {
  it('gives sequential sessions a single full-width column', () => {
    const placed = layoutSessions([session('a', 0, 60), session('b', 60, 120)])
    expect(placed.every((p) => p.columns === 1 && p.column === 0)).toBe(true)
  })

  it('places two concurrent sessions side by side', () => {
    const placed = layoutSessions([session('a', 0, 60), session('b', 30, 90)])
    expect(placed.map((p) => p.column)).toEqual([0, 1])
    expect(placed.every((p) => p.columns === 2)).toBe(true)
  })

  it('gives every session in an overlap cluster the same column count, so widths line up', () => {
    const placed = layoutSessions([session('a', 0, 60), session('b', 0, 60), session('c', 0, 60)])
    expect(new Set(placed.map((p) => p.columns))).toEqual(new Set([3]))
    expect(new Set(placed.map((p) => p.column))).toEqual(new Set([0, 1, 2]))
  })

  it('reuses a column once its previous session has finished', () => {
    // a and b overlap; c starts after a ends, so it can take a's column.
    const placed = layoutSessions([session('a', 0, 30), session('b', 0, 90), session('c', 30, 60)])
    const byId = Object.fromEntries(placed.map((p) => [p.session.id, p]))
    expect(byId.c.column).toBe(byId.a.column)
    expect(byId.b.column).not.toBe(byId.a.column)
  })

  it('starts a fresh cluster after a clean break, so a later pair is not squeezed', () => {
    const placed = layoutSessions([
      session('a', 0, 60),
      session('b', 0, 60),
      session('later', 120, 180),
    ])
    const later = placed.find((p) => p.session.id === 'later')!
    expect(later.columns).toBe(1)
  })

  it('treats back-to-back sessions as not overlapping', () => {
    const placed = layoutSessions([session('a', 0, 60), session('b', 60, 120)])
    expect(placed.every((p) => p.columns === 1)).toBe(true)
  })

  it('handles an empty schedule', () => {
    expect(layoutSessions([])).toEqual([])
  })
})

describe('findGaps (US-054)', () => {
  it('finds the stretch before, between and after sessions', () => {
    const gaps = findGaps([session('a', 60, 120)], 0, 180 * MIN)
    expect(gaps).toEqual([
      { startAt: 0, endAt: 60 * MIN },
      { startAt: 120 * MIN, endAt: 180 * MIN },
    ])
  })

  it('reports the whole event as a gap when nothing is scheduled', () => {
    expect(findGaps([], 0, 60 * MIN)).toEqual([{ startAt: 0, endAt: 60 * MIN }])
  })

  it('reports no gaps when sessions cover the event', () => {
    expect(findGaps([session('a', 0, 60)], 0, 60 * MIN)).toEqual([])
  })

  it('does not report a gap inside overlapping sessions', () => {
    const gaps = findGaps([session('a', 0, 60), session('b', 30, 120)], 0, 120 * MIN)
    expect(gaps).toEqual([])
  })

  it('ignores sessions that fall outside the event window', () => {
    const gaps = findGaps([session('early', -120, -60)], 0, 60 * MIN)
    expect(gaps).toEqual([{ startAt: 0, endAt: 60 * MIN }])
  })
})

describe('positioning', () => {
  it('maps time to a vertical offset', () => {
    expect(offsetForEpoch(30 * MIN, 0, 2)).toBe(60)
  })

  it('keeps very short sessions tall enough to read', () => {
    expect(heightForRange(0, 5 * MIN, 2, 44)).toBe(44)
    expect(heightForRange(0, 60 * MIN, 2, 44)).toBe(120)
  })
})

describe('eventPhase (US-053)', () => {
  it('reports before, during and after', () => {
    expect(eventPhase(50, 100, 200)).toBe('before')
    expect(eventPhase(100, 100, 200)).toBe('during')
    expect(eventPhase(150, 100, 200)).toBe('during')
    expect(eventPhase(200, 100, 200)).toBe('during')
    expect(eventPhase(201, 100, 200)).toBe('after')
  })
})
