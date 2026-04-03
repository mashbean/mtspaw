import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decodeArticleDbId, readPendingJson, writePendingJson } from './index.js'

vi.mock('node:fs')

describe('pending service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readPendingJson', () => {
    it('returns empty structure when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const result = readPendingJson()
      expect(result).toEqual({ articles: [], articleLast: 0 })
    })

    it('reads and parses existing file', () => {
      const data = {
        articles: [
          { articleId: 'a1', articleDbId: 100, title: 'test', shortHash: 'abc', eventIds: [], channelIds: ['c1'] },
        ],
        articleLast: 100,
      }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data))
      const result = readPendingJson()
      expect(result).toEqual(data)
    })
  })

  describe('writePendingJson', () => {
    it('writes json to file', () => {
      const data = { articles: [], articleLast: 0 }
      writePendingJson(data)
      expect(fs.writeFileSync).toHaveBeenCalledWith('/test/pending.json', JSON.stringify(data, null, 2))
    })
  })

  describe('decodeArticleDbId', () => {
    it('decodes base64 article id to db id', () => {
      const articleId = Buffer.from('Article:12345').toString('base64')
      expect(decodeArticleDbId(articleId)).toBe(12345)
    })

    it('throws on invalid id', () => {
      const invalidId = Buffer.from('NoDigitsHere').toString('base64')
      expect(() => decodeArticleDbId(invalidId)).toThrow('Cannot decode DB id')
    })
  })
})
