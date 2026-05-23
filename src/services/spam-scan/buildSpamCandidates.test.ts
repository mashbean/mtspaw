import { describe, expect, it, vi } from 'vitest'

import type { SpamPending } from './index.js'
import { buildSpamCandidates } from './index.js'

const author = { userId: 'User:1', userName: 'spammer', displayName: 'Spammer' }

const makePending = (): SpamPending => ({
  articles: ['a1', 'a2', 'a3'].map((id, i) => ({
    articleId: `Article:${id}`,
    shortHash: `sh${i + 1}`,
    title: `Article ${i + 1}`,
    needsArticleJudgement: false,
    author: { userId: `User:a${i}`, userName: `author${i}`, displayName: `Author ${i}` },
    comments: [
      {
        commentId: `Comment:c${i + 1}`,
        content: '加 line abc888 看更多 https://spam.example/path',
        author,
        depth: 'top',
        communityWatchAction: null,
      },
    ],
  })),
})

describe('buildSpamCandidates', () => {
  it('groups repeated comment signals across at least three articles', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))

    const result = buildSpamCandidates(makePending(), 3)

    expect(result.generatedAt).toBe('2026-05-23T00:00:00.000Z')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      fingerprint: 'spammer:domain:spam.example',
      articleSpread: 3,
      commentCount: 3,
      reason: 'repeated_comment',
    })
    expect(result.candidates[0].occurrences.map((o) => o.commentId)).toEqual(['Comment:c1', 'Comment:c2', 'Comment:c3'])

    vi.useRealTimers()
  })

  it('does not include comments already handled by community watch', () => {
    const pending = makePending()
    pending.articles[2].comments[0].communityWatchAction = {
      uuid: 'cw-1',
      createdAt: '2026-05-23T00:00:00.000Z',
    }

    const result = buildSpamCandidates(pending, 3)

    expect(result.candidates).toHaveLength(0)
  })

  it('does not cluster repeated first-party article links as spam domains', () => {
    const pending = makePending()
    for (const article of pending.articles) {
      article.comments[0].content = '正常留言，延伸閱讀 https://matters.town/a/example'
    }

    const result = buildSpamCandidates(pending, 3)

    expect(result.candidates).toHaveLength(0)
  })
})
