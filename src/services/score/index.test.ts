import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readScoreJson, writeScoreJson } from './index.js'

vi.mock('node:fs')

describe('score service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readScoreJson', () => {
    it('returns empty articles when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const result = readScoreJson()
      expect(result).toEqual({ articles: [] })
    })

    it('reads and parses existing file', () => {
      const data = {
        articles: [
          {
            articleId: 'Article:1',
            shortHash: 'abc',
            score: 90,
            author: 'alice',
            scoredAt: '2026-05-05T00:00:00.000Z',
          },
        ],
      }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data))
      const result = readScoreJson()
      expect(result).toEqual(data)
    })
  })

  describe('writeScoreJson', () => {
    it('writes JSON with two-space indent at score.json in cwd', () => {
      const writeSpy = vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
      const data = { articles: [] }

      writeScoreJson(data)

      expect(writeSpy).toHaveBeenCalledWith('/test/score.json', JSON.stringify(data, null, 2))
    })
  })
})
