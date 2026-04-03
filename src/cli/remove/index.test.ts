import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/pending/index.js', () => ({
  readPendingJson: vi.fn(),
  writePendingJson: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}))

import { readPendingJson, writePendingJson } from '../../services/pending/index.js'
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
