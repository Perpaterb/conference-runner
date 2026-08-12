/**
 * Firebase initialisation (US-002).
 *
 * The web config is public by design; it identifies the project, it does not authorise anything.
 * All enforcement lives in firestore.rules and storage.rules.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.authDomain && config.appId)
}

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      'Firebase is not configured. Set the VITE_FIREBASE_* environment variables (see README).',
    )
  }
  if (!app) app = initializeApp(config as Required<typeof config>)
  return app
}

export function auth(): Auth {
  if (!authInstance) authInstance = getAuth(ensureApp())
  return authInstance
}

export function db(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(ensureApp())
  return dbInstance
}

/** Firestore document ids cannot contain "/". Emails are otherwise safe as ids. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, '_')
}
