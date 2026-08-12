/**
 * US-010, US-012: dates must read DD MMM YYYY whatever the browser's locale is.
 *
 * A native `datetime-local` renders MM/DD/YYYY on a US-locale machine, which is the bug these
 * tests exist to prevent coming back.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DateTimeField, {
  EMPTY_PARTS,
  epochFromParts,
  partsAreEmpty,
  partsFromEpoch,
} from './DateTimeField'
import { zonedTimeToEpoch } from '../lib/time'

const SYDNEY = 'Australia/Sydney'

describe('epochFromParts', () => {
  const parts = (over: Partial<typeof EMPTY_PARTS> = {}) => ({ ...EMPTY_PARTS, ...over })

  it('reads the entered wall clock in the event time zone', () => {
    const epoch = epochFromParts(
      parts({ day: '28', month: '6', year: '2026', hour: '09', minute: '00' }),
      SYDNEY,
    )
    expect(epoch).toBe(zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY))
  })

  it('defaults a blank time to midnight rather than refusing the date', () => {
    expect(epochFromParts(parts({ day: '1', month: '1', year: '2026' }), SYDNEY)).toBe(
      zonedTimeToEpoch(2026, 1, 1, 0, 0, SYDNEY),
    )
  })

  it('returns null while the date is still incomplete', () => {
    expect(epochFromParts(parts({ day: '28', month: '6' }), SYDNEY)).toBeNull()
    expect(epochFromParts(parts({ day: '28', year: '2026' }), SYDNEY)).toBeNull()
    expect(epochFromParts(EMPTY_PARTS, SYDNEY)).toBeNull()
  })

  it('rejects impossible dates instead of rolling them into the next month', () => {
    expect(epochFromParts(parts({ day: '31', month: '2', year: '2026' }), SYDNEY)).toBeNull()
    expect(epochFromParts(parts({ day: '31', month: '4', year: '2026' }), SYDNEY)).toBeNull()
  })

  it('accepts 29 Feb in a leap year and rejects it otherwise', () => {
    expect(epochFromParts(parts({ day: '29', month: '2', year: '2028' }), SYDNEY)).not.toBeNull()
    expect(epochFromParts(parts({ day: '29', month: '2', year: '2026' }), SYDNEY)).toBeNull()
  })

  it('rejects out-of-range values', () => {
    expect(epochFromParts(parts({ day: '0', month: '6', year: '2026' }), SYDNEY)).toBeNull()
    expect(epochFromParts(parts({ day: '32', month: '6', year: '2026' }), SYDNEY)).toBeNull()
    expect(
      epochFromParts(parts({ day: '1', month: '6', year: '2026', hour: '24' }), SYDNEY),
    ).toBeNull()
    expect(
      epochFromParts(parts({ day: '1', month: '6', year: '2026', minute: '60' }), SYDNEY),
    ).toBeNull()
  })

  it('round-trips with partsFromEpoch', () => {
    const epoch = zonedTimeToEpoch(2026, 11, 3, 16, 45, SYDNEY)
    expect(epochFromParts(partsFromEpoch(epoch, SYDNEY), SYDNEY)).toBe(epoch)
  })

  it('knows the difference between empty and invalid', () => {
    expect(partsAreEmpty(EMPTY_PARTS)).toBe(true)
    expect(partsAreEmpty(parts({ day: '31' }))).toBe(false)
  })
})

describe('the rendered control', () => {
  it('orders the fields day, month, year', () => {
    render(
      <DateTimeField id="t" label="Starts" value={null} timeZone={SYDNEY} onChange={() => {}} />,
    )
    const fields = screen.getAllByLabelText(/Day|Month|Year/)
    expect(fields.map((f) => f.getAttribute('aria-label'))).toEqual(['Day', 'Month', 'Year'])
  })

  it('shows the month by name, never as a number', () => {
    render(
      <DateTimeField id="t" label="Starts" value={null} timeZone={SYDNEY} onChange={() => {}} />,
    )
    expect(screen.getByRole('option', { name: 'Jun' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '06' })).not.toBeInTheDocument()
  })

  it('echoes the chosen value back as DD MMM YYYY', () => {
    const epoch = zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY)
    render(
      <DateTimeField id="t" label="Starts" value={epoch} timeZone={SYDNEY} onChange={() => {}} />,
    )
    expect(screen.getByText(/28 Jun 2026, 09:00/)).toBeInTheDocument()
  })

  it('never renders the value in US MM/DD/YYYY order', () => {
    const epoch = zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY)
    render(
      <DateTimeField id="t" label="Starts" value={epoch} timeZone={SYDNEY} onChange={() => {}} />,
    )
    expect(document.body.textContent).not.toMatch(/06\/28\/2026/)
    expect(document.body.textContent).not.toMatch(/6\/28\/2026/)
  })

  it('reports an epoch once the user has entered a full date', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DateTimeField id="t" label="Starts" value={null} timeZone={SYDNEY} onChange={onChange} />,
    )

    await user.type(screen.getByLabelText('Day'), '28')
    await user.selectOptions(screen.getByLabelText('Month'), '6')
    await user.type(screen.getByLabelText('Year'), '2026')
    await user.type(screen.getByLabelText('Hour'), '9')
    await user.type(screen.getByLabelText('Minute'), '30')

    expect(onChange).toHaveBeenLastCalledWith(zonedTimeToEpoch(2026, 6, 28, 9, 30, SYDNEY))
  })

  it('flags an impossible date rather than accepting it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DateTimeField id="t" label="Starts" value={null} timeZone={SYDNEY} onChange={onChange} />,
    )

    await user.type(screen.getByLabelText('Day'), '31')
    await user.selectOptions(screen.getByLabelText('Month'), '2')
    await user.type(screen.getByLabelText('Year'), '2026')

    expect(screen.getByText(/Not a real date/)).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('reports null when the user clears the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const epoch = zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY)
    render(
      <DateTimeField id="t" label="Starts" value={epoch} timeZone={SYDNEY} onChange={onChange} />,
    )

    await user.clear(screen.getByLabelText('Day'))
    await user.clear(screen.getByLabelText('Year'))
    await user.clear(screen.getByLabelText('Hour'))
    await user.clear(screen.getByLabelText('Minute'))
    await user.selectOptions(screen.getByLabelText('Month'), '')

    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
