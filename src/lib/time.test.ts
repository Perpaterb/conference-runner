import { describe, expect, it } from 'vitest'
import {
  defaultEventWindow,
  endOfDayEpoch,
  lastDayOf,
  startOfDayEpoch,
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

describe('defaultEventWindow (US-010 prefill)', () => {
  it('covers today and tomorrow as whole days, in the event zone', () => {
    const now = zonedTimeToEpoch(2026, 6, 28, 13, 42, SYDNEY)
    const { startAt, endAt } = defaultEventWindow(SYDNEY, now)

    expect(formatDateTime(startAt, SYDNEY)).toBe('28 Jun 2026, 00:00')
    // Exclusive end: midnight at the close of 29 Jun.
    expect(formatDateTime(endAt, SYDNEY)).toBe('30 Jun 2026, 00:00')
    expect(formatDate(lastDayOf(endAt, SYDNEY), SYDNEY)).toBe('29 Jun 2026')
  })

  it('uses the event zone, not the device zone', () => {
    // The same instant is still 27 Jun in London while it is 28 Jun in Sydney.
    const now = zonedTimeToEpoch(2026, 6, 28, 8, 0, SYDNEY)
    expect(formatDate(defaultEventWindow(SYDNEY, now).startAt, SYDNEY)).toBe('28 Jun 2026')
    expect(formatDate(defaultEventWindow(LONDON, now).startAt, LONDON)).toBe('27 Jun 2026')
  })

  it('rolls into the next month correctly', () => {
    const now = zonedTimeToEpoch(2026, 6, 30, 10, 0, SYDNEY)
    expect(formatDate(lastDayOf(defaultEventWindow(SYDNEY, now).endAt, SYDNEY), SYDNEY)).toBe(
      '01 Jul 2026',
    )
  })

  it('rolls across a year boundary', () => {
    const now = zonedTimeToEpoch(2026, 12, 31, 10, 0, SYDNEY)
    expect(formatDate(lastDayOf(defaultEventWindow(SYDNEY, now).endAt, SYDNEY), SYDNEY)).toBe(
      '01 Jan 2027',
    )
  })

  it('still spans two calendar days across a daylight-saving change', () => {
    // Sydney springs forward overnight on 3/4 Oct 2026.
    const now = zonedTimeToEpoch(2026, 10, 3, 10, 0, SYDNEY)
    const { startAt, endAt } = defaultEventWindow(SYDNEY, now)
    expect(formatDate(startAt, SYDNEY)).toBe('03 Oct 2026')
    expect(formatDate(lastDayOf(endAt, SYDNEY), SYDNEY)).toBe('04 Oct 2026')
  })

  it('always ends after it starts', () => {
    for (const zone of [SYDNEY, LONDON, 'UTC', 'America/New_York']) {
      const { startAt, endAt } = defaultEventWindow(zone)
      expect(endAt).toBeGreaterThan(startAt)
    }
  })
})

describe('day boundaries (schedule runs midnight to midnight)', () => {
  it('finds midnight at the start of the day in the event zone', () => {
    const nineAm = zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY)
    expect(formatDateTime(startOfDayEpoch(nineAm, SYDNEY), SYDNEY)).toBe('28 Jun 2026, 00:00')
  })

  it('finds midnight at the end of the day', () => {
    const fivePm = zonedTimeToEpoch(2026, 6, 28, 17, 0, SYDNEY)
    expect(formatDateTime(endOfDayEpoch(fivePm, SYDNEY), SYDNEY)).toBe('29 Jun 2026, 00:00')
  })

  it('uses the event zone, not the device zone', () => {
    // 08:00 in Sydney is still the previous day in London.
    const epoch = zonedTimeToEpoch(2026, 6, 28, 8, 0, SYDNEY)
    expect(formatDate(startOfDayEpoch(epoch, SYDNEY), SYDNEY)).toBe('28 Jun 2026')
    expect(formatDate(startOfDayEpoch(epoch, LONDON), LONDON)).toBe('27 Jun 2026')
  })

  it('is already midnight when given midnight', () => {
    const midnight = zonedTimeToEpoch(2026, 6, 28, 0, 0, SYDNEY)
    expect(startOfDayEpoch(midnight, SYDNEY)).toBe(midnight)
  })

  it('crosses a month boundary', () => {
    const epoch = zonedTimeToEpoch(2026, 6, 30, 17, 0, SYDNEY)
    expect(formatDate(endOfDayEpoch(epoch, SYDNEY), SYDNEY)).toBe('01 Jul 2026')
  })

  it('handles the day daylight saving starts', () => {
    // Sydney springs forward on 4 Oct 2026; that day is 23 hours long.
    const epoch = zonedTimeToEpoch(2026, 10, 4, 12, 0, SYDNEY)
    expect(formatDateTime(startOfDayEpoch(epoch, SYDNEY), SYDNEY)).toBe('04 Oct 2026, 00:00')
    expect(formatDateTime(endOfDayEpoch(epoch, SYDNEY), SYDNEY)).toBe('05 Oct 2026, 00:00')
  })
})
