import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  ensureAuth: vi.fn(),
  login: vi.fn(),
  readEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
  formatGqlErrors: vi.fn((result: unknown) => {
    const errors = (result as { errors?: { message: string }[] } | null)?.errors
    if (!errors || errors.length === 0) {
      return null
    }
    return errors.map((e) => e.message).join(', ')
  }),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))

import { ensureAuth, fetchGqlWithAuthRetry, readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { postCommand } from './index.js'

describe('post article-comment command', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts comment with articleId', async () => {
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { node: { id: 'a1', title: 'Test', state: 'active' } } })
      .mockResolvedValueOnce({ data: { putComment: { id: 'c1' } } })

    await postCommand.parseAsync(['article-comment', '--articleId', 'a1', '--content', 'hello'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Comment posted:', 'c1')
  })

  it('skips when article is not active (via articleId)', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: { node: { id: 'a1', title: 'Test', state: 'archived' } },
    })

    await postCommand.parseAsync(['article-comment', '--articleId', 'a1', '--content', 'hello'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not active'))
  })

  it('skips when article is not active (via shortHash)', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: { article: { id: 'a1', title: 'Test', state: 'banned' } },
    })

    await postCommand.parseAsync(['article-comment', '--articleShortHash', 'abc', '--content', 'hello'], {
      from: 'user',
    })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not active'))
  })
})

describe('post article command', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates draft and publishes article', async () => {
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { putDraft: { id: 'd1' } } })
      .mockResolvedValueOnce({
        data: { publishArticle: { article: { id: 'a1', title: 'My Article', shortHash: 'xyz' } } },
      })

    await postCommand.parseAsync(['article', '--title', 'My Article', '--content', 'Hello world'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Draft created: d1')
    expect(console.log).toHaveBeenCalledWith('Article published: My Article (xyz)')
  })

  it('publishes article with event submission', async () => {
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { putDraft: { id: 'd1' } } })
      .mockResolvedValueOnce({
        data: { publishArticle: { article: { id: 'a1', title: 'My Article', shortHash: 'xyz' } } },
      })

    await postCommand.parseAsync(['article', '--title', 'My Article', '--content', 'Hello'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Article published: My Article (xyz)')
  })

  it('resolves event via eventShortHash', async () => {
    vi.mocked(fetchGql)
      .mockResolvedValueOnce({ data: { campaign: { id: 'e1', name: 'Event 1' } } })
      .mockResolvedValueOnce({ data: { putDraft: { id: 'd1' } } })
      .mockResolvedValueOnce({
        data: { publishArticle: { article: { id: 'a1', title: 'My Article', shortHash: 'xyz' } } },
      })

    await postCommand.parseAsync(
      ['article', '--title', 'My Article', '--content', 'Hello', '--eventShortHash', 'abc'],
      { from: 'user' },
    )

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Resolved event'))
  })

  it('exits on draft creation failure', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      errors: [{ message: 'Draft error' }],
    })

    await expect(
      postCommand.parseAsync(['article', '--title', 'Test', '--content', 'Hello'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Draft creation failed:', 'Draft error')
  })
})

describe('post comment-reply command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api.test' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replies to a top-level comment with parentId = commentId', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: {
        node: {
          id: 'c1',
          state: 'active',
          parentComment: null,
          node: { id: 'a1', state: 'active' },
        },
      },
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { data: { putComment: { id: 'reply1' } } },
      errorMessage: null,
    })

    await postCommand.parseAsync(['comment-reply', '--commentId', 'c1', '--content', 'hi'], { from: 'user' })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
      '/test/env.json',
      'https://api.test',
      expect.stringContaining('putComment'),
      {
        input: {
          comment: {
            type: 'article',
            articleId: 'a1',
            content: 'hi',
            parentId: 'c1',
            replyTo: 'c1',
          },
        },
      },
    )
    expect(console.log).toHaveBeenCalledWith('Reply posted:', 'reply1')
  })

  it('replies to a nested comment with parentId = parentComment.id', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: {
        node: {
          id: 'c2',
          state: 'active',
          parentComment: { id: 'c-root' },
          node: { id: 'a1', state: 'active' },
        },
      },
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { data: { putComment: { id: 'reply2' } } },
      errorMessage: null,
    })

    await postCommand.parseAsync(['comment-reply', '--commentId', 'c2', '--content', 'nested'], { from: 'user' })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
      '/test/env.json',
      'https://api.test',
      expect.stringContaining('putComment'),
      {
        input: {
          comment: {
            type: 'article',
            articleId: 'a1',
            content: 'nested',
            parentId: 'c-root',
            replyTo: 'c2',
          },
        },
      },
    )
    expect(console.log).toHaveBeenCalledWith('Reply posted:', 'reply2')
  })

  it('exits when comment is not found', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { node: null } })

    await expect(
      postCommand.parseAsync(['comment-reply', '--commentId', 'cx', '--content', 'hi'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Comment not found: cx')
  })

  it('skips when target comment is not active', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: {
        node: {
          id: 'c1',
          state: 'archived',
          parentComment: null,
          node: { id: 'a1', state: 'active' },
        },
      },
    })

    await postCommand.parseAsync(['comment-reply', '--commentId', 'c1', '--content', 'hi'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Comment is not active'))
    expect(fetchGqlWithAuthRetry).not.toHaveBeenCalled()
  })

  it('skips when article is not active', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: {
        node: {
          id: 'c1',
          state: 'active',
          parentComment: null,
          node: { id: 'a1', state: 'archived' },
        },
      },
    })

    await postCommand.parseAsync(['comment-reply', '--commentId', 'c1', '--content', 'hi'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Article is not active'))
    expect(fetchGqlWithAuthRetry).not.toHaveBeenCalled()
  })

  it('exits when server returns an error on putComment', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({
      data: {
        node: {
          id: 'c1',
          state: 'active',
          parentComment: null,
          node: { id: 'a1', state: 'active' },
        },
      },
    })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { errors: [{ message: 'forbidden' }] },
      errorMessage: 'forbidden',
    })

    await expect(
      postCommand.parseAsync(['comment-reply', '--commentId', 'c1', '--content', 'hi'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Reply failed:', 'forbidden')
  })
})
