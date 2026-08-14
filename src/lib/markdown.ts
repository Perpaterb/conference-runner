/**
 * A deliberately small Markdown reader (US-041).
 *
 * The help page renders `docs/UserStories.md` itself rather than a copy, so the two cannot drift
 * apart. That file uses a known, narrow subset, and this parses exactly that subset: headings,
 * checklists, bullets, tables, blockquotes, rules, and inline code, bold and links.
 *
 * It returns a structure rather than HTML, so the component renders real elements and nothing is
 * ever injected as raw markup.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'link'; text: string; href: string }

/** `[x]` done, `[~]` partial, `[ ]` not done. Undefined for a plain bullet. */
export type CheckState = 'done' | 'partial' | 'todo'

export interface ListItem {
  content: Inline[]
  check?: CheckState
}

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'quote'; content: Inline[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' }

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(<https?:\/\/[^>]+>)/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text

  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match || match.index === undefined) {
      out.push({ type: 'text', text: rest })
      break
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) })

    const token = match[0]
    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**')) {
      out.push({ type: 'bold', text: token.slice(2, -2) })
    } else if (token.startsWith('<')) {
      const href = token.slice(1, -1)
      out.push({ type: 'link', text: href, href })
    } else {
      const split = token.indexOf('](')
      out.push({
        type: 'link',
        text: token.slice(1, split),
        href: token.slice(split + 2, -1),
      })
    }
    rest = rest.slice(match.index + token.length)
  }

  return out.filter((part) => part.type !== 'text' || part.text.length > 0)
}

const CHECKS: Record<string, CheckState> = { x: 'done', '~': 'partial', ' ': 'todo' }

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length === 0) return
    blocks.push({ type: 'paragraph', content: parseInline(buffer.join(' ')) })
    buffer.length = 0
  }

  const paragraph: string[] = []

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph(paragraph)
      i++
      continue
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph(paragraph)
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph(paragraph)
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2]),
      })
      i++
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(paragraph)
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', content: parseInline(quote.join(' ')) })
      continue
    }

    if (trimmed.startsWith('|')) {
      flushParagraph(paragraph)
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i].trim())
        // The |---|---| separator carries no content.
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      const [header, ...body] = rows
      blocks.push({
        type: 'table',
        header: (header ?? []).map(parseInline),
        rows: body.map((r) => r.map(parseInline)),
      })
      continue
    }

    if (/^[-*]\s/.test(trimmed)) {
      flushParagraph(paragraph)
      const items: ListItem[] = []
      while (i < lines.length) {
        const current = lines[i]
        const currentTrimmed = current.trim()
        if (/^[-*]\s/.test(currentTrimmed)) {
          const text = currentTrimmed.replace(/^[-*]\s+/, '')
          const box = /^\[([x~ ])\]\s*(.*)$/i.exec(text)
          items.push(
            box
              ? { check: CHECKS[box[1].toLowerCase()], content: parseInline(box[2]) }
              : { content: parseInline(text) },
          )
          i++
        } else if (/^\s+\S/.test(current) && items.length > 0) {
          // A wrapped continuation line belongs to the item above it.
          const last = items[items.length - 1]
          last.content = parseInline(
            inlineToText(last.content) + ' ' + currentTrimmed,
          )
          i++
        } else {
          break
        }
      }
      blocks.push({ type: 'list', items })
      continue
    }

    paragraph.push(trimmed)
    i++
  }

  flushParagraph(paragraph)
  return blocks
}

/** Flattens inline parts back to source text, for joining wrapped list lines. */
export function inlineToText(parts: Inline[]): string {
  return parts
    .map((p) => {
      if (p.type === 'code') return `\`${p.text}\``
      if (p.type === 'bold') return `**${p.text}**`
      if (p.type === 'link') return p.text === p.href ? `<${p.href}>` : `[${p.text}](${p.href})`
      return p.text
    })
    .join('')
}

export interface StoryProgress {
  done: number
  partial: number
  todo: number
  total: number
}

/** Counts the checkboxes, so the help page can state progress instead of implying it. */
export function countProgress(blocks: Block[]): StoryProgress {
  let done = 0
  let partial = 0
  let todo = 0
  for (const block of blocks) {
    if (block.type !== 'list') continue
    for (const item of block.items) {
      if (item.check === 'done') done++
      else if (item.check === 'partial') partial++
      else if (item.check === 'todo') todo++
    }
  }
  return { done, partial, todo, total: done + partial + todo }
}
