import { describe, expect, it } from 'vitest'
import {
  MEMBER_TEMPLATE,
  buildMemberCsv,
  buildSessionTemplate,
  buildSessionCsv,
  groupIdFromName,
  isValidEmail,
  parseBool,
  parseCsv,
  parseMemberCsv,
  parseSessionCsv,
} from './csv'
import type { GroupDoc, MemberDoc, SessionDoc } from './types'
import { formatCsvDateTime, zonedTimeToEpoch } from './time'

const SYDNEY = 'Australia/Sydney'

describe('parseCsv', () => {
  it('handles quoted fields containing commas and newlines', () => {
    const text = 'a,b\n"one, two","line1\nline2"\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['one, two', 'line1\nline2'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"say ""hi"""\n')).toEqual([['a'], ['say "hi"']])
  })

  it('strips a UTF-8 BOM so the first header name is not corrupted', () => {
    expect(parseCsv('﻿email,x\na@b.com,1\n')[0][0]).toBe('email')
  })

  it('tolerates CRLF and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops blank lines that spreadsheets add', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']])
  })
})

describe('parseBool', () => {
  it('accepts the spellings people actually type', () => {
    for (const v of ['true', 'TRUE', 'Yes', 'y', '1']) expect(parseBool(v)).toBe(true)
    for (const v of ['false', 'no', '0', '', undefined]) expect(parseBool(v)).toBe(false)
  })
})

describe('parseMemberCsv (US-031)', () => {
  it('reads a variable number of group column pairs', () => {
    const csv = [
      'email,isEventTeamMember,group1Name,group1Leader,group2Name,group2Leader',
      'a@x.com,true,Platform,true,Design,false',
      'b@x.com,false,Design,false,,',
    ].join('\n')

    const { rows, errors } = parseMemberCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      email: 'a@x.com',
      isTeamMember: true,
      groups: [
        { name: 'Platform', leader: true },
        { name: 'Design', leader: false },
      ],
    })
    expect(rows[1].groups).toEqual([{ name: 'Design', leader: false }])
  })

  it('supports someone in many groups', () => {
    const csv =
      'email,isEventTeamMember,g1,l1,g2,l2,g3,l3\n' +
      'a@x.com,false,One,true,Two,false,Three,true\n'
    const { rows } = parseMemberCsv(csv)
    expect(rows[0].groups.map((g) => g.name)).toEqual(['One', 'Two', 'Three'])
    expect(rows[0].groups.filter((g) => g.leader).map((g) => g.name)).toEqual(['One', 'Three'])
  })

  it('lowercases emails so membership matching is case insensitive', () => {
    const { rows } = parseMemberCsv('email,isEventTeamMember\nMixed.Case@X.com,false\n')
    expect(rows[0].email).toBe('mixed.case@x.com')
  })

  it('reports bad rows per line instead of dropping them silently', () => {
    const csv = [
      'email,isEventTeamMember,g1,l1',
      'good@x.com,false,A,false',
      'not-an-email,false,A,false',
      ',false,A,false',
      'good@x.com,false,B,false',
    ].join('\n')

    const { rows, errors } = parseMemberCsv(csv)
    expect(rows.map((r) => r.email)).toEqual(['good@x.com'])
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatchObject({ line: 3 })
    expect(errors[0].message).toContain('not a valid email')
    expect(errors[1]).toMatchObject({ line: 4 })
    expect(errors[2].message).toContain('Duplicate')
  })

  it('flags a leader flag with no group name beside it', () => {
    const { errors } = parseMemberCsv('email,isEventTeamMember,g1,l1\na@x.com,false,,true\n')
    expect(errors[0].message).toContain('no group name')
  })

  it('rejects a file whose first column is not email', () => {
    const { errors } = parseMemberCsv('name,email\nBob,a@x.com\n')
    expect(errors[0].message).toContain('First column must be "email"')
  })

  it('reports an empty file rather than importing nothing quietly', () => {
    expect(parseMemberCsv('').errors[0].message).toContain('empty')
  })
})

describe('buildMemberCsv (US-032)', () => {
  const groups: GroupDoc[] = [
    { id: 'platform', name: 'Platform' },
    { id: 'design', name: 'Design' },
  ]
  const members: MemberDoc[] = [
    {
      id: 'b@x.com',
      email: 'b@x.com',
      isTeamMember: false,
      groups: { design: { leader: false } },
      isLeader: false,
      ledGroupIds: [],
    },
    {
      id: 'a@x.com',
      email: 'a@x.com',
      isTeamMember: true,
      groups: { platform: { leader: true }, design: { leader: false } },
      isLeader: true,
      ledGroupIds: ['platform'],
    },
  ]

  it('exports the same shape the importer reads', () => {
    const csv = buildMemberCsv(members, groups)
    const table = parseCsv(csv)
    expect(table[0]).toEqual([
      'email',
      'isEventTeamMember',
      'group1Name',
      'group1Leader',
      'group2Name',
      'group2Leader',
    ])
    expect(table[1][0]).toBe('a@x.com')
  })

  it('round-trips: export then import preserves roles and memberships', () => {
    const { rows, errors } = parseMemberCsv(buildMemberCsv(members, groups))
    expect(errors).toEqual([])

    const a = rows.find((r) => r.email === 'a@x.com')!
    expect(a.isTeamMember).toBe(true)
    expect(new Set(a.groups.map((g) => `${g.name}:${g.leader}`))).toEqual(
      new Set(['Platform:true', 'Design:false']),
    )

    const b = rows.find((r) => r.email === 'b@x.com')!
    expect(b.isTeamMember).toBe(false)
    expect(b.groups).toEqual([{ name: 'Design', leader: false }])
  })

  it('pads rows so every record has the full column count', () => {
    const table = parseCsv(buildMemberCsv(members, groups))
    expect(new Set(table.map((r) => r.length)).size).toBe(1)
  })
})

describe('groupIdFromName', () => {
  it('is stable across spelling variations of the same name', () => {
    expect(groupIdFromName('Platform Team')).toBe('platform-team')
    expect(groupIdFromName('  platform   team ')).toBe('platform-team')
  })

  it('never produces an empty id', () => {
    expect(groupIdFromName('!!!')).toBe('group')
  })
})

describe('parseSessionCsv (US-045)', () => {
  it('reads sessions with groups and ALL', () => {
    const csv = [
      'title,description,location,start,end,groups',
      'Opening,Welcome,Main hall,28 Jun 2026 09:00,28 Jun 2026 10:00,ALL',
      'Breakout,Plan,Room 2,28 Jun 2026 10:15,28 Jun 2026 12:00,Platform;Design',
    ].join('\n')

    const { rows, errors } = parseSessionCsv(csv, SYDNEY)
    expect(errors).toEqual([])
    expect(rows[0].allGroups).toBe(true)
    expect(rows[0].startAt).toBe(zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY))
    expect(rows[1].groupNames).toEqual(['Platform', 'Design'])
    expect(rows[1].allGroups).toBe(false)
  })

  it('reports unreadable times with the expected format in the message', () => {
    const csv = 'title,start,end\nBad,yesterday,28 Jun 2026 10:00\n'
    const { rows, errors } = parseSessionCsv(csv, SYDNEY)
    expect(rows).toHaveLength(0)
    expect(errors[0].line).toBe(2)
    expect(errors[0].message).toContain('DD MMM YYYY HH:mm')
  })

  it('rejects a session that ends before it starts', () => {
    const csv = 'title,start,end\nBackwards,28 Jun 2026 10:00,28 Jun 2026 09:00\n'
    const { rows, errors } = parseSessionCsv(csv, SYDNEY)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toBe('End time must be after start time.')
  })

  it('names the missing required columns', () => {
    const { errors } = parseSessionCsv('title,location\nx,y\n', SYDNEY)
    expect(errors[0].message).toContain('start')
    expect(errors[0].message).toContain('end')
  })

  it('round-trips through buildSessionCsv (US-046)', () => {
    const groups: GroupDoc[] = [{ id: 'platform', name: 'Platform' }]
    const sessions: SessionDoc[] = [
      {
        id: '1',
        title: 'Opening',
        description: 'Welcome, everyone',
        location: 'Main hall',
        startAt: zonedTimeToEpoch(2026, 6, 28, 9, 0, SYDNEY),
        endAt: zonedTimeToEpoch(2026, 6, 28, 10, 0, SYDNEY),
        groupIds: ['platform'],
        allGroups: false,
      },
    ]
    const { rows, errors } = parseSessionCsv(buildSessionCsv(sessions, groups, SYDNEY), SYDNEY)
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({
      title: 'Opening',
      description: 'Welcome, everyone',
      location: 'Main hall',
      startAt: sessions[0].startAt,
      endAt: sessions[0].endAt,
      groupNames: ['Platform'],
    })
  })
})

describe('the shipped example data', () => {
  it('member example parses with no errors', () => {
    const { rows, errors } = parseMemberCsv(MEMBER_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(20)
  })

  it('covers 5 groups', () => {
    const { rows } = parseMemberCsv(MEMBER_TEMPLATE)
    const names = new Set(rows.flatMap((r) => r.groups.map((g) => g.name)))
    expect(names).toEqual(new Set(['Platform', 'Design', 'Data', 'QA', 'Leadership']))
  })

  it('demonstrates every role, including people with no group at all', () => {
    const { rows } = parseMemberCsv(MEMBER_TEMPLATE)
    expect(rows.filter((r) => r.isTeamMember).length).toBeGreaterThanOrEqual(2)
    expect(rows.filter((r) => r.groups.some((g) => g.leader)).length).toBeGreaterThanOrEqual(5)
    expect(rows.filter((r) => r.groups.length === 0).length).toBeGreaterThanOrEqual(2)
  })

  it('includes someone leading one group while only belonging to another', () => {
    const { rows } = parseMemberCsv(MEMBER_TEMPLATE)
    const mixed = rows.filter(
      (r) => r.groups.some((g) => g.leader) && r.groups.some((g) => !g.leader),
    )
    expect(mixed.length).toBeGreaterThan(0)
  })

  it('includes somebody in three groups at once', () => {
    const { rows } = parseMemberCsv(MEMBER_TEMPLATE)
    expect(Math.max(...rows.map((r) => r.groups.length))).toBe(3)
  })

  it('gives every group at least one leader, so nobody is left unmanaged', () => {
    const { rows } = parseMemberCsv(MEMBER_TEMPLATE)
    const led = new Set(rows.flatMap((r) => r.groups.filter((g) => g.leader).map((g) => g.name)))
    expect(led).toEqual(new Set(['Platform', 'Design', 'Data', 'QA', 'Leadership']))
  })
})

describe('the shipped example agenda', () => {
  const eventStart = zonedTimeToEpoch(2026, 9, 11, 9, 0, SYDNEY)
  const csv = () => buildSessionTemplate(eventStart, SYDNEY)

  it('parses with no errors and has 15 sessions', () => {
    const { rows, errors } = parseSessionCsv(csv(), SYDNEY)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(15)
  })

  it('is generated from the event start date rather than a fixed past date', () => {
    const { rows } = parseSessionCsv(csv(), SYDNEY)
    const first = rows.reduce((a, b) => (a.startAt < b.startAt ? a : b))
    expect(formatCsvDateTime(first.startAt, SYDNEY)).toBe('11 Sep 2026 09:00')
  })

  it('spans two calendar days', () => {
    const { rows } = parseSessionCsv(csv(), SYDNEY)
    const days = new Set(rows.map((r) => formatCsvDateTime(r.startAt, SYDNEY).slice(0, 11)))
    expect(days.size).toBe(2)
  })

  it('has concurrent sessions in different locations, which is the point of the example', () => {
    const { rows } = parseSessionCsv(csv(), SYDNEY)
    const overlapping = rows.filter((a) =>
      rows.some((b) => b !== a && b.startAt < a.endAt && a.startAt < b.endAt),
    )
    expect(overlapping.length).toBeGreaterThanOrEqual(6)
    expect(new Set(overlapping.map((r) => r.location)).size).toBeGreaterThanOrEqual(4)
  })

  it('mixes whole-event sessions with group-specific ones', () => {
    const { rows } = parseSessionCsv(csv(), SYDNEY)
    expect(rows.filter((r) => r.allGroups).length).toBeGreaterThanOrEqual(6)
    expect(rows.filter((r) => r.groupNames.length === 1).length).toBeGreaterThanOrEqual(4)
    expect(rows.filter((r) => r.groupNames.length > 1).length).toBeGreaterThanOrEqual(2)
  })

  it('only names groups that exist in the member example', () => {
    const { rows: sessions } = parseSessionCsv(csv(), SYDNEY)
    const { rows: members } = parseMemberCsv(MEMBER_TEMPLATE)
    const known = new Set(members.flatMap((m) => m.groups.map((g) => g.name)))
    for (const s of sessions) {
      for (const name of s.groupNames) expect(known).toContain(name)
    }
  })

  it('every session ends after it starts', () => {
    const { rows } = parseSessionCsv(csv(), SYDNEY)
    for (const r of rows) expect(r.endAt).toBeGreaterThan(r.startAt)
  })
})

describe('isValidEmail (US-037: adding a person on the spot)', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('a@x.com')).toBe(true)
    expect(isValidEmail('first.last+tag@sub.example.co.uk')).toBe(true)
  })

  it('ignores surrounding whitespace and case', () => {
    expect(isValidEmail('  A@X.COM  ')).toBe(true)
  })

  it('rejects what is obviously not an address', () => {
    for (const bad of ['', '   ', 'nope', 'a@b', 'a b@x.com', '@x.com', 'a@']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })

  it('agrees with the CSV importer, so both accept the same thing', () => {
    const { rows, errors } = parseMemberCsv('email,isEventTeamMember\nfirst.last+tag@x.co.uk,false\n')
    expect(errors).toEqual([])
    expect(isValidEmail(rows[0].email)).toBe(true)
  })
})
