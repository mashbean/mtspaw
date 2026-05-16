import { describe, expect, it } from 'vitest'

import { stripHtml } from './index.js'

describe('stripHtml', () => {
  it('strips plain tags but preserves text', () => {
    expect(stripHtml('<p>hello <strong>world</strong></p>')).toBe('hello world')
  })

  it('preserves link href in (URL) form after the link text', () => {
    expect(stripHtml('<p>看這裡 <a href="https://example.com">點擊</a> 馬上賺</p>')).toBe(
      '看這裡 點擊 (https://example.com) 馬上賺',
    )
  })

  it('keeps just the URL when link text is empty', () => {
    expect(stripHtml('<a href="https://example.com"></a>')).toBe('https://example.com')
  })

  it('handles attributes in any order', () => {
    const html = '<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">點擊</a>'
    expect(stripHtml(html)).toBe('點擊 (https://example.com)')
  })

  it('strips nested tags inside the link text', () => {
    expect(stripHtml('<a href="https://example.com"><strong>粗體</strong></a>')).toBe('粗體 (https://example.com)')
  })

  it('preserves multiple links in one block', () => {
    const html = '<p><a href="https://a.com">A</a> 跟 <a href="https://b.com">B</a></p>'
    expect(stripHtml(html)).toBe('A (https://a.com) 跟 B (https://b.com)')
  })

  it('handles single-quoted href', () => {
    expect(stripHtml("<a href='https://example.com'>x</a>")).toBe('x (https://example.com)')
  })
})
