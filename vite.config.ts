import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from /conference-runner/.
// Override with BASE_PATH=/ when hosting at a domain root.
const base = process.env.BASE_PATH ?? '/conference-runner/'

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Rules tests need a running Firestore emulator, so they run separately via
    // `npm run test:rules` rather than as part of the fast unit suite.
    exclude: ['src/rules/**'],
  },
})
