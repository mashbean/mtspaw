import { describe, expect, it } from 'vitest'

import { fetchGql } from '../../services/gql/index.js'
import { buildArticleCommentsQuery, CHANNEL_QUERY, HOTTEST_QUERY, ICYMI_QUERY, USER_STATE_QUERY } from './index.js'

const API = process.env.MATTERS_API_LIVE ?? 'https://server.matters.town/graphql'

interface GqlEnvelope {
  data?: unknown
  errors?: { message: string }[]
}

const errorMessages = (r: GqlEnvelope): string => (r.errors ?? []).map((e) => e.message).join(' | ')

describe('spam-scan live API (matters.town read endpoints)', () => {
  it('ICYMI_QUERY returns articles with no schema errors', async () => {
    const result = (await fetchGql(API, ICYMI_QUERY, { input: { first: 5 } })) as GqlEnvelope & {
      data?: {
        viewer?: { recommendation?: { icymi?: { edges?: { node: { id: string; shortHash: string } }[] } } }
      }
    }
    expect(errorMessages(result)).toBe('')
    const edges = result.data?.viewer?.recommendation?.icymi?.edges ?? []
    expect(edges.length).toBeGreaterThan(0)
    expect(edges[0].node.id).toBeTruthy()
    expect(edges[0].node.shortHash).toBeTruthy()
  })

  it('HOTTEST_QUERY returns articles with no schema errors', async () => {
    const result = (await fetchGql(API, HOTTEST_QUERY, { input: { first: 5 } })) as GqlEnvelope
    expect(errorMessages(result)).toBe('')
  })

  it('CHANNEL_QUERY against nycmlq5d4w8a accepts the args spam-scan currently sends', async () => {
    const result = (await fetchGql(API, CHANNEL_QUERY, {
      input: { shortHash: 'nycmlq5d4w8a' },
      articlesInput: { first: 5 },
    })) as GqlEnvelope
    expect(errorMessages(result)).toBe('')
  })

  it('article-comments query (no CW) accepts the args spam-scan currently sends', async () => {
    const icymi = (await fetchGql(API, ICYMI_QUERY, { input: { first: 1 } })) as {
      data?: { viewer?: { recommendation?: { icymi?: { edges?: { node: { shortHash: string } }[] } } } }
    }
    const shortHash = icymi.data?.viewer?.recommendation?.icymi?.edges?.[0]?.node?.shortHash
    expect(shortHash).toBeTruthy()

    const result = (await fetchGql(API, buildArticleCommentsQuery(false), {
      input: { shortHash },
      topInput: { first: 5, sort: 'newest', filter: { parentComment: null, state: 'active' } },
      nestedInput: { first: 5, sort: 'newest' },
    })) as GqlEnvelope
    expect(errorMessages(result)).toBe('')
  })

  it('USER_STATE_QUERY returns state for an existing user and null for a missing one', async () => {
    const icymi = (await fetchGql(API, ICYMI_QUERY, { input: { first: 1 } })) as {
      data?: { viewer?: { recommendation?: { icymi?: { edges?: { node: { author: { userName: string } } }[] } } } }
    }
    const userName = icymi.data?.viewer?.recommendation?.icymi?.edges?.[0]?.node?.author?.userName
    expect(userName).toBeTruthy()

    const existing = (await fetchGql(API, USER_STATE_QUERY, { input: { userName } })) as GqlEnvelope & {
      data?: { user?: { status?: { state?: string } } | null }
    }
    expect(errorMessages(existing)).toBe('')
    expect(existing.data?.user?.status?.state).toBeTruthy()
    expect(['active', 'banned', 'archived', 'frozen']).toContain(existing.data?.user?.status?.state)

    const missing = (await fetchGql(API, USER_STATE_QUERY, {
      input: { userName: '__mtspaw_test_userdoesnotexist_zzzzzz__' },
    })) as GqlEnvelope & { data?: { user?: unknown } }
    expect(errorMessages(missing)).toBe('')
    expect(missing.data?.user).toBeNull()
  })
})
