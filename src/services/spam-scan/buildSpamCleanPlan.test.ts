import { describe, expect, it, vi } from 'vitest'

import type { SpamCandidates } from './index.js'
import { buildSpamCleanPlan } from './index.js'

const source: SpamCandidates = {
  generatedAt: '2026-05-23T00:00:00.000Z',
  minArticleSpread: 3,
  candidates: [
    {
      fingerprint: 'spammer:domain:spam.example',
      articleSpread: 3,
      commentCount: 3,
      reason: 'repeated_comment',
      occurrences: [
        {
          articleId: 'Article:a1',
          shortHash: 'sh1',
          title: 'A1',
          commentId: 'Comment:c1',
          author: { userId: 'User:s', userName: 'spammer', displayName: 'Spammer' },
          content: 'spam https://spam.example',
        },
        {
          articleId: 'Article:a2',
          shortHash: 'sh2',
          title: 'A2',
          commentId: 'Comment:c2',
          parentCommentId: 'Comment:p2',
          author: { userId: 'User:s', userName: 'spammer', displayName: 'Spammer' },
          content: 'spam https://spam.example',
        },
      ],
    },
  ],
}

describe('buildSpamCleanPlan', () => {
  it('converts candidates to dry-run community watch clean plan items', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T01:00:00.000Z'))

    const plan = buildSpamCleanPlan(source)

    expect(plan).toMatchObject({
      generatedAt: '2026-05-23T01:00:00.000Z',
      sourceGeneratedAt: source.generatedAt,
      dryRunOnly: true,
    })
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0]).toMatchObject({
      commentId: 'Comment:c1',
      shortHash: 'sh1',
      fingerprint: 'spammer:domain:spam.example',
      reason: 'flood_advertising',
      reasonLabel: '濫發廣告',
    })
    expect(plan.items[1].parentCommentId).toBe('Comment:p2')

    vi.useRealTimers()
  })

  it('deduplicates comment ids across candidates', () => {
    const duplicated: SpamCandidates = {
      ...source,
      candidates: [
        source.candidates[0],
        {
          ...source.candidates[0],
          fingerprint: 'spammer:text:duplicate',
        },
      ],
    }

    expect(buildSpamCleanPlan(duplicated).items).toHaveLength(2)
  })
})
