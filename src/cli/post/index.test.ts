import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  ensureAuth: vi.fn(),
  login: vi.fn(),
  readEnvJson: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))

import { ensureAuth, readEnvJson } from '../../services/auth/index.js'
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
