import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/pending/index.js', () => ({
  readPendingJson: vi.fn(),
  writePendingJson: vi.fn(),
}))
vi.mock('../../services/reply-pending/index.js', () => ({
  readReplyPendingJson: vi.fn(),
  writeReplyPendingJson: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}))

import { readPendingJson, writePendingJson } from '../../services/pending/index.js'
import { readReplyPendingJson, writeReplyPendingJson } from '../../services/reply-pending/index.js'
import { removeCommand } from './index.js'

describe('remove pending command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes article by id', async () => {
    vi.mocked(readPendingJson).mockReturnValue({
      articles: [
        { articleId: 'a1', articleDbId: 1, shortHash: 'h1', eventIds: [], channelIds: ['c1'] },
        { articleId: 'a2', articleDbId: 2, shortHash: 'h2', eventIds: [], channelIds: ['c1'] },
      ],
      articleLast: 2,
    })

    await removeCommand.parseAsync(['pending', '--articleId', 'a1'], { from: 'user' })

    expect(writePendingJson).toHaveBeenCalledWith({
      articles: [{ articleId: 'a2', articleDbId: 2, shortHash: 'h2', eventIds: [], channelIds: ['c1'] }],
      articleLast: 2,
    })
  })

  it('exits when article not found', async () => {
    vi.mocked(readPendingJson).mockReturnValue({ articles: [], articleLast: 0 })

    await expect(removeCommand.parseAsync(['pending', '--articleId', 'missing'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('Article not found in pending.json: missing')
  })
})

describe('remove reply-pending command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes a reply entry by replyId', async () => {
    const entry = (id: string) => ({
      noticeId: `Notice:${id}`,
      noticeCreatedAt: '2026-05-05T00:00:00.000Z',
      replyId: id,
      replyContent: 'x',
      replyAuthorUserName: 'a',
      replyState: 'active',
      replyCreatedAt: '2026-05-05T00:00:00.000Z',
      parentCommentId: 'p',
      parentCommentContent: 'y',
      articleId: 'art',
      articleState: 'active',
      selfRepliesInThread: 0,
    })

    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:last',
      lastNoticeCreatedAt: '2026-05-05T00:00:00.000Z',
      replies: [entry('r1'), entry('r2')],
    })

    await removeCommand.parseAsync(['reply-pending', '--replyId', 'r1'], { from: 'user' })

    expect(writeReplyPendingJson).toHaveBeenCalledWith({
      lastNoticeId: 'Notice:last',
      lastNoticeCreatedAt: '2026-05-05T00:00:00.000Z',
      replies: [entry('r2')],
    })
    expect(console.log).toHaveBeenCalledWith('Removed reply r1 from reply-pending.json')
  })

  it('exits when reply not found', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: null,
      lastNoticeCreatedAt: null,
      replies: [],
    })

    await expect(removeCommand.parseAsync(['reply-pending', '--replyId', 'missing'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('Reply not found in reply-pending.json: missing')
  })
})
