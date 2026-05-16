import { describe, expect, it } from 'vitest'

import { isCommentBenign } from './index.js'

describe('isCommentBenign', () => {
  it('returns true for empty or whitespace-only content', () => {
    expect(isCommentBenign('')).toBe(true)
    expect(isCommentBenign('   \n  ')).toBe(true)
  })

  it('returns true for short text below the meaningful length threshold', () => {
    expect(isCommentBenign('+1')).toBe(true)
    expect(isCommentBenign('好')).toBe(true)
    expect(isCommentBenign('好啊')).toBe(true)
  })

  it('returns true for emoji-only content', () => {
    expect(isCommentBenign('👍')).toBe(true)
    expect(isCommentBenign('🔥🔥🔥🔥🔥')).toBe(true)
  })

  it('returns true for pure punctuation', () => {
    expect(isCommentBenign('????')).toBe(true)
    expect(isCommentBenign('!!!')).toBe(true)
  })

  it('returns false when content contains a URL even if short', () => {
    expect(isCommentBenign('https://spam.com')).toBe(false)
    expect(isCommentBenign('x http://a.co')).toBe(false)
  })

  it('returns false for substantial Chinese text', () => {
    expect(isCommentBenign('謝謝分享！')).toBe(false)
    expect(isCommentBenign('很有道理啊')).toBe(false)
  })

  it('returns false for substantial English text', () => {
    expect(isCommentBenign('thanks for sharing')).toBe(false)
  })

  it('returns false for mixed emoji + CJK', () => {
    expect(isCommentBenign('很棒💪🏻 真的很棒')).toBe(false)
  })

  it('returns false for short content containing alphanumeric if length ≥ 5', () => {
    expect(isCommentBenign('hello')).toBe(false)
  })
})
