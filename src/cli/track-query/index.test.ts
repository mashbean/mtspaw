import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  ensureAuth: vi.fn(),
  readEnvJson: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
  delay: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/track/index.js', () => ({
  readTrackJson: vi.fn(),
}))
vi.mock('../../services/pending/index.js', () => ({
  readPendingJson: vi.fn(),
  writePendingJson: vi.fn(),
  decodeArticleDbId: vi.fn(),
}))

import { ensureAuth, readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { decodeArticleDbId, readPendingJson, writePendingJson } from '../../services/pending/index.js'
import { readTrackJson } from '../../services/track/index.js'
import { trackQueryCommand } from './index.js'

describe('track-query command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api.test' })
    vi.mocked(ensureAuth).mockResolvedValue('token')
    vi.mocked(readPendingJson).mockReturnValue({ articles: [], articleLast: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queries articles from tracked channels', async () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: {},
      channels: { c1: { id: 'c1', hash: 'abc', name: 'Channel 1' } },
    })
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { viewer: { id: 'user1' } } })
      .mockResolvedValueOnce({
        data: {
          channel: {
            articles: {
              edges: [{ node: { id: 'QXJ0aWNsZToxMDA=', shortHash: 'h1', comments: { totalCount: 0 } } }],
            },
          },
        },
      })
    vi.mocked(decodeArticleDbId).mockReturnValue(100)

    await trackQueryCommand.parseAsync([], { from: 'user' })

    expect(writePendingJson).toHaveBeenCalledWith({
      articles: [
        {
          articleId: 'QXJ0aWNsZToxMDA=',
          articleDbId: 100,
          shortHash: 'h1',
          eventIds: [],
          channelIds: ['c1'],
        },
      ],
      articleLast: 100,
    })
  })

  it('skips articles already commented on', async () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: {},
      channels: { c1: { id: 'c1', hash: 'abc', name: 'Channel 1' } },
    })
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { viewer: { id: 'user1' } } })
      .mockResolvedValueOnce({
        data: {
          channel: {
            articles: {
              edges: [{ node: { id: 'QXJ0aWNsZToxMDA=', shortHash: 'h1', comments: { totalCount: 5 } } }],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: { article: { comments: { edges: [{ node: { author: { id: 'user1' } } }] } } },
      })
    vi.mocked(decodeArticleDbId).mockReturnValue(100)

    await trackQueryCommand.parseAsync([], { from: 'user' })

    expect(writePendingJson).toHaveBeenCalledWith({ articles: [], articleLast: 0 })
  })

  it('logs message when no tracked items', async () => {
    vi.mocked(readTrackJson).mockReturnValue({ events: {}, channels: {} })
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { viewer: { id: 'user1' } } })

    await trackQueryCommand.parseAsync([], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('No tracked events or channels')
  })
})
