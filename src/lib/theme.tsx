/**
 * Light and dark theme.
 *
 * Three states: an explicit 'light' or 'dark' choice, or 'system', which follows the operating
 * system and keeps following it if the user changes that setting while the page is open.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'cr:theme'

function readStored(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefers(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(choice: ThemeChoice, prefers: ResolvedTheme): ResolvedTheme {
  return choice === 'system' ? prefers : choice
}

interface ThemeValue {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice: (choice: ThemeChoice) => void
  /** Flips to the opposite of whatever is on screen now, and pins that choice. */
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue>({
  choice: 'system',
  resolved: 'dark',
  setChoice: () => {},
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored)
  const [prefers, setPrefers] = useState<ResolvedTheme>(systemPrefers)

  // Keep following the OS while the choice is 'system'.
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setPrefers(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(choice, prefers)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    // Tells the browser which scrollbar and form-control palette to use.
    document.documentElement.style.colorScheme = resolved
  }, [resolved])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A blocked localStorage only costs the preference surviving a reload.
    }
  }, [])

  const toggle = useCallback(
    () => setChoice(resolved === 'dark' ? 'light' : 'dark'),
    [resolved, setChoice],
  )

  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}

/** The button itself. `floating` pins it to the corner on screens with no top bar. */
export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const { resolved, toggle } = useTheme()
  const goingTo = resolved === 'dark' ? 'light' : 'dark'

  return (
    <button
      className={`small ghost theme-toggle${floating ? ' floating' : ''}`}
      onClick={toggle}
      title={`Switch to ${goingTo} theme`}
      aria-label={`Switch to ${goingTo} theme`}
    >
      <span aria-hidden="true">{resolved === 'dark' ? '☀' : '☾'}</span>
      <span className="theme-toggle-text">{goingTo === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  )
}
