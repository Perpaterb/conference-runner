import { describe, expect, it } from 'vitest'
import {
  epochToZonedParts,
  formatCsvDateTime,
  formatDate,
  formatDateTime,
  formatTime,
  fromDateTimeLocalValue,
  humaniseMinutes,
  minutesUntil,
  parseCsvDateTime,
  toDateTimeLocalValue,
  zonedTimeToEpoch,
} from './time'

const SYDNEY = 'Australia/Sydney'
const LONDON = 'Europe/London'

describe('zonedTimeToEpoch', () => {
  it('reads wall-clock time in the given zone, not the device zone (US-050)', () => {
    // 09:00 on 28 Jun 2026 in Sydney is UTC+10 (winter there, no DST).
    const epoch = zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY)
    expect(new Date(epoch).toISOString()).toBe('2026-06-27T23:00:00.000Z')
  })

  it('handles a zone on daylight saving', () => {
    // 28 Jun 2026 in London is BST, UTC+1.
    const epoch = zonedTimeToEpoch(2026, 6, 28, 9, 0, LONDON)
    expect(new Date(epoch).toISOString()).toBe('2026-06-28T08:00:00.000Z')
  })

  it('round-trips through epochToZonedParts', () => {
    const epoch = zonedTimeToEpoch(2026, 10, 4, 14, 35, SYDNEY)
    expect(epochToZonedParts(epoch, SYDNEY)).toEqual({
      year: 2026,
      month: 10,
      day: 4,
      hour: 14,
      minute: 35,
    })
  })

  it('survives the southern-hemisphere DST start', () => {
    // Sydney springs forward at 02:00 on 4 Oct 2026. 03:00 exists; check it round-trips.
    const epoch = zonedTimeToEpoch(2026, 10, 4, 3, 0, SYDNEY)
    const parts = epochToZonedParts(epoch, SYDNEY)
    expect(parts.hour).toBe(3)
    expect(parts.day).toBe(4)
  })
})

describe('formatting', () => {
  const epoch = Date.UTC(2026, 5, 27, 23, 0) // 09:00 on 28 Jun 2026 in Sydney

  it('formats dates as DD MMM YYYY', () => {
    expect(formatDate(epoch, SYDNEY)).toBe('28 Jun 2026')
  })

  it('never uses US MM/DD/YYYY ordering', () => {
    expect(formatDate(epoch, SYDNEY)).not.toMatch(/^\d{1,2}\/\d{1,2}\//)
  })

  it('formats times in the event zone', () => {
    expect(formatTime(epoch, SYDNEY)).toBe('09:00')
    expect(formatTime(epoch, LONDON)).toBe('00:00')
  })

  it('shows the same instant differently per zone, which is the point of US-050', () => {
    expect(formatDateTime(epoch, SYDNEY)).toBe('28 Jun 2026, 09:00')
    expect(formatDateTime(epoch, LONDON)).toBe('28 Jun 2026, 00:00')
  })
})

describe('datetime-local inputs', () => {
  it('shows the event zone wall clock rather than the browser zone', () => {
    const epoch = Date.UTC(2026, 5, 27, 23, 0)
    expect(toDateTimeLocalValue(epoch, SYDNEY)).toBe('2026-06-28T09:00')
  })

  it('reads the input back as event zone time', () => {
    expect(fromDateTimeLocalValue('2026-06-28T09:00', SYDNEY)).toBe(Date.UTC(2026, 5, 27, 23, 0))
  })

  it('returns null for unparseable input', () => {
    expect(fromDateTimeLocalValue('', SYDNEY)).toBeNull()
    expect(fromDateTimeLocalValue('not a date', SYDNEY)).toBeNull()
  })
})

describe('parseCsvDateTime', () => {
  it('reads the DD MMM YYYY HH:mm interchange format', () => {
    expect(parseCsvDateTime('28 Jun 2026 09:00', SYDNEY)).toBe(Date.UTC(2026, 5, 27, 23, 0))
  })

  it('tolerates a comma and extra whitespace', () => {
    expect(parseCsvDateTime('  28 Jun 2026,  09:00 ', SYDNEY)).toBe(Date.UTC(2026, 5, 27, 23, 0))
  })

  it('accepts ISO style input too', () => {
    expect(parseCsvDateTime('2026-06-28 09:00', SYDNEY)).toBe(Date.UTC(2026, 5, 27, 23, 0))
  })

  it('rejects impossible dates instead of rolling them forward', () => {
    expect(parseCsvDateTime('31 Feb 2026 09:00', SYDNEY)).toBeNull()
  })

  it('rejects nonsense rather than guessing', () => {
    expect(parseCsvDateTime('sometime tuesday', SYDNEY)).toBeNull()
    expect(parseCsvDateTime('', SYDNEY)).toBeNull()
    expect(parseCsvDateTime('28 Xyz 2026 09:00', SYDNEY)).toBeNull()
  })

  it('round-trips with formatCsvDateTime', () => {
    const epoch = zonedTimeToEpoch(2026, 6, 28, 14, 5, SYDNEY)
    expect(parseCsvDateTime(formatCsvDateTime(epoch, SYDNEY), SYDNEY)).toBe(epoch)
  })
})

describe('countdown helpers', () => {
  it('rounds up so "starts in 1 min" never reads as 0', () => {
    expect(minutesUntil(1000 * 30, 0)).toBe(1)
  })

  it('humanises durations', () => {
    expect(humaniseMinutes(45)).toBe('45 min')
    expect(humaniseMinutes(125)).toBe('2 hr, 5 min')
    expect(humaniseMinutes(1500)).toBe('1 day, 1 hr')
    expect(humaniseMinutes(0)).toBe('0 min')
  })
})
