import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(() => ({ mattersApi: 'https://api.test', userName: 'self' })),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
vi.mock('../../services/reply-pending/index.js', () => ({
  readReplyPendingJson: vi.fn(),
  writeReplyPendingJson: vi.fn(),
}))

import { fetchGqlWithAuthRetry } from '../../services/auth/index.js'
import { readReplyPendingJson, writeReplyPendingJson } from '../../services/reply-pending/index.js'
import { replyQueryCommand } from './index.js'

const buildNotice = (overrides: {
  id: string
  createdAt: string
  typename?: string
  type?: string
  replyId?: string
  replyState?: string
  replyContent?: string
  replyAuthorUserName?: string
  replyCreatedAt?: string
  targetId?: string
  targetContent?: string
  articleId?: string
  articleState?: string
}) => ({
  cursor: `cursor:${overrides.id}`,
  node: {
    id: overrides.id,
    createdAt: overrides.createdAt,
    __typename: overrides.typename ?? 'CommentCommentNotice',
    type: overrides.type ?? 'CommentNewReply',
    target: {
      id: overrides.targetId ?? 'Comment:p1',
      content: overrides.targetContent ?? '<p>my comment</p>',
      author: { userName: 'self' },
      node: { id: overrides.articleId ?? 'Article:a1', state: overrides.articleState ?? 'active' },
    },
    comment: {
      id: overrides.replyId ?? `Comment:r-${overrides.id}`,
      state: overrides.replyState ?? 'active',
      content: overrides.replyContent ?? '<p>their reply</p>',
      createdAt: overrides.replyCreatedAt ?? overrides.createdAt,
      author: { userName: overrides.replyAuthorUserName ?? 'alice' },
    },
  },
})

const buildMentionNotice = (overrides: {
  id: string
  createdAt: string
  replyId?: string
  replyState?: string
  replyContent?: string
  replyAuthorUserName?: string
  replyCreatedAt?: string
  parentId?: string
  parentContent?: string
  parentAuthorUserName?: string | null
  articleId?: string
  articleState?: string
}) => ({
  cursor: `cursor:${overrides.id}`,
  node: {
    id: overrides.id,
    createdAt: overrides.createdAt,
    __typename: 'CommentNotice',
    mentionType: 'CommentMentionedYou',
    target: {
      id: overrides.replyId ?? `Comment:r-${overrides.id}`,
      state: overrides.replyState ?? 'active',
      content: overrides.replyContent ?? '<p>their reply</p>',
      createdAt: overrides.replyCreatedAt ?? overrides.createdAt,
      author: { userName: overrides.replyAuthorUserName ?? 'alice' },
      parentComment:
        overrides.parentAuthorUserName === null
          ? null
          : {
              id: overrides.parentId ?? 'Comment:p1',
              content: overrides.parentContent ?? '<p>my comment</p>',
              author: { userName: overrides.parentAuthorUserName ?? 'self' },
            },
      node: { id: overrides.articleId ?? 'Article:a1', state: overrides.articleState ?? 'active' },
    },
  },
})

const buildPage = (
  edges: (ReturnType<typeof buildNotice> | ReturnType<typeof buildMentionNotice>)[],
  hasNextPage = false,
  endCursor: string | null = null,
) => ({
  result: {
    data: {
      viewer: {
        notices: {
          pageInfo: { endCursor, hasNextPage },
          edges,
        },
      },
    },
  },
  errorMessage: null,
})

describe('reply-query command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('first run: only sets checkpoint, does not enqueue replies', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: null,
      lastNoticeCreatedAt: null,
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildNotice({ id: 'Notice:1', createdAt: '2026-05-05T11:00:00.000Z' }),
        buildNotice({ id: 'Notice:2', createdAt: '2026-05-05T10:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    expect(writeReplyPendingJson).toHaveBeenCalledWith({
      lastNoticeId: 'Notice:1',
      lastNoticeCreatedAt: '2026-05-05T11:00:00.000Z',
      replies: [],
    })
    expect(fetchGqlWithAuthRetry).toHaveBeenCalledTimes(1)
  })

  it('subsequent run: appends new entries up to checkpoint', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:old',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildNotice({ id: 'Notice:n1', createdAt: '2026-05-05T11:00:00.000Z', replyId: 'Comment:r1' }),
        buildNotice({ id: 'Notice:n2', createdAt: '2026-05-05T10:00:00.000Z', replyId: 'Comment:r2' }),
        buildNotice({ id: 'Notice:old', createdAt: '2026-05-05T08:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.lastNoticeId).toBe('Notice:n1')
    expect(writeArg.lastNoticeCreatedAt).toBe('2026-05-05T11:00:00.000Z')
    expect(writeArg.replies.map((r) => r.replyId)).toEqual(['Comment:r1', 'Comment:r2'])
  })

  it('skips notices that are not CommentNewReply', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:old',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildNotice({ id: 'Notice:art', createdAt: '2026-05-05T11:00:00.000Z', typename: 'ArticleNotice' }),
        buildNotice({
          id: 'Notice:keep',
          createdAt: '2026-05-05T10:30:00.000Z',
          replyId: 'Comment:keep',
        }),
        buildNotice({
          id: 'Notice:other',
          createdAt: '2026-05-05T10:00:00.000Z',
          type: 'CommentLiked',
        }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.replies.map((r) => r.replyId)).toEqual(['Comment:keep'])
  })

  it('drops entries older than 2 days via TTL', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T11:30:00.000Z',
      replies: [
        {
          noticeId: 'Notice:old',
          noticeCreatedAt: '2026-05-02T00:00:00.000Z',
          replyId: 'Comment:old',
          replyContent: 'x',
          replyAuthorUserName: 'a',
          replyState: 'active',
          replyCreatedAt: '2026-05-02T00:00:00.000Z',
          parentCommentId: 'p',
          parentCommentContent: 'y',
          articleId: 'art',
          articleState: 'active',
        },
        {
          noticeId: 'Notice:fresh',
          noticeCreatedAt: '2026-05-05T11:00:00.000Z',
          replyId: 'Comment:fresh',
          replyContent: 'x',
          replyAuthorUserName: 'a',
          replyState: 'active',
          replyCreatedAt: '2026-05-05T11:00:00.000Z',
          parentCommentId: 'p',
          parentCommentContent: 'y',
          articleId: 'art',
          articleState: 'active',
        },
      ],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(buildPage([]))

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.replies.map((r) => r.replyId)).toEqual(['Comment:fresh'])
  })

  it('exits when GraphQL returns an error', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T11:30:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { errors: [{ message: 'boom' }] },
      errorMessage: 'boom',
    })

    await expect(replyQueryCommand.parseAsync([], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('reply-query failed:', 'boom')
  })

  it('paginates until checkpoint reached', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:checkpoint',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry)
      .mockResolvedValueOnce(
        buildPage(
          [
            buildNotice({ id: 'Notice:p1a', createdAt: '2026-05-05T11:00:00.000Z', replyId: 'Comment:p1a' }),
            buildNotice({ id: 'Notice:p1b', createdAt: '2026-05-05T10:30:00.000Z', replyId: 'Comment:p1b' }),
          ],
          true,
          'cursor:after-page-1',
        ),
      )
      .mockResolvedValueOnce(
        buildPage([
          buildNotice({ id: 'Notice:p2a', createdAt: '2026-05-05T09:00:00.000Z', replyId: 'Comment:p2a' }),
          buildNotice({ id: 'Notice:checkpoint', createdAt: '2026-05-05T08:00:00.000Z' }),
          buildNotice({ id: 'Notice:p2c', createdAt: '2026-05-05T07:00:00.000Z' }),
        ]),
      )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledTimes(2)
    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.lastNoticeId).toBe('Notice:p1a')
    expect(writeArg.replies.map((r) => r.replyId)).toEqual(['Comment:p1a', 'Comment:p1b', 'Comment:p2a'])
  })

  it('captures CommentMentionedYou when parentComment.author equals SELF', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildMentionNotice({
          id: 'Notice:m1',
          createdAt: '2026-05-05T11:00:00.000Z',
          replyId: 'Comment:m-r1',
          parentAuthorUserName: 'self',
        }),
        buildNotice({ id: 'Notice:cp', createdAt: '2026-05-05T08:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.replies.map((r) => r.replyId)).toEqual(['Comment:m-r1'])
    expect(writeArg.replies[0].parentCommentContent).toBe('<p>my comment</p>')
  })

  it('skips CommentMentionedYou when parentComment.author is not SELF', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildMentionNotice({
          id: 'Notice:m2',
          createdAt: '2026-05-05T11:00:00.000Z',
          replyId: 'Comment:m-r2',
          parentAuthorUserName: 'someoneElse',
        }),
        buildNotice({ id: 'Notice:cp', createdAt: '2026-05-05T08:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.replies).toEqual([])
  })

  it('skips CommentMentionedYou when parentComment is missing (top-level mention)', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildMentionNotice({
          id: 'Notice:m3',
          createdAt: '2026-05-05T11:00:00.000Z',
          replyId: 'Comment:m-r3',
          parentAuthorUserName: null,
        }),
        buildNotice({ id: 'Notice:cp', createdAt: '2026-05-05T08:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync([], { from: 'user' })

    const writeArg = vi.mocked(writeReplyPendingJson).mock.calls[0][0]
    expect(writeArg.replies).toEqual([])
  })

  it('--dry-run prints summary and does not write reply-pending.json', async () => {
    vi.mocked(readReplyPendingJson).mockReturnValue({
      lastNoticeId: 'Notice:cp',
      lastNoticeCreatedAt: '2026-05-05T08:00:00.000Z',
      replies: [],
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(
      buildPage([
        buildNotice({ id: 'Notice:n1', createdAt: '2026-05-05T11:00:00.000Z', replyId: 'Comment:r1' }),
        buildNotice({ id: 'Notice:cp', createdAt: '2026-05-05T08:00:00.000Z' }),
      ]),
    )

    await replyQueryCommand.parseAsync(['--dry-run'], { from: 'user' })

    expect(writeReplyPendingJson).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith('--- reply-query dry-run (no write) ---')
    expect(console.log).toHaveBeenCalledWith('would append: 1 new entries')
  })
})
