/**
 * US-033: the roster stays usable with many people and many groups.
 *
 * Group columns can be switched off individually, or all at once, and the choice is remembered
 * per event.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PeopleTab from './PeopleTab'
import { computeLedGroupIds } from '../lib/types'
import type { EventDoc, GroupDoc, MemberDoc } from '../lib/types'

const event: EventDoc = {
  id: 'evt1',
  name: 'PI Planning',
  ownerUid: 'owner-uid',
  ownerEmail: 'owner@x.com',
  startAt: 0,
  endAt: 1,
  timeZone: 'Australia/Sydney',
  createdAt: 0,
}

const groups: GroupDoc[] = [
  { id: 'platform', name: 'Platform' },
  { id: 'design', name: 'Design' },
  { id: 'data', name: 'Data' },
]

function member(email: string, groupIds: Record<string, boolean> = {}): MemberDoc {
  const g = Object.fromEntries(Object.entries(groupIds).map(([k, v]) => [k, { leader: v }]))
  return {
    id: email,
    email,
    isTeamMember: false,
    groups: g,
    isLeader: computeLedGroupIds(g).length > 0,
    ledGroupIds: computeLedGroupIds(g),
  }
}

const members = [
  member('a@x.com', { platform: false }),
  member('b@x.com', { design: false }),
  member('c@x.com', { data: false }),
  member('nobody@x.com'),
]

function renderTab() {
  return render(
    <PeopleTab
      event={event}
      role="team"
      myMember={undefined}
      members={members}
      groups={groups}
    />,
  )
}

const columnHeaders = () =>
  within(screen.getAllByRole('table')[0])
    .getAllByRole('columnheader')
    .map((th) => th.textContent)

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('group column filter', () => {
  it('shows every group column by default', () => {
    renderTab()
    expect(columnHeaders()).toEqual(['Email', 'Event team', 'Platform', 'Design', 'Data'])
    expect(screen.getByText('Group columns shown: 3 of 3')).toBeInTheDocument()
  })

  it('hides a single group when its chip is clicked', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Design/ }))

    expect(columnHeaders()).toEqual(['Email', 'Event team', 'Platform', 'Data'])
    expect(screen.getByText('Group columns shown: 2 of 3')).toBeInTheDocument()
  })

  it('brings a hidden group back when its chip is clicked again', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Design/ }))
    await user.click(screen.getByRole('button', { name: /Design/ }))

    expect(columnHeaders()).toContain('Design')
  })

  it('None clears the selection and All restores it', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: 'None' }))
    expect(columnHeaders()).toEqual(['Email', 'Event team'])
    expect(screen.getByText(/All group columns are hidden/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(columnHeaders()).toEqual(['Email', 'Event team', 'Platform', 'Design', 'Data'])
  })

  it('disables All when everything is already shown, and None when nothing is', async () => {
    const user = userEvent.setup()
    renderTab()

    expect(screen.getByRole('button', { name: 'All' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'None' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'None' }))

    expect(screen.getByRole('button', { name: 'All' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'None' })).toBeDisabled()
  })

  it('flags people who are in a group that is currently hidden', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Design/ }))

    const row = screen.getByText('b@x.com').closest('tr')!
    expect(within(row).getByText(/\+1 hidden/)).toBeInTheDocument()
  })

  it('keeps every person listed even when their group column is hidden', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: 'None' }))

    for (const m of members) expect(screen.getByText(m.email)).toBeInTheDocument()
  })

  it('remembers the hidden columns per event', async () => {
    const user = userEvent.setup()
    const first = renderTab()
    await user.click(screen.getByRole('button', { name: /Design/ }))
    first.unmount()

    renderTab()
    expect(columnHeaders()).not.toContain('Design')
  })
})

describe('optionally narrowing the rows too', () => {
  it('hides people who are in none of the shown groups', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Design/ }))
    await user.click(screen.getByRole('button', { name: /Data/ }))
    await user.click(screen.getByLabelText(/Also hide people who are not in any of the shown/))

    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.queryByText('b@x.com')).not.toBeInTheDocument()
    expect(screen.queryByText('nobody@x.com')).not.toBeInTheDocument()
  })

  it('leaves everyone visible while the option is off', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: 'None' }))

    expect(screen.getByText('nobody@x.com')).toBeInTheDocument()
  })
})
