import { describe, expect, it } from 'vitest'
import { generateSlug, isUsableImageUrl } from './data'

describe('US-011: event link slug', () => {
  it('is 10 characters', () => {
    expect(generateSlug()).toHaveLength(10)
  })

  it('avoids characters that are confusable when read aloud or copied by hand', () => {
    const sample = Array.from({ length: 200 }, () => generateSlug()).join('')
    expect(sample).not.toMatch(/[l1IO0]/)
  })

  it('does not repeat itself across many draws', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()))
    expect(slugs.size).toBe(500)
  })
})

describe('US-012: linked images', () => {
  it('accepts http and https addresses', () => {
    expect(isUsableImageUrl('https://example.com/logo.png')).toBe(true)
    expect(isUsableImageUrl('http://example.com/logo.png')).toBe(true)
    expect(isUsableImageUrl('  https://example.com/logo.png  ')).toBe(true)
  })

  it('treats a blank value as no image, so the placeholder shows', () => {
    expect(isUsableImageUrl('')).toBe(false)
    expect(isUsableImageUrl('   ')).toBe(false)
  })

  it('rejects a bare path or hostname, which would not load', () => {
    expect(isUsableImageUrl('logo.png')).toBe(false)
    expect(isUsableImageUrl('example.com/logo.png')).toBe(false)
    expect(isUsableImageUrl('/images/logo.png')).toBe(false)
  })

  it('rejects other schemes rather than putting them in an img tag', () => {
    expect(isUsableImageUrl('javascript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isUsableImageUrl('file:///etc/passwd')).toBe(false)
  })
})
