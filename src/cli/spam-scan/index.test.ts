import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(() => ({ mattersApi: 'https://api.test' })),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
vi.mock('../../services/gql/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/gql/index.js')>('../../services/gql/index.js')
  return {
    ...actual,
    fetchGql: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
  }
})
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}))
vi.mock('node:fs', () => {
  const store = new Map<string, string>()
  return {
    default: {
      existsSync: vi.fn((p: string) => store.has(p)),
      readFileSync: vi.fn((p: string) => {
        const v = store.get(p)
        if (v === undefined) {
          throw new Error(`ENOENT: ${p}`)
        }
        return v
      }),
      writeFileSync: vi.fn((p: string, data: string) => {
        store.set(p, data)
      }),
      __store: store,
    },
  }
})

import { input } from '@inquirer/prompts'

import { fetchGqlWithAuthRetry, readEnvJson } from '../../services/auth/index.js'
import { delay, fetchGql } from '../../services/gql/index.js'
import { spamScanCommand } from './index.js'

interface FsMockShape {
  default: typeof fs & { __store: Map<string, string> }
}

const fsStore = (fs as unknown as FsMockShape['default']).__store

const channelsPath = `${process.cwd()}/spam-scan-channels.json`
const statePath = `${process.cwd()}/spam-scan-state.json`
const pendingPath = `${process.cwd()}/spam-pending.json`
const candidatesPath = `${process.cwd()}/spam-candidates.json`
const cleanPlanPath = `${process.cwd()}/spam-clean-plan.json`
const cleanResultPath = `${process.cwd()}/spam-clean-result.json`
const spammersPath = `${process.cwd()}/spammers.json`

const setFile = (p: string, value: unknown) => {
  fsStore.set(p, JSON.stringify(value))
}

const readFile = (p: string): unknown => {
  const v = fsStore.get(p)
  if (v === undefined) {
    return null
  }
  return JSON.parse(v)
}

describe('spam-scan query command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('exits when no feeds configured', async () => {
    setFile(channelsPath, { feeds: [] })
    await expect(spamScanCommand.parseAsync(['query'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('No feeds configured in spam-scan-channels.json')
  })

  it('falls back without communityWatchAction when server rejects the field', async () => {
    setFile(channelsPath, { feeds: [{ type: 'icymi' }] })

    vi.mocked(fetchGqlWithAuthRetry)
      .mockResolvedValueOnce({
        result: {
          data: {
            viewer: {
              recommendation: {
                icymi: {
                  edges: [
                    {
                      node: {
                        id: 'Article:a1',
                        shortHash: 'ah1',
                        title: 'A1',
                        state: 'active',
                        author: {
                          id: 'User:u1',
                          userName: 'alice',
                          displayName: 'Alice',
                        },
                        contents: { html: '<p>body</p>' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        result: {
          errors: [
            {
              message: 'Cannot query field "communityWatchAction" on type "Comment"',
            },
          ],
        },
        errorMessage: 'Cannot query field "communityWatchAction" on type "Comment"',
      })
      .mockResolvedValueOnce({
        result: {
          data: {
            article: {
              comments: {
                edges: [
                  {
                    node: {
                      id: 'Comment:c1',
                      state: 'active',
                      content: '<p>hello</p>',
                      createdAt: '2026-05-15T11:00:00.000Z',
                      author: {
                        id: 'User:u2',
                        userName: 'bob',
                        displayName: 'Bob',
                      },
                      comments: { edges: [] },
                    },
                  },
                ],
              },
            },
          },
        },
        errorMessage: null,
      })

    await spamScanCommand.parseAsync(['query'], { from: 'user' })

    const calls = vi.mocked(fetchGqlWithAuthRetry).mock.calls
    expect(calls[1][2]).toContain('communityWatchAction')
    expect(calls[2][2]).not.toContain('communityWatchAction')

    const pending = readFile(pendingPath) as {
      articles: { articleId: string; comments: { content: string }[] }[]
    }
    expect(pending.articles).toHaveLength(1)
    expect(pending.articles[0].articleId).toBe('Article:a1')
    expect(pending.articles[0].comments[0].content).toBe('hello')
  })

  it('skips articles flagged spam and reuses state lastScannedAt cutoff for non-spam', async () => {
    setFile(channelsPath, { feeds: [{ type: 'icymi' }] })
    setFile(statePath, {
      articles: [
        {
          articleId: 'Article:spam',
          shortHash: 'sh',
          lastScannedAt: '2026-05-15T10:00:00.000Z',
          spam: true,
        },
        {
          articleId: 'Article:keep',
          shortHash: 'kh',
          lastScannedAt: '2026-05-15T10:00:00.000Z',
          spam: false,
        },
      ],
    })

    vi.mocked(fetchGqlWithAuthRetry)
      .mockResolvedValueOnce({
        result: {
          data: {
            viewer: {
              recommendation: {
                icymi: {
                  edges: [
                    {
                      node: {
                        id: 'Article:spam',
                        shortHash: 'sh',
                        title: 'spam',
                        state: 'active',
                        author: {
                          id: 'User:u1',
                          userName: 'alice',
                          displayName: 'Alice',
                        },
                        contents: { html: '' },
                      },
                    },
                    {
                      node: {
                        id: 'Article:keep',
                        shortHash: 'kh',
                        title: 'keep',
                        state: 'active',
                        author: {
                          id: 'User:u2',
                          userName: 'bob',
                          displayName: 'Bob',
                        },
                        contents: { html: '' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        result: {
          data: {
            article: {
              comments: {
                edges: [
                  {
                    node: {
                      id: 'Comment:old',
                      state: 'active',
                      content: '<p>old comment text</p>',
                      createdAt: '2026-05-15T09:00:00.000Z',
                      author: {
                        id: 'User:x',
                        userName: 'eve',
                        displayName: 'Eve',
                      },
                      communityWatchAction: null,
                      comments: { edges: [] },
                    },
                  },
                  {
                    node: {
                      id: 'Comment:new',
                      state: 'active',
                      content: '<p>new comment text</p>',
                      createdAt: '2026-05-15T11:00:00.000Z',
                      author: {
                        id: 'User:y',
                        userName: 'mallory',
                        displayName: 'Mallory',
                      },
                      communityWatchAction: null,
                      comments: { edges: [] },
                    },
                  },
                ],
              },
            },
          },
        },
        errorMessage: null,
      })

    await spamScanCommand.parseAsync(['query'], { from: 'user' })

    expect(vi.mocked(fetchGqlWithAuthRetry).mock.calls).toHaveLength(2)

    const pending = readFile(pendingPath) as {
      articles: {
        articleId: string
        needsArticleJudgement: boolean
        content?: string
        comments: { commentId: string }[]
      }[]
    }
    expect(pending.articles).toHaveLength(1)
    const kept = pending.articles[0]
    expect(kept.articleId).toBe('Article:keep')
    expect(kept.needsArticleJudgement).toBe(false)
    expect(kept.content).toBeUndefined()
    expect(kept.comments.map((c) => c.commentId)).toEqual(['Comment:new'])
  })

  it('--dry-run fetches but does not write spam-pending.json', async () => {
    setFile(channelsPath, { feeds: [{ type: 'icymi' }] })

    vi.mocked(fetchGqlWithAuthRetry)
      .mockResolvedValueOnce({
        result: {
          data: {
            viewer: {
              recommendation: {
                icymi: {
                  edges: [
                    {
                      node: {
                        id: 'Article:a1',
                        shortHash: 'ah1',
                        title: 'A1 title',
                        state: 'active',
                        author: {
                          id: 'User:u1',
                          userName: 'alice',
                          displayName: 'Alice',
                        },
                        contents: { html: '<p>body</p>' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        result: {
          data: {
            article: {
              comments: {
                edges: [
                  {
                    node: {
                      id: 'Comment:c1',
                      state: 'active',
                      content: '<p>hi there reader</p>',
                      createdAt: '2026-05-15T11:00:00.000Z',
                      author: {
                        id: 'User:u2',
                        userName: 'bob',
                        displayName: 'Bob',
                      },
                      communityWatchAction: null,
                      comments: { edges: [] },
                    },
                  },
                ],
              },
            },
          },
        },
        errorMessage: null,
      })

    await spamScanCommand.parseAsync(['query', '--dry-run'], { from: 'user' })

    expect(fsStore.has(pendingPath)).toBe(false)
    const logged = vi.mocked(console.log).mock.calls.map((c) => c[0] as string)
    expect(logged).toContain('--- spam-scan query dry-run (no write) ---')
    expect(logged.some((l) => l.includes('would enqueue: 1 articles'))).toBe(true)
    expect(logged.some((l) => l.includes('Article:a1') && l.includes('shortHash=ah1'))).toBe(true)
  })
})

describe('spam-scan cluster command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes spam-candidates.json with repeated comment clusters', async () => {
    setFile(pendingPath, {
      articles: [1, 2, 3].map((n) => ({
        articleId: `Article:a${n}`,
        shortHash: `sh${n}`,
        title: `Article ${n}`,
        needsArticleJudgement: false,
        author: {
          userId: `User:a${n}`,
          userName: `author${n}`,
          displayName: `Author ${n}`,
        },
        comments: [
          {
            commentId: `Comment:c${n}`,
            content: '重複廣告請看 https://spam.example/path',
            author: {
              userId: 'User:s',
              userName: 'spammer',
              displayName: 'Spammer',
            },
            depth: 'top',
            communityWatchAction: null,
          },
        ],
      })),
    })

    await spamScanCommand.parseAsync(['cluster'], { from: 'user' })

    const candidates = readFile(candidatesPath) as {
      candidates: {
        fingerprint: string
        articleSpread: number
        commentCount: number
      }[]
    }
    expect(candidates.candidates).toHaveLength(1)
    expect(candidates.candidates[0]).toMatchObject({
      fingerprint: 'spammer:domain:spam.example',
      articleSpread: 3,
      commentCount: 3,
    })
  })

  it('does not write candidates in dry-run mode', async () => {
    setFile(pendingPath, { articles: [] })

    await spamScanCommand.parseAsync(['cluster', '--dry-run'], {
      from: 'user',
    })

    expect(readFile(candidatesPath)).toBeNull()
  })

  it('rejects article spread below 2', async () => {
    await expect(
      spamScanCommand.parseAsync(['cluster', '--minArticleSpread', '1'], {
        from: 'user',
      }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('--minArticleSpread must be an integer >= 2')
  })
})

describe('spam-scan plan-clean command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T01:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes a dry-run clean plan from spam-candidates.json', async () => {
    setFile(candidatesPath, {
      generatedAt: '2026-05-23T00:00:00.000Z',
      minArticleSpread: 3,
      candidates: [
        {
          fingerprint: 'spammer:domain:spam.example',
          articleSpread: 3,
          commentCount: 1,
          reason: 'repeated_comment',
          occurrences: [
            {
              articleId: 'Article:a1',
              shortHash: 'sh1',
              title: 'Article 1',
              commentId: 'Comment:c1',
              author: {
                userId: 'User:s',
                userName: 'spammer',
                displayName: 'Spammer',
              },
              content: 'spam https://spam.example',
            },
          ],
        },
      ],
    })

    await spamScanCommand.parseAsync(['plan-clean'], { from: 'user' })

    const plan = readFile(cleanPlanPath) as {
      dryRunOnly: boolean
      items: { commentId: string; reasonLabel: string; shortHash: string }[]
    }
    expect(plan.dryRunOnly).toBe(true)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      commentId: 'Comment:c1',
      reasonLabel: '濫發廣告',
      shortHash: 'sh1',
    })
  })
})

describe('spam-scan submit-clean command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T02:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const seedCleanPlan = () => {
    setFile(cleanPlanPath, {
      generatedAt: '2026-05-23T01:00:00.000Z',
      sourceGeneratedAt: '2026-05-23T00:00:00.000Z',
      dryRunOnly: true,
      items: [
        {
          commentId: 'Comment:c1',
          articleId: 'Article:a1',
          shortHash: 'sh1',
          title: 'Article 1',
          author: {
            userId: 'User:s',
            userName: 'spammer',
            displayName: 'Spammer',
          },
          content: 'spam https://spam.example',
          fingerprint: 'spammer:domain:spam.example',
          reason: 'flood_advertising',
          reasonLabel: '濫發廣告',
        },
      ],
    })
  }

  it('writes a dry-run result without calling the API by default', async () => {
    seedCleanPlan()

    await spamScanCommand.parseAsync(['submit-clean'], { from: 'user' })

    expect(fetchGqlWithAuthRetry).not.toHaveBeenCalled()
    const result = readFile(cleanResultPath) as {
      execute: boolean
      dryRun: number
      items: { commentId: string; status: string }[]
    }
    expect(result.execute).toBe(false)
    expect(result.dryRun).toBe(1)
    expect(result.items[0]).toMatchObject({
      commentId: 'Comment:c1',
      status: 'dry_run',
    })
  })

  it('submits planned comments with communityWatchRemoveComment when executed', async () => {
    seedCleanPlan()
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: {
        data: {
          communityWatchRemoveComment: {
            id: 'Comment:c1',
            state: 'banned',
            communityWatchAction: {
              uuid: 'cw-1',
              createdAt: '2026-05-23T02:00:00.000Z',
            },
          },
        },
      },
      errorMessage: null,
    })

    await spamScanCommand.parseAsync(['submit-clean', '--execute'], {
      from: 'user',
    })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledTimes(1)
    const call = vi.mocked(fetchGqlWithAuthRetry).mock.calls[0]
    expect(call[2]).toContain('communityWatchRemoveComment')
    expect(call[3]).toEqual({ input: { id: 'Comment:c1', reason: 'spam_ad' } })
    const result = readFile(cleanResultPath) as {
      execute: boolean
      removed: number
      items: { commentId: string; status: string; uuid: string }[]
    }
    expect(result.execute).toBe(true)
    expect(result.removed).toBe(1)
    expect(result.items[0]).toMatchObject({
      commentId: 'Comment:c1',
      status: 'removed',
      uuid: 'cw-1',
    })
  })

  it('writes failures and exits non-zero when any mutation fails', async () => {
    seedCleanPlan()
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: {
        errors: [{ message: 'viewer is not a Community Watch member' }],
      },
      errorMessage: 'viewer is not a Community Watch member',
    })

    await expect(
      spamScanCommand.parseAsync(['submit-clean', '--execute'], {
        from: 'user',
      }),
    ).rejects.toThrow('process.exit')

    const result = readFile(cleanResultPath) as {
      failed: number
      items: { status: string; error: string }[]
    }
    expect(result.failed).toBe(1)
    expect(result.items[0]).toMatchObject({
      status: 'failed',
      error: 'viewer is not a Community Watch member',
    })
  })

  it('respects --limit and delays between executed mutations', async () => {
    seedCleanPlan()
    const plan = readFile(cleanPlanPath) as { items: unknown[] }
    setFile(cleanPlanPath, {
      ...plan,
      items: [...plan.items, { ...(plan.items[0] as object), commentId: 'Comment:c2' }],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValue({
      result: {
        data: {
          communityWatchRemoveComment: {
            id: 'Comment:c1',
            state: 'banned',
            communityWatchAction: null,
          },
        },
      },
      errorMessage: null,
    })

    await spamScanCommand.parseAsync(['submit-clean', '--execute', '--limit', '2', '--intervalMs', '250'], {
      from: 'user',
    })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledWith(250)
  })
})

describe('spam-scan record command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates a new spammer entry on first occurrence', async () => {
    await spamScanCommand.parseAsync(
      [
        'record',
        '--userName',
        'alice',
        '--displayName',
        'Alice',
        '--type',
        'comment',
        '--contentId',
        'Comment:c1',
        '--shortHash',
        'sh1',
      ],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as {
      users: Record<string, { occurrences: unknown[]; reported: boolean }>
    }
    expect(data.users.alice.occurrences).toHaveLength(1)
    expect(data.users.alice.reported).toBe(false)
  })

  it('rotates occurrences when more than 10 are recorded', async () => {
    const existingOccs = Array.from({ length: 10 }, (_, i) => ({
      type: 'comment',
      contentId: `Comment:c${i}`,
      shortHash: `sh${i}`,
      foundAt: `2026-05-01T0${i}:00:00.000Z`,
    }))
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'Alice',
          firstSeenAt: '2026-05-01T00:00:00.000Z',
          lastSeenAt: '2026-05-01T09:00:00.000Z',
          occurrences: existingOccs,
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(
      ['record', '--userName', 'alice', '--type', 'comment', '--contentId', 'Comment:newest', '--shortHash', 'shN'],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as {
      users: Record<string, { occurrences: { contentId: string }[] }>
    }
    const occs = data.users.alice.occurrences
    expect(occs).toHaveLength(10)
    expect(occs[occs.length - 1].contentId).toBe('Comment:newest')
    expect(occs[0].contentId).toBe('Comment:c1')
  })

  it('rejects an unknown --type', async () => {
    await expect(
      spamScanCommand.parseAsync(
        ['record', '--userName', 'alice', '--type', 'bogus', '--contentId', 'x', '--shortHash', 'h'],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('--type must be article or comment')
  })

  it('flips reported back to false when adding a new occurrence to a previously reported user', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'Alice',
          firstSeenAt: '2026-05-01T00:00:00.000Z',
          lastSeenAt: '2026-05-01T00:00:00.000Z',
          occurrences: [],
          reported: true,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(
      ['record', '--userName', 'alice', '--type', 'comment', '--contentId', 'Comment:new', '--shortHash', 'shN'],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(false)
  })

  it('rotates roster by LRU when a new user pushes count over USERS_CAP', async () => {
    const existing: Record<string, unknown> = {}
    for (let i = 0; i < 100; i += 1) {
      existing[`user${String(i).padStart(3, '0')}`] = {
        displayName: '',
        firstSeenAt: '2026-05-01T00:00:00.000Z',
        lastSeenAt: `2026-05-01T${String(i).padStart(2, '0')}:00:00.000Z`,
        occurrences: [],
        reported: false,
        communityWatchHistory: {
          seen: false,
          lastUuid: null,
          lastSeenAt: null,
        },
      }
    }
    setFile(spammersPath, { users: existing })

    await spamScanCommand.parseAsync(
      ['record', '--userName', 'newcomer', '--type', 'comment', '--contentId', 'Comment:n', '--shortHash', 'shN'],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as { users: Record<string, unknown> }
    const names = Object.keys(data.users)
    expect(names).toHaveLength(100)
    expect(names).toContain('newcomer')
    expect(names).not.toContain('user000')
    expect(names).toContain('user099')
  })

  it('does not rotate when adding a new user keeps count at or below USERS_CAP', async () => {
    setFile(spammersPath, { users: {} })
    await spamScanCommand.parseAsync(
      ['record', '--userName', 'first', '--type', 'comment', '--contentId', 'x', '--shortHash', 'h'],
      { from: 'user' },
    )
    const data = readFile(spammersPath) as { users: Record<string, unknown> }
    expect(Object.keys(data.users)).toEqual(['first'])
  })

  it('persists --parentCommentId on a reply comment occurrence', async () => {
    await spamScanCommand.parseAsync(
      [
        'record',
        '--userName',
        'alice',
        '--type',
        'comment',
        '--contentId',
        'Comment:r1',
        '--shortHash',
        'sh1',
        '--parentCommentId',
        'Comment:p1',
      ],
      { from: 'user' },
    )
    const data = readFile(spammersPath) as {
      users: Record<string, { occurrences: { parentCommentId?: string }[] }>
    }
    expect(data.users.alice.occurrences[0].parentCommentId).toBe('Comment:p1')
  })

  it('ignores --parentCommentId when --type is article', async () => {
    await spamScanCommand.parseAsync(
      [
        'record',
        '--userName',
        'alice',
        '--type',
        'article',
        '--contentId',
        'Article:a1',
        '--shortHash',
        'sh1',
        '--parentCommentId',
        'Comment:p1',
      ],
      { from: 'user' },
    )
    const data = readFile(spammersPath) as {
      users: Record<string, { occurrences: { parentCommentId?: string }[] }>
    }
    expect(data.users.alice.occurrences[0].parentCommentId).toBeUndefined()
  })
})

describe('spam-scan mark-scanned command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('inserts a fresh entry with spam=false by default', async () => {
    await spamScanCommand.parseAsync(['mark-scanned', '--articleId', 'Article:a1', '--shortHash', 'sh1'], {
      from: 'user',
    })

    const data = readFile(statePath) as {
      articles: { articleId: string; shortHash: string; spam: boolean }[]
    }
    expect(data.articles).toEqual([
      {
        articleId: 'Article:a1',
        shortHash: 'sh1',
        lastScannedAt: '2026-05-15T12:00:00.000Z',
        spam: false,
      },
    ])
  })

  it('upserts existing entries and flips spam when --spam is supplied', async () => {
    setFile(statePath, {
      articles: [
        {
          articleId: 'Article:a1',
          shortHash: 'sh-old',
          lastScannedAt: '2026-05-10T00:00:00.000Z',
          spam: false,
        },
      ],
    })

    await spamScanCommand.parseAsync(['mark-scanned', '--articleId', 'Article:a1', '--shortHash', 'sh-new', '--spam'], {
      from: 'user',
    })

    const data = readFile(statePath) as {
      articles: {
        articleId: string
        shortHash: string
        spam: boolean
        lastScannedAt: string
      }[]
    }
    expect(data.articles).toHaveLength(1)
    expect(data.articles[0]).toEqual({
      articleId: 'Article:a1',
      shortHash: 'sh-new',
      lastScannedAt: '2026-05-15T12:00:00.000Z',
      spam: true,
    })
  })

  it('prunes entries older than 7 days on write', async () => {
    setFile(statePath, {
      articles: [
        {
          articleId: 'Article:old',
          shortHash: 'sho',
          lastScannedAt: '2026-05-01T00:00:00.000Z',
          spam: false,
        },
        {
          articleId: 'Article:keep',
          shortHash: 'shk',
          lastScannedAt: '2026-05-10T00:00:00.000Z',
          spam: false,
        },
      ],
    })

    await spamScanCommand.parseAsync(['mark-scanned', '--articleId', 'Article:new', '--shortHash', 'shn'], {
      from: 'user',
    })

    const data = readFile(statePath) as { articles: { articleId: string }[] }
    const ids = data.articles.map((a) => a.articleId).sort()
    expect(ids).toEqual(['Article:keep', 'Article:new'])
  })

  it('aborts when --shortHash is missing', async () => {
    await expect(
      spamScanCommand.parseAsync(['mark-scanned', '--articleId', 'Article:a1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('--shortHash is required')
  })
})

describe('spam-scan note-cw command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a no-op when the user is not in the roster', async () => {
    setFile(spammersPath, { users: {} })

    await spamScanCommand.parseAsync(
      ['note-cw', '--userName', 'ghost', '--uuid', 'u-1', '--createdAt', '2026-05-15T12:00:00.000Z'],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as { users: Record<string, unknown> }
    expect(data.users).toEqual({})
    expect(console.log).toHaveBeenCalledWith('note-cw: ghost not in roster, no-op')
  })

  it('updates communityWatchHistory on an existing user', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'Alice',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-10T00:00:00.000Z',
          occurrences: [],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(
      ['note-cw', '--userName', 'alice', '--uuid', 'u-42', '--createdAt', '2026-05-15T11:00:00.000Z'],
      { from: 'user' },
    )

    const data = readFile(spammersPath) as {
      users: Record<
        string,
        {
          communityWatchHistory: {
            seen: boolean
            lastUuid: string | null
            lastSeenAt: string | null
          }
        }
      >
    }
    expect(data.users.alice.communityWatchHistory).toEqual({
      seen: true,
      lastUuid: 'u-42',
      lastSeenAt: '2026-05-15T11:00:00.000Z',
    })
  })
})

describe('spam-scan list-unreported command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the empty marker when no unreported entries exist', async () => {
    setFile(spammersPath, { users: {} })

    await spamScanCommand.parseAsync(['list-unreported'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith('No unreported spammers.')
  })

  it('emits header, summary, CW annotation, and occurrence lines for each unreported user', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'Alice',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [
            {
              type: 'comment',
              contentId: 'Comment:c1',
              shortHash: 'sh1',
              foundAt: '2026-05-15T00:00:00.000Z',
            },
          ],
          reported: false,
          communityWatchHistory: {
            seen: true,
            lastUuid: 'u-1',
            lastSeenAt: '2026-05-15T10:00:00.000Z',
          },
        },
        skipme: {
          displayName: 'Skipped',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [],
          reported: true,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(['list-unreported'], { from: 'user' })

    expect(vi.mocked(console.log).mock.calls).toHaveLength(1)
    const out = vi.mocked(console.log).mock.calls[0][0] as string
    expect(out).toContain('<https://matters.town/@alice|@alice> (Alice)')
    expect(out).toContain('Spam 次數: 1  守望相助檢舉過')
    expect(out).toContain('05-15 08:00  評論  <https://matters.town/a/sh1#Comment:c1|Comment:c1>')
    expect(out).not.toContain('@skipme')
    expect(out).not.toContain('first:')
    expect(out).not.toContain('last:')
  })

  it('renders reply occurrences with parentCommentId in the URL fragment', async () => {
    setFile(spammersPath, {
      users: {
        bob: {
          displayName: 'Bob',
          firstSeenAt: '2026-05-15T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [
            {
              type: 'comment',
              contentId: 'Comment:r1',
              shortHash: 'sh1',
              foundAt: '2026-05-15T00:00:00.000Z',
              parentCommentId: 'Comment:p1',
            },
          ],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(['list-unreported'], { from: 'user' })

    const out = vi.mocked(console.log).mock.calls[0][0] as string
    expect(out).toContain('https://matters.town/a/sh1#Comment:p1-Comment:r1|Comment:r1')
  })

  it('shows "10+" for Spam 次數 when occurrences hit the rotation cap', async () => {
    setFile(spammersPath, {
      users: {
        capped: {
          displayName: 'Capped',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: Array.from({ length: 10 }, (_, i) => ({
            type: 'comment',
            contentId: `Comment:c${i}`,
            shortHash: 'sh',
            foundAt: `2026-05-1${i % 5}T00:00:00.000Z`,
          })),
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(['list-unreported'], { from: 'user' })

    const out = vi.mocked(console.log).mock.calls[0][0] as string
    expect(out).toContain('Spam 次數: 10+')
  })
})

describe('spam-scan mark-reported command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flips reported on a single user resolved from --userName', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'A',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(['mark-reported', '--userName', 'alice'], {
      from: 'user',
    })

    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(true)
  })

  it('prompts for userName when --userName is omitted and --all is not set', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'A',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })
    vi.mocked(input).mockResolvedValueOnce('alice')

    await spamScanCommand.parseAsync(['mark-reported'], { from: 'user' })

    expect(input).toHaveBeenCalled()
    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(true)
  })

  it('flips every unreported entry when --all is given and skips already-reported ones', async () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'A',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
        bob: {
          displayName: 'B',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
        carol: {
          displayName: 'C',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: true,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })

    await spamScanCommand.parseAsync(['mark-reported', '--all'], {
      from: 'user',
    })

    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(true)
    expect(data.users.bob.reported).toBe(true)
    expect(data.users.carol.reported).toBe(true)
    expect(console.log).toHaveBeenCalledWith('mark-reported: flipped 2 entries')
  })

  it('exits when a named user does not exist', async () => {
    setFile(spammersPath, { users: {} })

    await expect(
      spamScanCommand.parseAsync(['mark-reported', '--userName', 'ghost'], {
        from: 'user',
      }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('user not found: ghost')
  })
})

describe('spam-scan report command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const seedUnreported = () => {
    setFile(spammersPath, {
      users: {
        alice: {
          displayName: 'Alice',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [
            {
              type: 'comment',
              contentId: 'Comment:c1',
              shortHash: 'sh1',
              foundAt: '2026-05-15T00:00:00.000Z',
            },
          ],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
        bob: {
          displayName: 'Bob',
          firstSeenAt: '2026-05-12T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [],
          reported: true,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        },
      },
    })
  }

  it('aborts when slack.token is missing', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({
      mattersApi: 'https://api.test',
      slack: { channel: '#x' },
    })
    seedUnreported()

    await expect(spamScanCommand.parseAsync(['report'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('slack.token is required in env.json')
  })

  it('aborts when slack.channel is missing', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({
      mattersApi: 'https://api.test',
      slack: { token: 'xoxb-1' },
    })
    seedUnreported()

    await expect(spamScanCommand.parseAsync(['report'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('slack.channel is required in env.json')
  })

  it('skips fetch and write when there are no unreported entries', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({
      mattersApi: 'https://api.test',
      slack: { token: 'xoxb-1', channel: '#x' },
    })
    setFile(spammersPath, { users: {} })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await spamScanCommand.parseAsync(['report'], { from: 'user' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('no unreported spammers, skipped')
  })

  it('posts to chat.postMessage and flips reported on every included user', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({
      mattersApi: 'https://api.test',
      slack: { token: 'xoxb-1', channel: 'C123' },
    })
    seedUnreported()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await spamScanCommand.parseAsync(['report'], { from: 'user' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer xoxb-1')
    const body = JSON.parse(init.body as string) as {
      channel: string
      text: string
    }
    expect(body.channel).toBe('C123')
    expect(body.text).toContain('<https://matters.town/@alice|@alice> (Alice)')
    expect(body.text).not.toContain('@bob')

    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(true)
    expect(data.users.bob.reported).toBe(true)
  })

  it('exits 1 and leaves spammers.json untouched when Slack responds ok:false', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({
      mattersApi: 'https://api.test',
      slack: { token: 'xoxb-1', channel: 'C123' },
    })
    seedUnreported()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(spamScanCommand.parseAsync(['report'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('slack send failed: channel_not_found')

    const data = readFile(spammersPath) as {
      users: Record<string, { reported: boolean }>
    }
    expect(data.users.alice.reported).toBe(false)
  })
})

describe('spam-scan cleanup command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeUser = () => ({
    displayName: 'X',
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    occurrences: [],
    reported: false,
    communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
  })

  it('removes archived, banned, and missing users; keeps active and frozen', async () => {
    setFile(spammersPath, {
      users: {
        alice: makeUser(),
        bob: makeUser(),
        carol: makeUser(),
        dave: makeUser(),
        eve: makeUser(),
      },
    })

    vi.mocked(fetchGql)
      .mockResolvedValueOnce({
        data: { user: { status: { state: 'active' } } },
      })
      .mockResolvedValueOnce({
        data: { user: { status: { state: 'archived' } } },
      })
      .mockResolvedValueOnce({
        data: { user: { status: { state: 'banned' } } },
      })
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({
        data: { user: { status: { state: 'frozen' } } },
      })

    await spamScanCommand.parseAsync(['cleanup'], { from: 'user' })

    const data = readFile(spammersPath) as { users: Record<string, unknown> }
    expect(Object.keys(data.users).sort()).toEqual(['alice', 'eve'])
    expect(console.log).toHaveBeenCalledWith(
      'cleanup: kept 2, removed 3 (archived: 1, banned: 1, missing: 1), errors: 0',
    )
  })

  it('keeps user when GraphQL returns errors', async () => {
    setFile(spammersPath, { users: { alice: makeUser() } })

    vi.mocked(fetchGql).mockResolvedValueOnce({
      errors: [{ message: 'transient' }],
    })

    await spamScanCommand.parseAsync(['cleanup'], { from: 'user' })

    const data = readFile(spammersPath) as { users: Record<string, unknown> }
    expect(Object.keys(data.users)).toEqual(['alice'])
    expect(console.error).toHaveBeenCalledWith('cleanup: @alice lookup failed: transient')
  })

  it('delays 1 second between lookups but not before the first', async () => {
    setFile(spammersPath, {
      users: {
        alice: makeUser(),
        bob: makeUser(),
        carol: makeUser(),
      },
    })

    vi.mocked(fetchGql).mockResolvedValue({
      data: { user: { status: { state: 'active' } } },
    })

    await spamScanCommand.parseAsync(['cleanup'], { from: 'user' })

    expect(vi.mocked(delay).mock.calls).toEqual([[1000], [1000]])
  })

  it('exits silently when roster is empty', async () => {
    setFile(spammersPath, { users: {} })

    await spamScanCommand.parseAsync(['cleanup'], { from: 'user' })

    expect(fetchGql).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('cleanup: roster is empty, nothing to check')
  })
})
