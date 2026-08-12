/**
 * Time zone helpers.
 *
 * Everything is stored as epoch milliseconds. Positioning maths uses epoch values, so it is
 * time zone independent. Display always uses the event's time zone, never the device's, which
 * is the whole point of US-050.
 */

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** Offset of `timeZone` from UTC at `date`, in milliseconds. Positive east of Greenwich. */
export function timeZoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  // Some engines render midnight as hour 24 when hour12 is false.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  )
  // Drop sub-second precision so the comparison is apples to apples.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Wall-clock time in `timeZone` to an epoch. Month is 1-based. */
export function zonedTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const firstOffset = timeZoneOffsetMs(timeZone, new Date(guess))
  const first = guess - firstOffset
  // A second pass settles daylight-saving boundaries, where the first guess can land in the
  // wrong offset.
  const secondOffset = timeZoneOffsetMs(timeZone, new Date(first))
  return secondOffset === firstOffset ? first : guess - secondOffset
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** Epoch to wall-clock parts in `timeZone`. Month is 1-based. */
export function epochToZonedParts(epoch: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(epoch))) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "28 Jun 2026" */
export function formatDate(epoch: number, timeZone: string): string {
  const p = epochToZonedParts(epoch, timeZone)
  return `${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}`
}

/** "14:30" */
export function formatTime(epoch: number, timeZone: string): string {
  const p = epochToZonedParts(epoch, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** "28 Jun 2026, 14:30" */
export function formatDateTime(epoch: number, timeZone: string): string {
  return `${formatDate(epoch, timeZone)}, ${formatTime(epoch, timeZone)}`
}

/** Short time zone name for display, e.g. "AEST". Falls back to the IANA id. */
export function timeZoneLabel(timeZone: string, at: number = Date.UTC(2026, 0, 1)): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    const part = dtf.formatToParts(new Date(at)).find((p) => p.type === 'timeZoneName')
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}

/**
 * Value for an `<input type="datetime-local">` showing the event's wall clock.
 * The browser would otherwise render the device's zone, which is exactly the bug US-050 forbids.
 */
export function toDateTimeLocalValue(epoch: number, timeZone: string): string {
  const p = epochToZonedParts(epoch, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** Inverse of {@link toDateTimeLocalValue}: reads the input as event-zone wall clock. */
export function fromDateTimeLocalValue(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  return zonedTimeToEpoch(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    timeZone,
  )
}

/** CSV interchange format: "28 Jun 2026 14:30" in the event's zone. */
export function formatCsvDateTime(epoch: number, timeZone: string): string {
  return `${formatDate(epoch, timeZone)} ${formatTime(epoch, timeZone)}`
}

/**
 * Parses the CSV interchange format back to an epoch, tolerantly:
 * "28 Jun 2026 14:30", "28 Jun 2026, 14:30", "2026-06-28 14:30", "2026-06-28T14:30".
 * Returns null when unparseable, so importers can report the row rather than guess.
 */
export function parseCsvDateTime(input: string, timeZone: string): number | null {
  const text = input.trim().replace(',', ' ').replace(/\s+/g, ' ')
  if (!text) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text)
  if (iso) {
    return zonedTimeToEpoch(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4]),
      Number(iso[5]),
      timeZone,
    )
  }

  const dmy = /^(\d{1,2}) ([A-Za-z]{3,}) (\d{4}) (\d{1,2}):(\d{2})$/.exec(text)
  if (dmy) {
    const monthIndex = MONTHS.findIndex(
      (m) => m.toLowerCase() === dmy[2].slice(0, 3).toLowerCase(),
    )
    if (monthIndex < 0) return null
    const epoch = zonedTimeToEpoch(
      Number(dmy[3]),
      monthIndex + 1,
      Number(dmy[1]),
      Number(dmy[4]),
      Number(dmy[5]),
      timeZone,
    )
    // Reject impossible days such as 31 Feb, which Date.UTC silently rolls forward.
    const back = epochToZonedParts(epoch, timeZone)
    if (back.day !== Number(dmy[1]) || back.month !== monthIndex + 1) return null
    return epoch
  }

  return null
}

/** Whole minutes from `from` to `to`, rounded up so "starts in 1 min" never shows as 0. */
export function minutesUntil(to: number, from: number): number {
  return Math.ceil((to - from) / 60000)
}

/** "2 days, 3 hr 5 min", "45 min". Used by the pre-event countdown. */
export function humaniseMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0 min'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours} hr`)
  if (minutes || parts.length === 0) parts.push(`${minutes} min`)
  return parts.join(', ')
}

/** The IANA zones offered in the event form. Falls back to a curated list if unsupported. */
export function supportedTimeZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  if (typeof anyIntl.supportedValuesOf === 'function') {
    try {
      return anyIntl.supportedValuesOf('timeZone')
    } catch {
      /* fall through */
    }
  }
  return [
    'UTC',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Perth',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Pacific/Auckland',
  ]
}

/** The device's zone, used only as the default selection when creating an event. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
