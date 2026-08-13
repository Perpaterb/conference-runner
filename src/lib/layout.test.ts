import { describe, expect, it } from 'vitest'
import {
  MAX_EMPTY_SEGMENT_PX,
  MIN_BUSY_SEGMENT_PX,
  buildTimeScale,
  effectiveEventRange,
  eventPhase,
  hourTicks,
  layoutSessions,
  mergeIntervals,
  spanHeight,
  yForEpoch,
} from './layout'
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

describe('buildTimeScale: compressed empty time (US-054)', () => {
  const HOUR = 60 * MIN

  it('draws busy stretches at full size and empty ones compressed', () => {
    // 09:00-10:00 busy, then three empty hours.
    const scale = buildTimeScale([session('a', 0, 60)], 0, 4 * 60 * MIN)
    const [busy, empty] = scale.segments

    expect(busy.busy).toBe(true)
    expect(busy.height).toBe(120) // 60 min at 2px
    expect(empty.busy).toBe(false)
    expect(empty.height).toBe(66) // 3 hours at 22px, not 360
    expect(empty.height).toBeLessThan(busy.height)
  })

  it('keeps a long overnight gap from dominating the page', () => {
    const scale = buildTimeScale([session('a', 0, 60)], 0, 24 * 60 * MIN)
    const overnight = scale.segments.find((s) => !s.busy)!
    expect(overnight.height).toBeLessThanOrEqual(MAX_EMPTY_SEGMENT_PX)
  })

  it('keeps a very short session readable', () => {
    const scale = buildTimeScale([session('a', 0, 5)], 0, 5 * MIN)
    expect(scale.segments[0].height).toBe(MIN_BUSY_SEGMENT_PX)
  })

  it('treats overlapping sessions as one busy stretch', () => {
    const scale = buildTimeScale([session('a', 0, 60), session('b', 30, 90)], 0, 90 * MIN)
    expect(scale.segments.filter((s) => s.busy)).toHaveLength(1)
    expect(scale.segments[0].height).toBe(180) // 90 minutes, not 120 + 120
  })

  it('leaves no empty segment when sessions cover the range', () => {
    const scale = buildTimeScale([session('a', 0, 60)], 0, 60 * MIN)
    expect(scale.segments.every((s) => s.busy)).toBe(true)
  })

  it('is one long empty stretch when nothing is scheduled', () => {
    const scale = buildTimeScale([], 0, 8 * HOUR)
    expect(scale.segments).toHaveLength(1)
    expect(scale.segments[0].busy).toBe(false)
  })

  it('widens the range to reach a session outside the event window', () => {
    // Without this, a session before the event start would be clipped off the top and the
    // attendee would simply never see it.
    const scale = buildTimeScale([session('early', -120, -60)], 0, 60 * MIN)
    expect(scale.startAt).toBe(-120 * MIN)
    expect(yForEpoch(scale, -90 * MIN)).toBeGreaterThan(0)
  })

  it('reaches a session that runs past the event end', () => {
    const scale = buildTimeScale([session('late', 60, 240)], 0, 60 * MIN)
    expect(scale.endAt).toBe(240 * MIN)
  })

  it('survives an empty event window', () => {
    const scale = buildTimeScale([], 0, 0)
    expect(scale.segments).toEqual([])
    expect(scale.totalHeight).toBe(0)
  })
})

describe('yForEpoch', () => {
  const scale = buildTimeScale([session('a', 0, 60), session('b', 240, 300)], 0, 300 * MIN)

  it('is monotonic: later never sits above earlier', () => {
    let previous = -1
    for (let m = 0; m <= 300; m += 5) {
      const y = yForEpoch(scale, m * MIN)
      expect(y).toBeGreaterThanOrEqual(previous)
      previous = y
    }
  })

  it('pins the ends of the range', () => {
    expect(yForEpoch(scale, 0)).toBe(0)
    expect(yForEpoch(scale, 300 * MIN)).toBe(scale.totalHeight)
  })

  it('clamps outside the range rather than running off the page', () => {
    expect(yForEpoch(scale, -999 * MIN)).toBe(0)
    expect(yForEpoch(scale, 9999 * MIN)).toBe(scale.totalHeight)
  })

  it('moves further per minute inside a busy stretch than an empty one', () => {
    const busyRate = yForEpoch(scale, 30 * MIN) - yForEpoch(scale, 20 * MIN)
    const emptyRate = yForEpoch(scale, 130 * MIN) - yForEpoch(scale, 120 * MIN)
    expect(busyRate).toBeGreaterThan(emptyRate)
  })

  it('puts the now-line inside the session that is running', () => {
    // The red line must land within the card it overlaps, which is the whole point of routing
    // it through the same scale.
    const y = yForEpoch(scale, 30 * MIN)
    expect(y).toBeGreaterThan(yForEpoch(scale, 0))
    expect(y).toBeLessThan(yForEpoch(scale, 60 * MIN))
  })

  it('gives a different mapping for a different person’s schedule', () => {
    const other = buildTimeScale([session('c', 120, 180)], 0, 300 * MIN)
    expect(yForEpoch(other, 150 * MIN)).not.toBe(yForEpoch(scale, 150 * MIN))
  })
})

describe('spanHeight', () => {
  const scale = buildTimeScale([session('a', 0, 60)], 0, 120 * MIN)

  it('measures a session through the scale', () => {
    expect(spanHeight(scale, 0, 60 * MIN)).toBe(120)
  })

  it('never returns less than the minimum', () => {
    expect(spanHeight(scale, 0, 1 * MIN, 40)).toBe(40)
  })
})

describe('hourTicks: the date and time axis (US-058)', () => {
  it('marks every hour around a session', () => {
    const scale = buildTimeScale([session('a', 0, 180)], 0, 180 * MIN)
    const ticks = hourTicks(scale, [session('a', 0, 180)])
    expect(ticks.map((t) => t.epoch)).toEqual([0, 60 * MIN, 120 * MIN, 180 * MIN])
  })

  it('drops hour marks far from any session', () => {
    // Nothing on until hour 12, so the small hours get no marks at all.
    const sessions = [session('a', 12 * 60, 13 * 60)]
    const scale = buildTimeScale(sessions, 0, 24 * 60 * MIN)
    const ticks = hourTicks(scale, sessions)

    expect(ticks.length).toBeGreaterThan(0)
    for (const tick of ticks) {
      expect(tick.epoch).toBeGreaterThanOrEqual(9 * 60 * MIN)
      expect(tick.epoch).toBeLessThanOrEqual(16 * 60 * MIN)
    }
  })

  it('keeps marks within three hours either side of a session', () => {
    const sessions = [session('a', 12 * 60, 13 * 60)]
    const scale = buildTimeScale(sessions, 0, 24 * 60 * MIN)
    // Thinning may still drop individual marks inside the window, so this checks the window
    // itself: the earliest kept mark is three hours before, and nothing survives outside it.
    const epochs = hourTicks(scale, sessions).map((t) => t.epoch)

    expect(Math.min(...epochs)).toBe(9 * 60 * MIN)
    expect(Math.max(...epochs)).toBeLessThanOrEqual(16 * 60 * MIN)
    expect(epochs).not.toContain(8 * 60 * MIN)
    expect(epochs).not.toContain(17 * 60 * MIN)
  })

  it('produces no marks at all when nothing is scheduled', () => {
    const scale = buildTimeScale([], 0, 24 * 60 * MIN)
    expect(hourTicks(scale, [])).toEqual([])
  })

  it('thins the marks out where the scale is compressed, so labels do not collide', () => {
    // A long quiet stretch flanked by sessions: the marks between them compress.
    const sessions = [session('a', 0, 30), session('b', 20 * 60, 21 * 60)]
    const scale = buildTimeScale(sessions, 0, 22 * 60 * MIN)
    const ticks = hourTicks(scale, sessions, { nearMs: 24 * 3_600_000, minGapPx: 18 })
    expect(ticks.length).toBeLessThan(22)
  })

  it('returns nothing for an empty scale', () => {
    expect(hourTicks(buildTimeScale([], 0, 0), [])).toEqual([])
  })
})

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { startAt: 0, endAt: 10 },
        { startAt: 5, endAt: 20 },
        { startAt: 20, endAt: 30 },
      ]),
    ).toEqual([{ startAt: 0, endAt: 30 }])
  })

  it('keeps separated intervals apart', () => {
    expect(
      mergeIntervals([
        { startAt: 0, endAt: 10 },
        { startAt: 20, endAt: 30 },
      ]),
    ).toEqual([
      { startAt: 0, endAt: 10 },
      { startAt: 20, endAt: 30 },
    ])
  })

  it('drops zero-length intervals', () => {
    expect(mergeIntervals([{ startAt: 5, endAt: 5 }])).toEqual([])
  })
})

describe('effectiveEventRange', () => {
  it('widens to cover sessions outside the recorded window', () => {
    const range = effectiveEventRange([session('a', 0, 60)], 30 * MIN, 40 * MIN)
    expect(range).toEqual({ startAt: 0, endAt: 60 * MIN })
  })

  it('keeps the event window when it is the wider of the two', () => {
    const range = effectiveEventRange([session('a', 30, 40)], 0, 60 * MIN)
    expect(range).toEqual({ startAt: 0, endAt: 60 * MIN })
  })

  it('falls back to the event window with no sessions', () => {
    expect(effectiveEventRange([], 10, 20)).toEqual({ startAt: 10, endAt: 20 })
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
