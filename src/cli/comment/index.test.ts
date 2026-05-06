import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(() => ({ mattersApi: 'https://api.test' })),
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

import { fetchGqlWithAuthRetry } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { commentCommand } from './index.js'

describe('comment like command', () => {
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

  it('upvotes an active comment', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { node: { id: 'c1', state: 'active' } } })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { data: { voteComment: { id: 'c1', myVote: 'up' } } },
      errorMessage: null,
    })

    await commentCommand.parseAsync(['like', '--commentId', 'c1'], { from: 'user' })

    expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
      '/test/env.json',
      'https://api.test',
      expect.stringContaining('voteComment'),
      { input: { id: 'c1', vote: 'up' } },
    )
    expect(console.log).toHaveBeenCalledWith('Comment liked: c1')
  })

  it('exits when comment is not found', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { node: null } })

    await expect(commentCommand.parseAsync(['like', '--commentId', 'cx'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('Comment not found: cx')
    expect(fetchGqlWithAuthRetry).not.toHaveBeenCalled()
  })

  it('skips when comment is not active', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { node: { id: 'c1', state: 'archived' } } })

    await commentCommand.parseAsync(['like', '--commentId', 'c1'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Comment is not active'))
    expect(fetchGqlWithAuthRetry).not.toHaveBeenCalled()
  })

  it('exits when server returns an error on voteComment', async () => {
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { node: { id: 'c1', state: 'active' } } })
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { errors: [{ message: 'forbidden' }] },
      errorMessage: 'forbidden',
    })

    await expect(commentCommand.parseAsync(['like', '--commentId', 'c1'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('Like failed:', 'forbidden')
  })
})

describe('comment unlike command', () => {
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

  it('removes the upvote without state precheck', async () => {
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { data: { unvoteComment: { id: 'c1', myVote: null } } },
      errorMessage: null,
    })

    await commentCommand.parseAsync(['unlike', '--commentId', 'c1'], { from: 'user' })

    expect(fetchGql).not.toHaveBeenCalled()
    expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
      '/test/env.json',
      'https://api.test',
      expect.stringContaining('unvoteComment'),
      { input: { id: 'c1' } },
    )
    expect(console.log).toHaveBeenCalledWith('Comment unliked: c1')
  })

  it('exits when server returns an error on unvoteComment', async () => {
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
      result: { errors: [{ message: 'no vote' }] },
      errorMessage: 'no vote',
    })

    await expect(commentCommand.parseAsync(['unlike', '--commentId', 'c1'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('Unlike failed:', 'no vote')
  })
})
