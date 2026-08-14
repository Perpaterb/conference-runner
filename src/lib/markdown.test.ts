import { describe, expect, it } from 'vitest'
import storiesSource from '../../docs/UserStories.md?raw'
import { countProgress, parseInline, parseMarkdown } from './markdown'

describe('inline formatting', () => {
  it('reads plain text', () => {
    expect(parseInline('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('reads code, bold and links', () => {
    expect(parseInline('a `code` b')).toContainEqual({ type: 'code', text: 'code' })
    expect(parseInline('a **bold** b')).toContainEqual({ type: 'bold', text: 'bold' })
    expect(parseInline('see [docs](https://example.com)')).toContainEqual({
      type: 'link',
      text: 'docs',
      href: 'https://example.com',
    })
  })

  it('reads a bare angle-bracket URL', () => {
    expect(parseInline('<https://example.com/x>')).toEqual([
      { type: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
    ])
  })

  it('keeps the surrounding text in order', () => {
    expect(parseInline('run `npm test` first').map((p) => p.text)).toEqual([
      'run ',
      'npm test',
      ' first',
    ])
  })

  it('drops nothing and invents nothing', () => {
    const text = 'a **b** c `d` e'
    expect(parseInline(text).map((p) => p.text).join('')).toBe('a b c d e')
  })
})

describe('block parsing', () => {
  it('reads headings with their level', () => {
    const [block] = parseMarkdown('### US-001 Something')
    expect(block).toMatchObject({ type: 'heading', level: 3 })
  })

  it('reads the three checkbox states', () => {
    const [list] = parseMarkdown('- [x] done\n- [~] partial\n- [ ] todo')
    expect(list).toMatchObject({
      type: 'list',
      items: [{ check: 'done' }, { check: 'partial' }, { check: 'todo' }],
    })
  })

  it('reads a plain bullet with no checkbox', () => {
    const [list] = parseMarkdown('- just a bullet')
    expect(list.type === 'list' && list.items[0].check).toBeUndefined()
  })

  it('joins a wrapped list item back together', () => {
    const [list] = parseMarkdown('- [x] a criterion that runs\n      onto a second line')
    expect(list.type === 'list' && list.items).toHaveLength(1)
    expect(list.type === 'list' && list.items[0].content.map((c) => c.text).join('')).toBe(
      'a criterion that runs onto a second line',
    )
  })

  it('reads a table and drops its separator row', () => {
    const [table] = parseMarkdown('| Mark | Meaning |\n| --- | --- |\n| `[x]` | done |')
    expect(table).toMatchObject({ type: 'table' })
    expect(table.type === 'table' && table.rows).toHaveLength(1)
  })

  it('reads a blockquote', () => {
    const [quote] = parseMarkdown('> a note\n> continued')
    expect(quote).toMatchObject({ type: 'quote' })
  })

  it('reads a horizontal rule', () => {
    expect(parseMarkdown('---')).toEqual([{ type: 'rule' }])
  })

  it('groups wrapped prose into one paragraph', () => {
    const blocks = parseMarkdown('one line\nand another')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
  })

  it('copes with an empty document', () => {
    expect(parseMarkdown('')).toEqual([])
  })
})

describe('the real user stories file', () => {
  const blocks = parseMarkdown(storiesSource)

  it('parses without losing the story headings', () => {
    const headings = blocks.filter(
      (b) => b.type === 'heading' && b.content.some((c) => /US-\d+/.test(c.text)),
    )
    expect(headings.length).toBeGreaterThan(40)
  })

  it('produces no empty blocks', () => {
    for (const block of blocks) {
      if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') {
        expect(block.content.length).toBeGreaterThan(0)
      }
      if (block.type === 'list') expect(block.items.length).toBeGreaterThan(0)
    }
  })

  it('counts acceptance criteria by state', () => {
    const progress = countProgress(blocks)
    expect(progress.total).toBeGreaterThan(150)
    expect(progress.done).toBeGreaterThan(0)
    expect(progress.partial).toBeGreaterThan(0)
    expect(progress.done + progress.partial + progress.todo).toBe(progress.total)
  })

  it('renders the status key table', () => {
    const tables = blocks.filter((b) => b.type === 'table')
    expect(tables.length).toBeGreaterThan(0)
  })
})
