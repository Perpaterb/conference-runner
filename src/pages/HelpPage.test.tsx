/**
 * US-041: the help page. It renders with no Firebase, since somebody who cannot sign in is
 * exactly the person most likely to need it.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import HelpPage from './HelpPage'
import { ThemeProvider } from '../lib/theme'

const renderHelp = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    </ThemeProvider>,
  )

describe('help and instructions', () => {
  it('covers each thing somebody needs to do, not each screen', () => {
    renderHelp()
    for (const heading of [
      'Setting up an event',
      'Getting people in',
      'Groups and roles',
      'Building the schedule',
      'Reading the schedule',
      'Running the event',
      'When something looks wrong',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })

  it('explains what each role can do', () => {
    renderHelp()
    for (const role of ['Owner', 'Event team member', 'Group leader', 'Group member', 'Logged in']) {
      expect(screen.getByRole('cell', { name: role })).toBeInTheDocument()
    }
  })

  it('explains the non-uniform scale, which is surprising if unexplained', () => {
    renderHelp()
    expect(screen.getByText(/not uniform/)).toBeInTheDocument()
  })

  it('troubleshoots the failures that actually happened', () => {
    renderHelp()
    expect(screen.getByText(/You are not on the attendee list/)).toBeInTheDocument()
    expect(screen.getByText(/Missing or insufficient permissions/)).toBeInTheDocument()
    expect(screen.getByText(/Google sign-in does nothing/)).toBeInTheDocument()
  })

  it('reports honest progress figures from the stories file', () => {
    renderHelp()
    const summary = screen.getByText(/criteria are done and covered/)
    // Not a claim that everything is finished: all three states are stated.
    expect(summary.textContent).toMatch(/built but need checking by hand/)
    expect(summary.textContent).toMatch(/are not done/)
  })

  it('keeps the stories collapsed until asked, then renders them', async () => {
    const user = userEvent.setup()
    renderHelp()

    expect(screen.queryByRole('heading', { name: /US-001/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Show user stories/ }))

    expect(screen.getByRole('heading', { name: /US-001/ })).toBeInTheDocument()
    // Includes the story for this very page, so the list is genuinely the whole file.
    expect(screen.getAllByRole('heading', { name: /US-041/ }).length).toBeGreaterThan(0)
  })

  it('renders the stories as real elements, checkboxes included', async () => {
    const user = userEvent.setup()
    renderHelp()
    await user.click(screen.getByRole('button', { name: /Show user stories/ }))

    expect(document.querySelectorAll('.md-check.done').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.md-check.partial').length).toBeGreaterThan(0)
  })

  it('offers a way back to the events page', () => {
    renderHelp()
    expect(screen.getByRole('link', { name: 'My events' })).toHaveAttribute('href', '/')
  })
})
