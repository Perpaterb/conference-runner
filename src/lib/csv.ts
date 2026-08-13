/**
 * CSV parsing and serialising, with no dependency on a CSV library so the behaviour is fully
 * testable and the failure reporting is per row (US-031, US-045).
 */

import type { GroupDoc, MemberDoc, SessionDoc } from './types'
import { epochToZonedParts, formatCsvDateTime, parseCsvDateTime, zonedTimeToEpoch } from './time'

/** RFC4180-ish reader: handles quoted fields, embedded commas, newlines and "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // A leading BOM would otherwise become part of the first header name.
  if (text.charCodeAt(0) === 0xfeff) i = 1

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      endField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      endRow()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  // Trailing content without a final newline is still a row.
  if (field !== '' || row.length > 0) endRow()

  // Drop entirely blank lines, which spreadsheets add liberally.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => escapeField(c ?? '')).join(',')).join('\r\n') + '\r\n'
}

export function parseBool(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'true' || v === 'yes' || v === 'y' || v === '1'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Stable, human-readable group id derived from the name so CSV round-trips match by name. */
export function groupIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'group'
}

export interface RowError {
  /** 1-based line number as seen in a spreadsheet, header included. */
  line: number
  message: string
}

export interface ImportResult<T> {
  rows: T[]
  errors: RowError[]
}

// ---------------------------------------------------------------------------
// Members (US-031, US-032)
// ---------------------------------------------------------------------------

export interface ParsedMemberRow {
  email: string
  isTeamMember: boolean
  /** Display names as typed in the CSV; ids are derived with groupIdFromName. */
  groups: { name: string; leader: boolean }[]
}

/**
 * A worked example rather than a bare header row: 20 people across 5 groups, showing every
 * combination the format supports. Delete the rows you do not need.
 *
 * Between them these rows demonstrate: event team members who are also group leaders, people
 * leading one group while merely belonging to another, someone in three groups at once, groups
 * with two leaders, and two people in no group at all (who will see "You are not in any groups"
 * until somebody adds them).
 */
export const MEMBER_TEMPLATE = buildCsv([
  [
    'email',
    'isEventTeamMember',
    'group1Name',
    'group1Leader',
    'group2Name',
    'group2Leader',
    'group3Name',
    'group3Leader',
  ],
  // Event team: run the event, can see and edit everything.
  ['rta@example.com', 'true', 'Leadership', 'true', '', '', '', ''],
  ['scrum.master@example.com', 'true', 'Leadership', 'false', 'Platform', 'false', '', ''],
  // Group leaders: manage their own group, and can request attendance from its members.
  ['priya.raman@example.com', 'false', 'Platform', 'true', 'Data', 'false', '', ''],
  ['tom.becker@example.com', 'false', 'Platform', 'true', '', '', '', ''],
  ['aiko.tanaka@example.com', 'false', 'Design', 'true', 'Platform', 'false', '', ''],
  ['marcus.hall@example.com', 'false', 'Data', 'true', '', '', '', ''],
  ['sofia.reyes@example.com', 'false', 'QA', 'true', 'Data', 'false', '', ''],
  ['nina.olsen@example.com', 'false', 'Leadership', 'true', 'Design', 'false', '', ''],
  // Someone who spans three groups.
  ['dev.patel@example.com', 'false', 'Platform', 'false', 'Data', 'false', 'QA', 'false'],
  // Ordinary members.
  ['liam.murphy@example.com', 'false', 'Platform', 'false', '', '', '', ''],
  ['grace.chen@example.com', 'false', 'Platform', 'false', 'QA', 'false', '', ''],
  ['omar.haddad@example.com', 'false', 'Design', 'false', '', '', '', ''],
  ['ella.novak@example.com', 'false', 'Design', 'false', 'QA', 'false', '', ''],
  ['jonas.weber@example.com', 'false', 'Data', 'false', '', '', '', ''],
  ['mei.lin@example.com', 'false', 'Data', 'false', 'Platform', 'false', '', ''],
  ['ruben.diaz@example.com', 'false', 'QA', 'false', '', '', '', ''],
  ['hana.suzuki@example.com', 'false', 'QA', 'false', 'Design', 'false', '', ''],
  ['felix.arnold@example.com', 'false', 'Leadership', 'false', '', '', '', ''],
  // No groups yet: these two show the "logged in but not placed" state.
  ['new.starter@example.com', 'false', '', '', '', '', '', ''],
  ['observer@example.com', 'false', '', '', '', '', '', ''],
])

/**
 * Reads the variable-width member CSV. Column pairs after the first two are
 * (group name, is leader) repeated as many times as needed.
 */
export function parseMemberCsv(text: string): ImportResult<ParsedMemberRow> {
  const table = parseCsv(text)
  const errors: RowError[] = []
  const rows: ParsedMemberRow[] = []
  if (table.length === 0) {
    return { rows, errors: [{ line: 1, message: 'The file is empty.' }] }
  }

  const header = table[0].map((h) => h.trim().toLowerCase())
  if (header[0] !== 'email') {
    errors.push({ line: 1, message: 'First column must be "email".' })
    return { rows, errors }
  }

  const seen = new Set<string>()
  for (let r = 1; r < table.length; r++) {
    const line = r + 1
    const cells = table[r]
    const email = normaliseEmail(cells[0] ?? '')
    if (!email) {
      errors.push({ line, message: 'Missing email.' })
      continue
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ line, message: `"${email}" is not a valid email address.` })
      continue
    }
    if (seen.has(email)) {
      errors.push({ line, message: `Duplicate email "${email}"; the later row was ignored.` })
      continue
    }

    const groups: { name: string; leader: boolean }[] = []
    const groupNames = new Set<string>()
    let rowValid = true
    for (let c = 2; c < cells.length; c += 2) {
      const name = (cells[c] ?? '').trim()
      const leaderCell = cells[c + 1]
      if (!name) {
        // An empty group slot is normal padding; a leader flag without a name is not.
        if ((leaderCell ?? '').trim() !== '') {
          errors.push({
            line,
            message: `Leader flag in column ${c + 2} has no group name beside it.`,
          })
          rowValid = false
        }
        continue
      }
      if (groupNames.has(name.toLowerCase())) {
        errors.push({ line, message: `Group "${name}" listed twice for ${email}.` })
        rowValid = false
        continue
      }
      groupNames.add(name.toLowerCase())
      groups.push({ name, leader: parseBool(leaderCell) })
    }
    if (!rowValid) continue

    seen.add(email)
    rows.push({ email, isTeamMember: parseBool(cells[1]), groups })
  }

  return { rows, errors }
}

export function buildMemberCsv(members: MemberDoc[], groups: GroupDoc[]): string {
  const nameById = new Map(groups.map((g) => [g.id, g.name]))
  const widest = members.reduce((max, m) => Math.max(max, Object.keys(m.groups).length), 0)
  const columns = Math.max(widest, 1)

  const header = ['email', 'isEventTeamMember']
  for (let i = 1; i <= columns; i++) header.push(`group${i}Name`, `group${i}Leader`)

  const sorted = [...members].sort((a, b) => a.email.localeCompare(b.email))
  const rows = sorted.map((m) => {
    const cells = [m.email, String(m.isTeamMember)]
    const entries = Object.entries(m.groups).sort(([a], [b]) =>
      (nameById.get(a) ?? a).localeCompare(nameById.get(b) ?? b),
    )
    for (const [groupId, membership] of entries) {
      cells.push(nameById.get(groupId) ?? groupId, String(membership.leader))
    }
    while (cells.length < header.length) cells.push('')
    return cells
  })

  return buildCsv([header, ...rows])
}

// ---------------------------------------------------------------------------
// Sessions (US-045, US-046)
// ---------------------------------------------------------------------------

export interface ParsedSessionRow {
  title: string
  description: string
  location: string
  startAt: number
  endAt: number
  /** Group display names; "ALL" is represented by allGroups. */
  groupNames: string[]
  allGroups: boolean
}

/**
 * A worked two-day agenda: 15 sessions including four concurrent breakouts in different rooms,
 * a leadership session overlapping a cross-team one, and plenaries for everybody.
 *
 * The dates are generated from the event's own start date, so the file imports cleanly instead
 * of landing on some fixed date in the past. Day 2 is the calendar day after day 1.
 */
export function buildSessionTemplate(eventStartAt: number, timeZone: string): string {
  const day1 = epochToZonedParts(eventStartAt, timeZone)
  const middayDay1 = zonedTimeToEpoch(day1.year, day1.month, day1.day, 12, 0, timeZone)
  const day2 = epochToZonedParts(middayDay1 + 86_400_000, timeZone)

  const at = (day: typeof day1, hour: number, minute: number) =>
    formatCsvDateTime(zonedTimeToEpoch(day.year, day.month, day.day, hour, minute, timeZone), timeZone)

  const rows: string[][] = [
    ['title', 'description', 'location', 'start', 'end', 'groups'],

    // Day 1: plenary, four concurrent breakouts, then cross-team work.
    ['Opening plenary', 'Welcome, safety, and how the two days run.', 'Main hall', at(day1, 9, 0), at(day1, 9, 30), 'ALL'],
    ['Business context and vision', 'Where the product is heading this quarter.', 'Main hall', at(day1, 9, 30), at(day1, 10, 30), 'ALL'],
    ['Morning break', '', 'Foyer', at(day1, 10, 30), at(day1, 10, 45), 'ALL'],
    ['Platform breakout', 'Capacity, dependencies and draft objectives.', 'Room 1', at(day1, 10, 45), at(day1, 12, 0), 'Platform'],
    ['Design breakout', 'Research findings and the design backlog.', 'Room 2', at(day1, 10, 45), at(day1, 12, 0), 'Design'],
    ['Data breakout', 'Pipeline work and reporting commitments.', 'Room 3', at(day1, 10, 45), at(day1, 12, 0), 'Data'],
    ['QA breakout', 'Test strategy and environment needs.', 'Room 4', at(day1, 10, 45), at(day1, 12, 0), 'QA'],
    ['Lunch', '', 'Foyer', at(day1, 12, 0), at(day1, 13, 0), 'ALL'],
    ['Draft plan review', 'Each group walks its draft plan.', 'Main hall', at(day1, 13, 0), at(day1, 14, 30), 'ALL'],
    // These two run at the same time for different audiences.
    ['Leadership sync', 'Scope and budget calls arising from the drafts.', 'Room 5', at(day1, 14, 30), at(day1, 15, 30), 'Leadership'],
    ['Cross-team dependency mapping', 'Work the dependency board together.', 'Main hall', at(day1, 14, 30), at(day1, 16, 0), 'Platform;Design;Data;QA'],
    ['Day 1 wrap and risks', 'ROAMing the risks raised today.', 'Main hall', at(day1, 16, 0), at(day1, 17, 0), 'ALL'],

    // Day 2: two concurrent working sessions, then commitment.
    ['Final plan drafting', 'Close out objectives and estimates.', 'Room 1', at(day2, 9, 0), at(day2, 10, 30), 'Platform;Data'],
    ['Design critique and QA handover', 'Walk the flows and agree test coverage.', 'Room 2', at(day2, 9, 0), at(day2, 10, 30), 'Design;QA'],
    ['Plan commitment and confidence vote', 'Final plans, then the confidence vote.', 'Main hall', at(day2, 11, 0), at(day2, 12, 0), 'ALL'],
  ]

  return buildCsv(rows)
}

/** `groups` is semicolon-separated names, or the literal ALL for every group. */
export function parseSessionCsv(text: string, timeZone: string): ImportResult<ParsedSessionRow> {
  const table = parseCsv(text)
  const errors: RowError[] = []
  const rows: ParsedSessionRow[] = []
  if (table.length === 0) {
    return { rows, errors: [{ line: 1, message: 'The file is empty.' }] }
  }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const required = ['title', 'start', 'end']
  const index: Record<string, number> = {}
  for (const key of ['title', 'description', 'location', 'start', 'end', 'groups']) {
    index[key] = header.indexOf(key)
  }
  const missing = required.filter((k) => index[k] < 0)
  if (missing.length) {
    errors.push({ line: 1, message: `Missing required column(s): ${missing.join(', ')}.` })
    return { rows, errors }
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1
    const cells = table[r]
    const cell = (key: string) => (index[key] >= 0 ? (cells[index[key]] ?? '').trim() : '')

    const title = cell('title')
    if (!title) {
      errors.push({ line, message: 'Missing title.' })
      continue
    }

    const startAt = parseCsvDateTime(cell('start'), timeZone)
    if (startAt === null) {
      errors.push({
        line,
        message: `Could not read start "${cell('start')}". Use DD MMM YYYY HH:mm, e.g. 28 Jun 2026 09:00.`,
      })
      continue
    }
    const endAt = parseCsvDateTime(cell('end'), timeZone)
    if (endAt === null) {
      errors.push({
        line,
        message: `Could not read end "${cell('end')}". Use DD MMM YYYY HH:mm, e.g. 28 Jun 2026 10:00.`,
      })
      continue
    }
    if (endAt <= startAt) {
      errors.push({ line, message: 'End time must be after start time.' })
      continue
    }

    const groupsCell = cell('groups')
    const allGroups = groupsCell.toUpperCase() === 'ALL'
    const groupNames = allGroups
      ? []
      : groupsCell
          .split(';')
          .map((g) => g.trim())
          .filter(Boolean)

    rows.push({
      title,
      description: cell('description'),
      location: cell('location'),
      startAt,
      endAt,
      groupNames,
      allGroups,
    })
  }

  return { rows, errors }
}

export function buildSessionCsv(
  sessions: SessionDoc[],
  groups: GroupDoc[],
  timeZone: string,
): string {
  const nameById = new Map(groups.map((g) => [g.id, g.name]))
  const header = ['title', 'description', 'location', 'start', 'end', 'groups']
  const sorted = [...sessions].sort((a, b) => a.startAt - b.startAt)
  const rows = sorted.map((s) => [
    s.title,
    s.description,
    s.location,
    formatCsvDateTime(s.startAt, timeZone),
    formatCsvDateTime(s.endAt, timeZone),
    s.allGroups ? 'ALL' : s.groupIds.map((id) => nameById.get(id) ?? id).join(';'),
  ])
  return buildCsv([header, ...rows])
}

/** Triggers a client-side file download. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
