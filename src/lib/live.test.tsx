/**
 * The clock behind every countdown (US-053, US-059).
 *
 * A countdown that silently stops ticking looks identical to one that is simply slow, so this
 * asserts the hook actually re-renders its consumer as time passes.
 */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './live'
import { humaniseMinutes, minutesUntil } from './time'

const START = Date.UTC(2026, 5, 28, 9, 0)

function Countdown({ interval }: { interval?: number }) {
  const now = useNow(interval)
  return <span>Starts in {humaniseMinutes(minutesUntil(START, now))}</span>
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('re-renders as time passes, so a countdown keeps ticking', () => {
    vi.setSystemTime(START - 30 * 60_000)
    render(<Countdown />)
    expect(screen.getByText('Starts in 30 min')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Starts in 29 min')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(screen.getByText('Starts in 24 min')).toBeInTheDocument()
  })

  it('ticks at least once within its interval', () => {
    vi.setSystemTime(START - 60 * 60_000)
    render(<Countdown interval={10_000} />)
    expect(screen.getByText('Starts in 1 hr')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByText('Starts in 50 min')).toBeInTheDocument()
  })

  it('counts down across a day boundary', () => {
    vi.setSystemTime(START - 25 * 60 * 60_000)
    render(<Countdown />)
    expect(screen.getByText('Starts in 1 day, 1 hr')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60 * 60_000)
    })
    expect(screen.getByText('Starts in 1 day')).toBeInTheDocument()
  })

  it('keeps ticking after the target passes', () => {
    vi.setSystemTime(START - 60_000)
    render(<Countdown />)
    expect(screen.getByText('Starts in 1 min')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(screen.getByText('Starts in 0 min')).toBeInTheDocument()
  })
})
