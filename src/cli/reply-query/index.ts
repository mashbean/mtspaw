import { Command } from 'commander'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import type { ReplyEntry, ReplyPendingJson } from '../../services/reply-pending/index.js'
import { readReplyPendingJson, writeReplyPendingJson } from '../../services/reply-pending/index.js'

const TTL_MS = 2 * 24 * 60 * 60 * 1000

const NOTICES_QUERY = `
  query ViewerNotices($input: ConnectionArgs!) {
    viewer {
      notices(input: $input) {
        pageInfo { endCursor hasNextPage }
        edges {
          cursor
          node {
            id
            createdAt
            __typename
            ... on CommentCommentNotice {
              type
              target {
                id
                content
                author { userName }
                node { ... on Article { id state } }
              }
              comment {
                id
                state
                content
                createdAt
                author { userName }
              }
            }
          }
        }
      }
    }
  }
`

interface NoticeEdge {
  cursor: string
  node: {
    id: string
    createdAt: string
    __typename: string
    type?: string
    target?: {
      id: string
      content?: string | null
      author?: { userName?: string | null } | null
      node?: { id?: string; state?: string } | null
    } | null
    comment?: {
      id: string
      state: string
      content?: string | null
      createdAt: string
      author?: { userName?: string | null } | null
    } | null
  }
}

interface NoticesResponse {
  data?: {
    viewer?: {
      notices?: {
        pageInfo: { endCursor: string | null; hasNextPage: boolean }
        edges: NoticeEdge[]
      }
    }
  }
}

const NOTICE_TYPENAME = 'CommentCommentNotice'
const NOTICE_TYPE_NEW_REPLY = 'CommentNewReply'

const isCommentNewReply = (edge: NoticeEdge) => {
  return edge.node.__typename === NOTICE_TYPENAME && edge.node.type === NOTICE_TYPE_NEW_REPLY
}

const toEntry = (edge: NoticeEdge): ReplyEntry | null => {
  const reply = edge.node.comment
  const target = edge.node.target
  if (!reply || !target) {
    return null
  }
  return {
    noticeId: edge.node.id,
    noticeCreatedAt: edge.node.createdAt,
    replyId: reply.id,
    replyContent: reply.content ?? '',
    replyAuthorUserName: reply.author?.userName ?? '',
    replyState: reply.state,
    replyCreatedAt: reply.createdAt,
    parentCommentId: target.id,
    parentCommentContent: target.content ?? '',
    articleId: target.node?.id ?? '',
    articleState: target.node?.state ?? '',
  }
}

const replyQueryCommand = new Command('reply-query')
  .description('Fetch new comment-reply notices into reply-pending.json')
  .action(async () => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)

    const state: ReplyPendingJson = readReplyPendingJson()

    const cutoffMs = Date.now() - TTL_MS
    const beforeTtl = state.replies.length
    state.replies = state.replies.filter((entry) => {
      const ts = Date.parse(entry.replyCreatedAt)
      return Number.isFinite(ts) && ts >= cutoffMs
    })
    const droppedByTtl = beforeTtl - state.replies.length

    const checkpointId = state.lastNoticeId
    const checkpointAtMs = state.lastNoticeCreatedAt ? Date.parse(state.lastNoticeCreatedAt) : null
    const isFirstRun = !checkpointId

    const newEntries: ReplyEntry[] = []
    let cursor: string | null = null
    let stop = false
    let firstNoticeId: string | null = null
    let firstNoticeCreatedAt: string | null = null

    while (!stop) {
      const input: Record<string, unknown> = { first: 50 }
      if (cursor) {
        input.after = cursor
      }
      const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, NOTICES_QUERY, { input })
      if (errorMessage) {
        console.error('reply-query failed:', errorMessage)
        process.exit(1)
      }

      const conn = (result as NoticesResponse).data?.viewer?.notices
      if (!conn) {
        break
      }
      const edges = conn.edges
      if (edges.length === 0) {
        break
      }

      if (firstNoticeId === null) {
        firstNoticeId = edges[0].node.id
        firstNoticeCreatedAt = edges[0].node.createdAt
      }

      if (isFirstRun) {
        break
      }

      for (const edge of edges) {
        if (edge.node.id === checkpointId) {
          stop = true
          break
        }
        if (checkpointAtMs !== null) {
          const ts = Date.parse(edge.node.createdAt)
          if (Number.isFinite(ts) && ts <= checkpointAtMs) {
            stop = true
            break
          }
        }
        if (!isCommentNewReply(edge)) {
          continue
        }
        const entry = toEntry(edge)
        if (entry) {
          newEntries.push(entry)
        }
      }

      if (stop) {
        break
      }
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) {
        break
      }
      cursor = conn.pageInfo.endCursor
    }

    if (firstNoticeId && firstNoticeCreatedAt) {
      state.lastNoticeId = firstNoticeId
      state.lastNoticeCreatedAt = firstNoticeCreatedAt
    }

    if (!isFirstRun && newEntries.length > 0) {
      const existingIds = new Set(state.replies.map((r) => r.replyId))
      for (const entry of newEntries) {
        if (!existingIds.has(entry.replyId)) {
          state.replies.push(entry)
        }
      }
    }

    writeReplyPendingJson(state)

    if (isFirstRun) {
      console.log('First run: checkpoint set, no replies enqueued')
    } else {
      console.log(`reply-query: ${newEntries.length} new, ${droppedByTtl} dropped by TTL`)
    }
  })

export { replyQueryCommand }
