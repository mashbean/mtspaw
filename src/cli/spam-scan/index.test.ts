import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(() => ({ mattersApi: 'https://api.test' })),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
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
import { spamScanCommand } from './index.js'

interface FsMockShape {
  default: typeof fs & { __store: Map<string, string> }
}

const fsStore = (fs as unknown as FsMockShape['default']).__store

const channelsPath = `${process.cwd()}/spam-scan-channels.json`
const statePath = `${process.cwd()}/spam-scan-state.json`
const pendingPath = `${process.cwd()}/spam-pending.json`
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
                        author: { id: 'User:u1', userName: 'alice', displayName: 'Alice' },
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
        result: { errors: [{ message: 'Cannot query field "communityWatchAction" on type "Comment"' }] },
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
                      author: { id: 'User:u2', userName: 'bob', displayName: 'Bob' },
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

    const pending = readFile(pendingPath) as { articles: { articleId: string; comments: { content: string }[] }[] }
    expect(pending.articles).toHaveLength(1)
    expect(pending.articles[0].articleId).toBe('Article:a1')
    expect(pending.articles[0].comments[0].content).toBe('hello')
  })

  it('skips articles flagged spam and reuses state lastScannedAt cutoff for non-spam', async () => {
    setFile(channelsPath, { feeds: [{ type: 'icymi' }] })
    setFile(statePath, {
      articles: [
        { articleId: 'Article:spam', shortHash: 'sh', lastScannedAt: '2026-05-15T10:00:00.000Z', spam: true },
        { articleId: 'Article:keep', shortHash: 'kh', lastScannedAt: '2026-05-15T10:00:00.000Z', spam: false },
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
                        author: { id: 'User:u1', userName: 'alice', displayName: 'Alice' },
                        contents: { html: '' },
                      },
                    },
                    {
                      node: {
                        id: 'Article:keep',
                        shortHash: 'kh',
                        title: 'keep',
                        state: 'active',
                        author: { id: 'User:u2', userName: 'bob', displayName: 'Bob' },
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
                      content: '<p>old</p>',
                      createdAt: '2026-05-15T09:00:00.000Z',
                      author: { id: 'User:x', userName: 'eve', displayName: 'Eve' },
                      communityWatchAction: null,
                      comments: { edges: [] },
                    },
                  },
                  {
                    node: {
                      id: 'Comment:new',
                      state: 'active',
                      content: '<p>new</p>',
                      createdAt: '2026-05-15T11:00:00.000Z',
                      author: { id: 'User:y', userName: 'mallory', displayName: 'Mallory' },
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

    const data = readFile(spammersPath) as { users: Record<string, { occurrences: unknown[]; reported: boolean }> }
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
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
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

    const data = readFile(statePath) as { articles: { articleId: string; shortHash: string; spam: boolean }[] }
    expect(data.articles).toEqual([
      { articleId: 'Article:a1', shortHash: 'sh1', lastScannedAt: '2026-05-15T12:00:00.000Z', spam: false },
    ])
  })

  it('upserts existing entries and flips spam when --spam is supplied', async () => {
    setFile(statePath, {
      articles: [
        { articleId: 'Article:a1', shortHash: 'sh-old', lastScannedAt: '2026-05-10T00:00:00.000Z', spam: false },
      ],
    })

    await spamScanCommand.parseAsync(['mark-scanned', '--articleId', 'Article:a1', '--shortHash', 'sh-new', '--spam'], {
      from: 'user',
    })

    const data = readFile(statePath) as {
      articles: { articleId: string; shortHash: string; spam: boolean; lastScannedAt: string }[]
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
        { articleId: 'Article:old', shortHash: 'sho', lastScannedAt: '2026-05-01T00:00:00.000Z', spam: false },
        { articleId: 'Article:keep', shortHash: 'shk', lastScannedAt: '2026-05-10T00:00:00.000Z', spam: false },
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
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
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
        { communityWatchHistory: { seen: boolean; lastUuid: string | null; lastSeenAt: string | null } }
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
            { type: 'comment', contentId: 'Comment:c1', shortHash: 'sh1', foundAt: '2026-05-15T00:00:00.000Z' },
          ],
          reported: false,
          communityWatchHistory: { seen: true, lastUuid: 'u-1', lastSeenAt: '2026-05-15T10:00:00.000Z' },
        },
        skipme: {
          displayName: 'Skipped',
          firstSeenAt: '2026-05-10T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [],
          reported: true,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
      },
    })

    await spamScanCommand.parseAsync(['list-unreported'], { from: 'user' })

    expect(vi.mocked(console.log).mock.calls).toHaveLength(1)
    const out = vi.mocked(console.log).mock.calls[0][0] as string
    expect(out).toContain('@alice (Alice)')
    expect(out).toContain('  community watch: handled at 2026-05-15T10:00:00.000Z')
    expect(out).toContain('Comment:c1')
    expect(out).not.toContain('@skipme')
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
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
      },
    })

    await spamScanCommand.parseAsync(['mark-reported', '--userName', 'alice'], { from: 'user' })

    const data = readFile(spammersPath) as { users: Record<string, { reported: boolean }> }
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
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
      },
    })
    vi.mocked(input).mockResolvedValueOnce('alice')

    await spamScanCommand.parseAsync(['mark-reported'], { from: 'user' })

    expect(input).toHaveBeenCalled()
    const data = readFile(spammersPath) as { users: Record<string, { reported: boolean }> }
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
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
        bob: {
          displayName: 'B',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: false,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
        carol: {
          displayName: 'C',
          firstSeenAt: 'x',
          lastSeenAt: 'x',
          occurrences: [],
          reported: true,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
      },
    })

    await spamScanCommand.parseAsync(['mark-reported', '--all'], { from: 'user' })

    const data = readFile(spammersPath) as { users: Record<string, { reported: boolean }> }
    expect(data.users.alice.reported).toBe(true)
    expect(data.users.bob.reported).toBe(true)
    expect(data.users.carol.reported).toBe(true)
    expect(console.log).toHaveBeenCalledWith('mark-reported: flipped 2 entries')
  })

  it('exits when a named user does not exist', async () => {
    setFile(spammersPath, { users: {} })

    await expect(
      spamScanCommand.parseAsync(['mark-reported', '--userName', 'ghost'], { from: 'user' }),
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
            { type: 'comment', contentId: 'Comment:c1', shortHash: 'sh1', foundAt: '2026-05-15T00:00:00.000Z' },
          ],
          reported: false,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
        bob: {
          displayName: 'Bob',
          firstSeenAt: '2026-05-12T00:00:00.000Z',
          lastSeenAt: '2026-05-15T00:00:00.000Z',
          occurrences: [],
          reported: true,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        },
      },
    })
  }

  it('aborts when slack.token is missing', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({ mattersApi: 'https://api.test', slack: { channel: '#x' } })
    seedUnreported()

    await expect(spamScanCommand.parseAsync(['report'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('slack.token is required in env.json')
  })

  it('aborts when slack.channel is missing', async () => {
    vi.mocked(readEnvJson).mockReturnValueOnce({ mattersApi: 'https://api.test', slack: { token: 'xoxb-1' } })
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
    const body = JSON.parse(init.body as string) as { channel: string; text: string }
    expect(body.channel).toBe('C123')
    expect(body.text).toContain('@alice (Alice)')
    expect(body.text).not.toContain('@bob')

    const data = readFile(spammersPath) as { users: Record<string, { reported: boolean }> }
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

    const data = readFile(spammersPath) as { users: Record<string, { reported: boolean }> }
    expect(data.users.alice.reported).toBe(false)
  })
})
