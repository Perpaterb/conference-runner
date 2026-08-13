import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { isFirebaseConfigured } from './lib/firebase'
import HomePage from './pages/HomePage'
import EventPage from './pages/EventPage'
import SetupNeeded from './pages/SetupNeeded'

/**
 * Hash routing is deliberate (US-001). GitHub Pages cannot rewrite unknown paths to index.html,
 * so a hard refresh on /e/<slug> would 404. With a hash, deep links survive a refresh with no
 * redirect trickery.
 */
export default function App() {
  return (
    <ThemeProvider>
      {isFirebaseConfigured() ? (
        <AuthProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/e/:eventId" element={<EventPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      ) : (
        <SetupNeeded />
      )}
    </ThemeProvider>
  )
}
