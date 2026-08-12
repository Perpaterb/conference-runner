/** Google sign-in state, shared across the app (US-010, US-020). */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth, isFirebaseConfigured } from './firebase'

interface AuthValue {
  user: User | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  signOutNow: () => Promise<void>
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  error: null,
  signIn: async () => {},
  signOutNow: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(
      auth(),
      (u) => {
        setUser(u)
        setLoading(false)
      },
      (e) => {
        setError(e.message)
        setLoading(false)
      },
    )
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      error,
      signIn: async () => {
        setError(null)
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        try {
          await signInWithPopup(auth(), provider)
        } catch (e) {
          const code = (e as { code?: string }).code ?? ''
          // Popups are blocked in some in-app browsers and on iOS; fall back to redirect
          // rather than leaving the user staring at a dead button.
          if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
            await signInWithRedirect(auth(), provider)
            return
          }
          if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
            return
          }
          if (code === 'auth/unauthorized-domain') {
            setError(
              `This domain is not authorised in Firebase. Add ${window.location.hostname} under ` +
                'Authentication, Settings, Authorized domains.',
            )
            return
          }
          setError((e as Error).message)
        }
      },
      signOutNow: async () => {
        await signOut(auth())
      },
    }),
    [user, loading, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  return useContext(AuthContext)
}
