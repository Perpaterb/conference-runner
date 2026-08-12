/**
 * US-002: with no Firebase configuration the app must explain itself rather than render a blank
 * page. The test environment has no VITE_FIREBASE_* variables, so this is the real code path a
 * fresh deployment hits.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { isFirebaseConfigured } from './lib/firebase'

describe('US-002: unconfigured deployment', () => {
  it('reports that Firebase is not configured', () => {
    expect(isFirebaseConfigured()).toBe(false)
  })

  it('shows the setup screen instead of a blank page', () => {
    render(<App />)
    expect(screen.getByText(/needs its Firebase settings/i)).toBeInTheDocument()
  })

  it('names every environment variable the deployment needs', () => {
    render(<App />)
    const body = document.body.textContent ?? ''
    for (const key of [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_STORAGE_BUCKET',
      'VITE_FIREBASE_MESSAGING_SENDER_ID',
      'VITE_FIREBASE_APP_ID',
    ]) {
      expect(body).toContain(key)
    }
  })

  it('tells the operator to authorise this domain, the quiet failure otherwise', () => {
    render(<App />)
    expect(screen.getByText(/Authorized domains/i)).toBeInTheDocument()
  })
})
