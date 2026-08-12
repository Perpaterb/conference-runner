#!/usr/bin/env node
/**
 * Reports which user stories have automated test coverage and which do not.
 *
 * "87 tests pass" is not an answer to "does the product work". This counts stories, and it is
 * deliberately blunt about the ones nothing verifies: a story is covered only if its ID appears
 * in a test file.
 *
 * Usage: node scripts/story-coverage.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const STORIES_FILE = 'docs/UserStories.md'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.test\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

const storiesText = readFileSync(STORIES_FILE, 'utf8')
const stories = [...storiesText.matchAll(/^### (US-\d+)\s+(.*)$/gm)].map((m) => ({
  id: m[1],
  title: m[2].trim(),
}))

const testText = walk('src')
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

const covered = stories.filter((s) => testText.includes(s.id))
const uncovered = stories.filter((s) => !testText.includes(s.id))

const pct = stories.length ? Math.round((covered.length / stories.length) * 100) : 0

console.log(`Story coverage: ${covered.length}/${stories.length} (${pct}%)\n`)

if (covered.length) {
  console.log('Covered by automated tests:')
  for (const s of covered) console.log(`  ${s.id}  ${s.title}`)
  console.log('')
}

if (uncovered.length) {
  console.log('NOT covered by automated tests (verify these by hand):')
  for (const s of uncovered) console.log(`  ${s.id}  ${s.title}`)
  console.log('')
  console.log(
    'Most of these need a signed-in browser against a real Firebase project, which the unit\n' +
      'suite cannot reach. They are listed so the gap stays visible rather than implied.',
  )
}
