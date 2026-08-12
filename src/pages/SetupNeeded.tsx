/**
 * Shown when the VITE_FIREBASE_* variables are missing (US-002).
 *
 * A blank page is the worst possible failure for a POC someone else is deploying, so the app
 * states exactly what is missing and what to do about it.
 */
export default function SetupNeeded() {
  const host = typeof window === 'undefined' ? '' : window.location.hostname
  return (
    <div className="page">
      <h1>Conference Runner needs its Firebase settings</h1>
      <p className="muted">
        The app is deployed, but no Firebase project is attached yet, so there is nothing to sign
        in to. This takes about ten minutes, once.
      </p>

      <div className="card stack">
        <div>
          <h3>1. Create the Firebase project</h3>
          <p className="muted small">
            At <a href="https://console.firebase.google.com">console.firebase.google.com</a>, create
            a project, then add a <strong>Web app</strong> to it. Copy the config values it shows
            you.
          </p>
        </div>
        <div>
          <h3>2. Turn on the two services</h3>
          <ul className="muted small">
            <li>
              <strong>Authentication</strong>: enable the Google sign-in provider.
            </li>
            <li>
              <strong>Firestore Database</strong>: create it in production mode, then paste in{' '}
              <code>firestore.rules</code> from the repo.
            </li>
          </ul>
          <p className="muted small">
            Firebase Storage is not needed. Logos and backgrounds are linked by URL rather than
            uploaded, so the free Spark plan is enough.
          </p>
        </div>
        <div>
          <h3>3. Authorise this domain</h3>
          <p className="muted small">
            Under Authentication, Settings, Authorized domains, add{' '}
            <code>{host || 'your-pages-domain'}</code>. Google sign-in fails silently without this.
          </p>
        </div>
        <div>
          <h3>4. Add the config as repository secrets</h3>
          <p className="muted small">
            In GitHub, Settings, Secrets and variables, Actions, add these, then re-run the deploy
            workflow:
          </p>
          <pre className="small">
            <code>{`VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID`}</code>
          </pre>
          <p className="muted small">
            Locally, copy <code>.env.example</code> to <code>.env.local</code> and fill in the same
            values.
          </p>
        </div>
      </div>

      <p className="muted small">
        Full instructions are in the repository README, including why these keys are safe to expose
        in a public build.
      </p>
    </div>
  )
}
