import fs from 'node:fs'
import path from 'node:path'

interface ReplyEntry {
  noticeId: string
  noticeCreatedAt: string
  replyId: string
  replyContent: string
  replyAuthorUserName: string
  replyState: string
  replyCreatedAt: string
  parentCommentId: string
  parentCommentContent: string
  articleId: string
  articleState: string
}

interface ReplyPendingJson {
  lastNoticeId: string | null
  lastNoticeCreatedAt: string | null
  replies: ReplyEntry[]
}

const getReplyPendingJsonPath = () => path.resolve(process.cwd(), 'reply-pending.json')

const readReplyPendingJson = (): ReplyPendingJson => {
  const replyPendingJsonPath = getReplyPendingJsonPath()
  if (!fs.existsSync(replyPendingJsonPath)) {
    return { lastNoticeId: null, lastNoticeCreatedAt: null, replies: [] }
  }
  return JSON.parse(fs.readFileSync(replyPendingJsonPath, 'utf-8'))
}

const writeReplyPendingJson = (data: ReplyPendingJson) => {
  fs.writeFileSync(getReplyPendingJsonPath(), JSON.stringify(data, null, 2))
}

export { readReplyPendingJson, writeReplyPendingJson }
export type { ReplyEntry, ReplyPendingJson }
