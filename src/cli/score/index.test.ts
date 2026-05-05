import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/score/index.js', () => ({
  readScoreJson: vi.fn(),
  writeScoreJson: vi.fn(),
}))

import { readScoreJson, writeScoreJson } from '../../services/score/index.js'
import { scoreCommand } from './index.js'

describe('score command', () => {
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

  describe('add', () => {
    it('appends a new entry', async () => {
      vi.mocked(readScoreJson).mockReturnValue({ articles: [] })

      await scoreCommand.parseAsync(
        ['add', '--articleId', 'A:1', '--shortHash', 'abc', '--score', '88', '--author', 'alice'],
        { from: 'user' },
      )

      expect(writeScoreJson).toHaveBeenCalledWith({
        articles: [
          {
            articleId: 'A:1',
            shortHash: 'abc',
            score: 88,
            author: 'alice',
            scoredAt: expect.any(String),
          },
        ],
      })
      expect(console.log).toHaveBeenCalledWith('Score recorded: A:1 (88)')
    })

    it('replaces an existing entry by articleId', async () => {
      vi.mocked(readScoreJson).mockReturnValue({
        articles: [
          { articleId: 'A:1', shortHash: 'old', score: 50, author: 'alice', scoredAt: '2026-01-01T00:00:00Z' },
          { articleId: 'A:2', shortHash: 'xyz', score: 70, author: 'bob', scoredAt: '2026-01-02T00:00:00Z' },
        ],
      })

      await scoreCommand.parseAsync(
        ['add', '--articleId', 'A:1', '--shortHash', 'new', '--score', '90', '--author', 'alice'],
        { from: 'user' },
      )

      const call = vi.mocked(writeScoreJson).mock.calls[0][0]
      expect(call.articles).toHaveLength(2)
      const updated = call.articles.find((a) => a.articleId === 'A:1')!
      expect(updated.shortHash).toBe('new')
      expect(updated.score).toBe(90)
      expect(call.articles.find((a) => a.articleId === 'A:2')?.score).toBe(70)
    })

    it('rejects non-integer score', async () => {
      await expect(
        scoreCommand.parseAsync(
          ['add', '--articleId', 'A:1', '--shortHash', 'abc', '--score', '88.5', '--author', 'alice'],
          { from: 'user' },
        ),
      ).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Score must be an integer')
      expect(writeScoreJson).not.toHaveBeenCalled()
    })

    it('rejects out-of-range score', async () => {
      await expect(
        scoreCommand.parseAsync(
          ['add', '--articleId', 'A:1', '--shortHash', 'abc', '--score', '101', '--author', 'alice'],
          { from: 'user' },
        ),
      ).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Score must be in 0-100')
    })
  })

  describe('remove', () => {
    it('removes an existing entry', async () => {
      vi.mocked(readScoreJson).mockReturnValue({
        articles: [
          { articleId: 'A:1', shortHash: 'abc', score: 88, author: 'alice', scoredAt: '2026-04-30T00:00:00Z' },
          { articleId: 'A:2', shortHash: 'xyz', score: 70, author: 'bob', scoredAt: '2026-04-30T00:00:00Z' },
        ],
      })

      await scoreCommand.parseAsync(['remove', '--articleId', 'A:1'], { from: 'user' })

      const call = vi.mocked(writeScoreJson).mock.calls[0][0]
      expect(call.articles).toHaveLength(1)
      expect(call.articles[0].articleId).toBe('A:2')
      expect(console.log).toHaveBeenCalledWith('Score removed: A:1')
    })

    it('exits when articleId not found', async () => {
      vi.mocked(readScoreJson).mockReturnValue({
        articles: [{ articleId: 'A:2', shortHash: 'xyz', score: 70, author: 'bob', scoredAt: '2026-04-30T00:00:00Z' }],
      })

      await expect(scoreCommand.parseAsync(['remove', '--articleId', 'A:1'], { from: 'user' })).rejects.toThrow(
        'process.exit',
      )
      expect(console.error).toHaveBeenCalledWith('Article not found in score.json: A:1')
      expect(writeScoreJson).not.toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('clears all entries and reports count', async () => {
      vi.mocked(readScoreJson).mockReturnValue({
        articles: [
          { articleId: 'A:1', shortHash: 'abc', score: 88, author: 'alice', scoredAt: '2026-04-30T00:00:00Z' },
          { articleId: 'A:2', shortHash: 'xyz', score: 70, author: 'bob', scoredAt: '2026-04-30T00:00:00Z' },
        ],
      })

      await scoreCommand.parseAsync(['clear'], { from: 'user' })

      expect(writeScoreJson).toHaveBeenCalledWith({ articles: [] })
      expect(console.log).toHaveBeenCalledWith('Score cleared (2 removed)')
    })

    it('skips writing when already empty', async () => {
      vi.mocked(readScoreJson).mockReturnValue({ articles: [] })

      await scoreCommand.parseAsync(['clear'], { from: 'user' })

      expect(writeScoreJson).not.toHaveBeenCalled()
      expect(console.log).toHaveBeenCalledWith('Score is already empty')
    })
  })
})
