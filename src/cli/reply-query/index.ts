import { Command } from 'commander'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import { fromGlobalId } from '../../services/gql/index.js'
import type { ReplyEntry, ReplyPendingJson } from '../../services/reply-pending/index.js'
import { readReplyPendingJson, writeReplyPendingJson } from '../../services/reply-pending/index.js'

const TTL_MS = 2 * 24 * 60 * 60 * 1000

const VIEWER_ID_QUERY = `
  query ViewerId {
    viewer { id }
  }
`

const NOTICES_QUERY = `
  query ViewerNotices($input: ConnectionArgs!, $selfId: ID!) {
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
                comments(input: { author: $selfId, first: 1 }) { totalCount }
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
            ... on CommentNotice {
              mentionType: type
              target {
                id
                state
                content
                createdAt
                author { userName }
                parentComment {
                  id
                  content
                  author { userName }
                  comments(input: { author: $selfId, first: 1 }) { totalCount }
                }
                node { ... on Article { id state } }
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
    mentionType?: string
    target?: {
      id: string
      state?: string
      content?: string | null
      createdAt?: string
      author?: { userName?: string | null } | null
      comments?: { totalCount: number } | null
      parentComment?: {
        id: string
        content?: string | null
        author?: { userName?: string | null } | null
        comments?: { totalCount: number } | null
      } | null
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

const NOTICE_TYPENAME_COMMENT_COMMENT = 'CommentCommentNotice'
const NOTICE_TYPENAME_COMMENT = 'CommentNotice'
const NOTICE_TYPE_NEW_REPLY = 'CommentNewReply'
const NOTICE_TYPE_MENTIONED_YOU = 'CommentMentionedYou'

const toEntry = (edge: NoticeEdge, self: string): ReplyEntry | null => {
  const node = edge.node

  if (node.__typename === NOTICE_TYPENAME_COMMENT_COMMENT && node.type === NOTICE_TYPE_NEW_REPLY) {
    const reply = node.comment
    const target = node.target
    if (!reply || !target) {
      return null
    }
    return {
      noticeId: node.id,
      noticeCreatedAt: node.createdAt,
      replyId: reply.id,
      replyContent: reply.content ?? '',
      replyAuthorUserName: reply.author?.userName ?? '',
      replyState: reply.state,
      replyCreatedAt: reply.createdAt,
      parentCommentId: target.id,
      parentCommentContent: target.content ?? '',
      articleId: target.node?.id ?? '',
      articleState: target.node?.state ?? '',
      selfRepliesInThread: target.comments?.totalCount ?? 0,
    }
  }

  if (node.__typename === NOTICE_TYPENAME_COMMENT && node.mentionType === NOTICE_TYPE_MENTIONED_YOU) {
    const target = node.target
    const parent = target?.parentComment
    if (!target || !parent) {
      return null
    }
    if (parent.author?.userName !== self) {
      return null
    }
    return {
      noticeId: node.id,
      noticeCreatedAt: node.createdAt,
      replyId: target.id,
      replyContent: target.content ?? '',
      replyAuthorUserName: target.author?.userName ?? '',
      replyState: target.state ?? '',
      replyCreatedAt: target.createdAt ?? node.createdAt,
      parentCommentId: parent.id,
      parentCommentContent: parent.content ?? '',
      articleId: target.node?.id ?? '',
      articleState: target.node?.state ?? '',
      selfRepliesInThread: parent.comments?.totalCount ?? 0,
    }
  }

  return null
}

const replyQueryCommand = new Command('reply-query')
  .description('Fetch new comment-reply notices into reply-pending.json')
  .option('--dry-run', 'Print would-be checkpoint advance and new entries; do not write reply-pending.json')
  .action(async (opts: { dryRun?: boolean }) => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const self = (envJson.userName as string | undefined) ?? ''
    const dryRun = !!opts.dryRun

    const { result: viewerResult, errorMessage: viewerErr } = await fetchGqlWithAuthRetry(
      envJsonPath,
      mattersApi,
      VIEWER_ID_QUERY,
    )
    if (viewerErr) {
      console.error('Failed to fetch viewer.id:', viewerErr)
      process.exit(1)
    }
    const selfId = ((viewerResult as { data?: { viewer?: { id?: string } } })?.data?.viewer?.id ?? '').trim()
    if (!selfId) {
      console.error('viewer.id missing')
      process.exit(1)
    }
    let selfDbId: string
    try {
      selfDbId = fromGlobalId(selfId).id
    } catch {
      console.error(`Failed to decode viewer.id: ${selfId}`)
      process.exit(1)
    }
    if (!selfDbId) {
      console.error(`viewer.id decoded to empty: ${selfId}`)
      process.exit(1)
    }

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
      const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, NOTICES_QUERY, {
        input,
        selfId: selfDbId,
      })
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

      if (dryRun) {
        for (const edge of edges) {
          console.log(
            `  scan: ${edge.node.id} @ ${edge.node.createdAt} __typename=${edge.node.__typename} type=${edge.node.type ?? edge.node.mentionType ?? '(none)'}`,
          )
        }
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
        const entry = toEntry(edge, self)
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

    if (dryRun) {
      console.log('--- reply-query dry-run (no write) ---')
      console.log(`isFirstRun: ${isFirstRun}`)
      console.log(`prev checkpoint: ${checkpointId ?? '(none)'} @ ${state.lastNoticeCreatedAt ?? '(none)'}`)
      console.log(
        `would-be checkpoint: ${firstNoticeId ?? checkpointId ?? '(none)'} @ ${firstNoticeCreatedAt ?? state.lastNoticeCreatedAt ?? '(none)'}`,
      )
      console.log(`would drop by TTL: ${droppedByTtl}`)
      console.log(`would append: ${newEntries.length} new entries`)
      for (const entry of newEntries) {
        console.log(
          `  - ${entry.replyId} by @${entry.replyAuthorUserName} on ${entry.articleId} (${entry.articleState})`,
        )
        console.log(`    reply (${entry.replyContent.length} chars): ${entry.replyContent.slice(0, 120)}`)
        console.log(`    parent: ${entry.parentCommentContent.slice(0, 120)}`)
      }
      return
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
