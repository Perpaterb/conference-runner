import { defineConfig } from 'vitest/config'

/**
 * Security rules tests run separately from the unit suite: they need a Firestore emulator, run
 * in Node rather than jsdom, and are far slower. Start them with `npm run test:rules`, which
 * boots the emulator around this config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/rules/**/*.test.ts'],
    // Rules tests share one emulator and clear it between cases, so they must not interleave.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
