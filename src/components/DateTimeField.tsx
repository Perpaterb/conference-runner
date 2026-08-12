/**
 * Date and time entry, always Day / Month-name / Year, whatever the browser's locale is.
 *
 * `<input type="datetime-local">` renders in the OS locale, which shows MM/DD/YYYY on a US
 * machine. The format has to be ours, not the browser's, so the control is built from separate
 * fields ordered day, month, year.
 *
 * The value is an epoch, and every conversion happens in the event's time zone, so what the user
 * types is the event's wall clock rather than their device's.
 */

import { useEffect, useMemo, useState } from 'react'
import { MONTHS, epochToZonedParts, formatDateTime, zonedTimeToEpoch } from '../lib/time'

export interface DateParts {
  day: string
  month: string
  year: string
  hour: string
  minute: string
}

export const EMPTY_PARTS: DateParts = { day: '', month: '', year: '', hour: '', minute: '' }

export function partsFromEpoch(epoch: number, timeZone: string): DateParts {
  const p = epochToZonedParts(epoch, timeZone)
  return {
    day: String(p.day),
    month: String(p.month),
    year: String(p.year),
    hour: String(p.hour).padStart(2, '0'),
    minute: String(p.minute).padStart(2, '0'),
  }
}

/** True when nothing has been entered, which means "no value" rather than "invalid". */
export function partsAreEmpty(parts: DateParts): boolean {
  return !parts.day && !parts.month && !parts.year && !parts.hour && !parts.minute
}

/**
 * Converts entered parts to an epoch, or null when they are incomplete or impossible.
 *
 * Impossible dates such as 31 Feb are rejected rather than silently rolled into March, which is
 * what `Date.UTC` would do on its own.
 */
export function epochFromParts(parts: DateParts, timeZone: string): number | null {
  const day = Number(parts.day)
  const month = Number(parts.month)
  const year = Number(parts.year)
  const hour = parts.hour === '' ? 0 : Number(parts.hour)
  const minute = parts.minute === '' ? 0 : Number(parts.minute)

  if (!parts.day || !parts.month || !parts.year) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null

  const epoch = zonedTimeToEpoch(year, month, day, hour, minute, timeZone)
  const back = epochToZonedParts(epoch, timeZone)
  if (back.day !== day || back.month !== month || back.year !== year) return null
  return epoch
}

export default function DateTimeField({
  label,
  value,
  timeZone,
  onChange,
  showTime = true,
  id,
}: {
  label: string
  value: number | null
  timeZone: string
  onChange: (epoch: number | null) => void
  showTime?: boolean
  id: string
}) {
  const [parts, setParts] = useState<DateParts>(() =>
    value === null ? EMPTY_PARTS : partsFromEpoch(value, timeZone),
  )

  // Re-sync when the value is changed from outside (a different session opened for editing).
  useEffect(() => {
    setParts((current) => {
      const currentEpoch = epochFromParts(current, timeZone)
      if (value === null) return partsAreEmpty(current) ? current : EMPTY_PARTS
      if (currentEpoch === value) return current
      return partsFromEpoch(value, timeZone)
    })
  }, [value, timeZone])

  const update = (patch: Partial<DateParts>) => {
    const next = { ...parts, ...patch }
    setParts(next)
    onChange(partsAreEmpty(next) ? null : epochFromParts(next, timeZone))
  }

  const epoch = useMemo(() => epochFromParts(parts, timeZone), [parts, timeZone])
  const incomplete = !partsAreEmpty(parts) && epoch === null

  return (
    <div className="field">
      <label htmlFor={`${id}-day`}>{label}</label>
      <div className="datetime-field">
        <input
          id={`${id}-day`}
          className="dt-day"
          type="number"
          min={1}
          max={31}
          inputMode="numeric"
          placeholder="DD"
          aria-label="Day"
          value={parts.day}
          onChange={(e) => update({ day: e.target.value })}
        />
        <select
          className="dt-month"
          aria-label="Month"
          value={parts.month}
          onChange={(e) => update({ month: e.target.value })}
        >
          <option value="">MMM</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="dt-year"
          type="number"
          min={1970}
          max={9999}
          inputMode="numeric"
          placeholder="YYYY"
          aria-label="Year"
          value={parts.year}
          onChange={(e) => update({ year: e.target.value })}
        />

        {showTime && (
          <>
            <span className="dt-sep">at</span>
            <input
              className="dt-time"
              type="number"
              min={0}
              max={23}
              inputMode="numeric"
              placeholder="HH"
              aria-label="Hour"
              value={parts.hour}
              onChange={(e) => update({ hour: e.target.value })}
            />
            <span className="dt-sep">:</span>
            <input
              className="dt-time"
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              placeholder="mm"
              aria-label="Minute"
              value={parts.minute}
              onChange={(e) => update({ minute: e.target.value })}
            />
          </>
        )}
      </div>

      {incomplete ? (
        <p className="error small" style={{ margin: '0.25rem 0 0' }}>
          Not a real date. Check the day of the month.
        </p>
      ) : epoch !== null ? (
        <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
          {formatDateTime(epoch, timeZone)} ({timeZone})
        </p>
      ) : null}
    </div>
  )
}
