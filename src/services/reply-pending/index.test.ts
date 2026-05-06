import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readReplyPendingJson, writeReplyPendingJson } from './index.js'

vi.mock('node:fs')

describe('reply-pending service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readReplyPendingJson', () => {
    it('returns empty checkpoint structure when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const result = readReplyPendingJson()
      expect(result).toEqual({ lastNoticeId: null, lastNoticeCreatedAt: null, replies: [] })
    })

    it('reads and parses existing file', () => {
      const data = {
        lastNoticeId: 'Notice:abc',
        lastNoticeCreatedAt: '2026-05-05T00:00:00.000Z',
        replies: [
          {
            noticeId: 'Notice:abc',
            noticeCreatedAt: '2026-05-05T00:00:00.000Z',
            replyId: 'Comment:r1',
            replyContent: '<p>hi</p>',
            replyAuthorUserName: 'alice',
            replyState: 'active',
            replyCreatedAt: '2026-05-05T00:00:00.000Z',
            parentCommentId: 'Comment:p1',
            parentCommentContent: '<p>my comment</p>',
            articleId: 'Article:a1',
            articleState: 'active',
          },
        ],
      }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data))
      const result = readReplyPendingJson()
      expect(result).toEqual(data)
    })
  })

  describe('writeReplyPendingJson', () => {
    it('writes JSON with two-space indent at reply-pending.json in cwd', () => {
      const writeSpy = vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
      const data = { lastNoticeId: null, lastNoticeCreatedAt: null, replies: [] }

      writeReplyPendingJson(data)

      expect(writeSpy).toHaveBeenCalledWith('/test/reply-pending.json', JSON.stringify(data, null, 2))
    })
  })
})
