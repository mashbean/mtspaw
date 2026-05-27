import { input } from '@inquirer/prompts'
import { Command } from 'commander'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import { delay, fetchGql, formatGqlErrors } from '../../services/gql/index.js'
import type {
  AuthorRef,
  ChannelFeed,
  PendingArticle,
  PendingComment,
  PendingCommentCW,
  SpamCleanResult,
  SpamCleanResultItem,
  SpammerOccurrence,
  Spammers,
  SpamPending,
  SpamScanState,
} from '../../services/spam-scan/index.js'
import {
  buildSpamCandidates,
  buildSpamCleanPlan,
  formatUnreportedReport,
  isCommentBenign,
  OCCURRENCES_CAP,
  prunedState,
  readCandidates,
  readChannels,
  readCleanPlan,
  readPending,
  readSpammers,
  readState,
  stripHtml,
  USERS_CAP,
  writeCandidates,
  writeCleanPlan,
  writeCleanResult,
  writePending,
  writeSpammers,
  writeState,
} from '../../services/spam-scan/index.js'

const PER_FEED_ARTICLE_COUNT = 10
const TOP_LEVEL_COMMENT_COUNT = 3
const NESTED_COMMENT_COUNT = 3

const ICYMI_QUERY = `
  query SpamScanIcymi($input: ConnectionArgs!) {
    viewer {
      recommendation {
        icymi(input: $input) {
          edges {
            node {
              id
              shortHash
              title
              state
              author { id userName displayName }
              contents { html }
            }
          }
        }
      }
    }
  }
`

const HOTTEST_QUERY = `
  query SpamScanHottest($input: RecommendInput!) {
    viewer {
      recommendation {
        hottest(input: $input) {
          edges {
            node {
              id
              shortHash
              title
              state
              author { id userName displayName }
              contents { html }
            }
          }
        }
      }
    }
  }
`

const CHANNEL_QUERY = `
  query SpamScanChannel($input: ChannelInput!, $articlesInput: ChannelArticlesInput!) {
    channel(input: $input) {
      __typename
      ... on TopicChannel {
        articles(input: $articlesInput) {
          edges {
            node {
              id
              shortHash
              title
              state
              author { id userName displayName }
              contents { html }
            }
          }
        }
      }
      ... on CurationChannel {
        articles(input: $articlesInput) {
          edges {
            node {
              id
              shortHash
              title
              state
              author { id userName displayName }
              contents { html }
            }
          }
        }
      }
    }
  }
`

const USER_STATE_QUERY = `
  query SpamScanUserState($input: UserInput!) {
    user(input: $input) {
      status { state }
    }
  }
`

const COMMUNITY_WATCH_REMOVE_COMMENT_MUTATION = `
  mutation SpamScanCommunityWatchRemoveComment($input: CommunityWatchRemoveCommentInput!) {
    communityWatchRemoveComment(input: $input) {
      id
      state
      communityWatchAction {
        uuid
        createdAt
      }
    }
  }
`

const buildArticleCommentsQuery = (withCW: boolean) => {
  const cwSelection = withCW ? 'communityWatchAction { uuid createdAt }' : ''
  return `
    query SpamScanArticleComments(
      $input: ArticleInput!
      $topInput: CommentsInput!
      $nestedInput: CommentCommentsInput!
    ) {
      article(input: $input) {
        comments(input: $topInput) {
          edges {
            node {
              id
              state
              content
              createdAt
              author { id userName displayName }
              ${cwSelection}
              comments(input: $nestedInput) {
                edges {
                  node {
                    id
                    state
                    content
                    createdAt
                    author { id userName displayName }
                    ${cwSelection}
                  }
                }
              }
            }
          }
        }
      }
    }
  `
}

interface RawArticle {
  id: string
  shortHash: string
  title: string
  state: string
  author?: { id: string; userName: string; displayName: string } | null
  contents?: { html: string } | null
}

interface RawComment {
  id: string
  state: string
  content?: string | null
  createdAt: string
  author?: { id: string; userName: string; displayName: string } | null
  communityWatchAction?: PendingCommentCW | null
  comments?: { edges?: { node: RawComment }[] | null } | null
}

const errorMentionsCw = (msg: string | null | undefined): boolean => {
  return !!msg && msg.toLowerCase().includes('communitywatchaction')
}

const articleEdgesFromIcymi = (result: unknown): RawArticle[] => {
  const edges = (
    result as {
      data?: {
        viewer?: {
          recommendation?: { icymi?: { edges?: { node: RawArticle }[] } }
        }
      }
    }
  )?.data?.viewer?.recommendation?.icymi?.edges
  return edges?.map((e) => e.node) ?? []
}

const articleEdgesFromHottest = (result: unknown): RawArticle[] => {
  const edges = (
    result as {
      data?: {
        viewer?: {
          recommendation?: { hottest?: { edges?: { node: RawArticle }[] } }
        }
      }
    }
  )?.data?.viewer?.recommendation?.hottest?.edges
  return edges?.map((e) => e.node) ?? []
}

const articleEdgesFromChannel = (result: unknown): RawArticle[] => {
  const edges = (
    result as {
      data?: { channel?: { articles?: { edges?: { node: RawArticle }[] } } }
    }
  )?.data?.channel?.articles?.edges
  return edges?.map((e) => e.node) ?? []
}

const fetchFeedArticles = async (envJsonPath: string, mattersApi: string, feed: ChannelFeed): Promise<RawArticle[]> => {
  if (feed.type === 'icymi') {
    const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, ICYMI_QUERY, {
      input: { first: PER_FEED_ARTICLE_COUNT },
    })
    if (errorMessage) {
      console.error(`feed icymi failed: ${errorMessage}`)
      return []
    }
    return articleEdgesFromIcymi(result)
  }
  if (feed.type === 'hottest') {
    const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, HOTTEST_QUERY, {
      input: { first: PER_FEED_ARTICLE_COUNT },
    })
    if (errorMessage) {
      console.error(`feed hottest failed: ${errorMessage}`)
      return []
    }
    return articleEdgesFromHottest(result)
  }
  if (feed.type === 'channel' && feed.shortHash) {
    const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, CHANNEL_QUERY, {
      input: { shortHash: feed.shortHash },
      articlesInput: { first: PER_FEED_ARTICLE_COUNT },
    })
    if (errorMessage) {
      console.error(`feed channel ${feed.shortHash} failed: ${errorMessage}`)
      return []
    }
    return articleEdgesFromChannel(result)
  }
  console.error(`unknown feed config: ${JSON.stringify(feed)}`)
  return []
}

interface FetchCommentsResult {
  comments: RawComment[]
  cwUnsupported: boolean
}

const fetchArticleComments = async (
  envJsonPath: string,
  mattersApi: string,
  shortHash: string,
  cwSupported: boolean,
): Promise<FetchCommentsResult> => {
  const query = buildArticleCommentsQuery(cwSupported)
  const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, query, {
    input: { shortHash },
    topInput: {
      first: TOP_LEVEL_COMMENT_COUNT,
      sort: 'newest',
      filter: { parentComment: null, state: 'active' },
    },
    nestedInput: { first: NESTED_COMMENT_COUNT, sort: 'newest' },
  })

  if (errorMessage) {
    if (cwSupported && errorMentionsCw(errorMessage)) {
      return { comments: [], cwUnsupported: true }
    }
    console.error(`article ${shortHash} comments failed: ${errorMessage}`)
    return { comments: [], cwUnsupported: false }
  }

  const edges = (
    result as {
      data?: { article?: { comments?: { edges?: { node: RawComment }[] } } }
    }
  )?.data?.article?.comments?.edges
  return { comments: edges?.map((e) => e.node) ?? [], cwUnsupported: false }
}

const toAuthorRef = (author: RawComment['author'] | RawArticle['author']): AuthorRef | null => {
  if (!author?.userName) {
    return null
  }
  return {
    userName: author.userName,
    displayName: author.displayName ?? '',
    userId: author.id,
  }
}

const flattenComments = (raw: RawComment[], cutoffMs: number): PendingComment[] => {
  const out: PendingComment[] = []
  const addIf = (
    id: string,
    content: string,
    author: AuthorRef,
    depth: 'top' | 'reply',
    cw: PendingCommentCW | null,
    parentCommentId?: string,
  ) => {
    if (!cw && isCommentBenign(content)) {
      return
    }
    const entry: PendingComment = {
      commentId: id,
      content,
      author,
      depth,
      communityWatchAction: cw,
    }
    if (parentCommentId) {
      entry.parentCommentId = parentCommentId
    }
    out.push(entry)
  }
  for (const top of raw) {
    if (top.state !== 'active') {
      continue
    }
    const author = toAuthorRef(top.author)
    if (!author) {
      continue
    }
    const createdAtMs = Date.parse(top.createdAt)
    if (Number.isFinite(createdAtMs) && createdAtMs > cutoffMs) {
      addIf(top.id, stripHtml(top.content ?? ''), author, 'top', top.communityWatchAction ?? null)
    }
    const nestedEdges = top.comments?.edges ?? []
    for (const edge of nestedEdges) {
      const nested = edge.node
      if (nested.state !== 'active') {
        continue
      }
      const nestedAuthor = toAuthorRef(nested.author)
      if (!nestedAuthor) {
        continue
      }
      const nestedCreatedMs = Date.parse(nested.createdAt)
      if (Number.isFinite(nestedCreatedMs) && nestedCreatedMs > cutoffMs) {
        addIf(
          nested.id,
          stripHtml(nested.content ?? ''),
          nestedAuthor,
          'reply',
          nested.communityWatchAction ?? null,
          top.id,
        )
      }
    }
  }
  return out
}

const feedLabel = (feed: ChannelFeed): string => {
  if (feed.type === 'channel') {
    return `channel(${feed.shortHash ?? '?'})`
  }
  return feed.type
}

const queryCommand = new Command('query')
  .description('Fetch articles and comments from configured feeds into spam-pending.json')
  .option('--dry-run', 'Fetch and print would-be enqueue summary; do not write spam-pending.json')
  .action(async (opts: { dryRun?: boolean }) => {
    const dryRun = !!opts.dryRun
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)

    const channels = readChannels()
    if (channels.feeds.length === 0) {
      console.error('No feeds configured in spam-scan-channels.json')
      process.exit(1)
    }

    const state: SpamScanState = prunedState(readState())
    const stateById = new Map(state.articles.map((a) => [a.articleId, a]))

    const pending: SpamPending = { articles: [] }
    const seenArticleIds = new Set<string>()
    const perFeedCounts: { label: string; count: number }[] = []
    let cwSupported = true

    for (const feed of channels.feeds) {
      const articles = await fetchFeedArticles(envJsonPath, mattersApi, feed)
      perFeedCounts.push({ label: feedLabel(feed), count: articles.length })
      for (const article of articles) {
        if (seenArticleIds.has(article.id)) {
          continue
        }
        seenArticleIds.add(article.id)
        if (article.state !== 'active') {
          continue
        }

        const entry = stateById.get(article.id)
        if (entry?.spam) {
          continue
        }

        const needsArticleJudgement = !entry
        const cutoffMs = entry ? Date.parse(entry.lastScannedAt) : 0

        let fetched = await fetchArticleComments(envJsonPath, mattersApi, article.shortHash, cwSupported)
        if (fetched.cwUnsupported) {
          cwSupported = false
          console.log('communityWatchAction field unsupported, retrying without it')
          fetched = await fetchArticleComments(envJsonPath, mattersApi, article.shortHash, false)
        }

        const comments = flattenComments(fetched.comments, Number.isFinite(cutoffMs) ? cutoffMs : 0)
        const author = toAuthorRef(article.author)
        if (!author) {
          continue
        }

        const pendingArticle: PendingArticle = {
          articleId: article.id,
          shortHash: article.shortHash,
          title: article.title,
          needsArticleJudgement,
          author,
          comments,
        }
        if (needsArticleJudgement) {
          pendingArticle.content = stripHtml(article.contents?.html ?? '')
        }
        pending.articles.push(pendingArticle)
      }
    }

    if (dryRun) {
      console.log('--- spam-scan query dry-run (no write) ---')
      console.log(`cwSupported: ${cwSupported}`)
      console.log('per-feed articles fetched:')
      for (const f of perFeedCounts) {
        console.log(`  - ${f.label}: ${f.count}`)
      }
      console.log(`would enqueue: ${pending.articles.length} articles`)
      for (const a of pending.articles) {
        const title = a.title.length > 80 ? `${a.title.slice(0, 80)}...` : a.title
        console.log(`  - ${a.articleId} shortHash=${a.shortHash} title=${title}`)
        console.log(`    needsArticleJudgement: ${a.needsArticleJudgement}  comments: ${a.comments.length}`)
      }
      return
    }

    writePending(pending)
    console.log(`spam-scan query: ${pending.articles.length} articles enqueued`)
  })

const requireFlag = (value: string | undefined, label: string): string => {
  if (!value || !value.trim()) {
    console.error(`${label} is required`)
    process.exit(1)
  }
  return value
}

const recordCommand = new Command('record')
  .description('Append a spammer occurrence to spammers.json')
  .option('--userName <name>', 'Spammer userName')
  .option('--displayName <name>', 'Spammer displayName')
  .option('--type <type>', 'Occurrence type: article or comment')
  .option('--contentId <id>', 'Article id or comment id')
  .option('--shortHash <hash>', 'Article short hash (for article or comment occurrence)')
  .option('--parentCommentId <id>', 'Parent comment id (for nested reply comments only)')
  .action(
    async (opts: {
      userName?: string
      displayName?: string
      type?: string
      contentId?: string
      shortHash?: string
      parentCommentId?: string
    }) => {
      const userName = requireFlag(opts.userName, '--userName')
      const displayName = opts.displayName ?? ''
      const type = requireFlag(opts.type, '--type')
      if (type !== 'article' && type !== 'comment') {
        console.error('--type must be article or comment')
        process.exit(1)
      }
      const contentId = requireFlag(opts.contentId, '--contentId')
      const shortHash = requireFlag(opts.shortHash, '--shortHash')

      const now = new Date().toISOString()
      const occurrence: SpammerOccurrence = {
        type: type as 'article' | 'comment',
        contentId,
        shortHash,
        foundAt: now,
      }
      if (type === 'comment' && opts.parentCommentId?.trim()) {
        occurrence.parentCommentId = opts.parentCommentId.trim()
      }

      const spammers: Spammers = readSpammers()
      const existing = spammers.users[userName]
      if (existing) {
        existing.displayName = displayName || existing.displayName
        existing.lastSeenAt = now
        existing.occurrences.push(occurrence)
        if (existing.occurrences.length > OCCURRENCES_CAP) {
          existing.occurrences = existing.occurrences.slice(-OCCURRENCES_CAP)
        }
        existing.reported = false
      } else {
        spammers.users[userName] = {
          displayName,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: [occurrence],
          reported: false,
          communityWatchHistory: {
            seen: false,
            lastUuid: null,
            lastSeenAt: null,
          },
        }
        const names = Object.keys(spammers.users)
        if (names.length > USERS_CAP) {
          const sortedByLastSeen = [...names].sort(
            (a, b) => Date.parse(spammers.users[a].lastSeenAt) - Date.parse(spammers.users[b].lastSeenAt),
          )
          const toEvict = sortedByLastSeen.slice(0, names.length - USERS_CAP)
          for (const name of toEvict) {
            delete spammers.users[name]
          }
        }
      }

      writeSpammers(spammers)
      console.log(`recorded ${type} occurrence for @${userName}`)
    },
  )

const markScannedCommand = new Command('mark-scanned')
  .description('Upsert article into spam-scan-state.json and prune stale entries')
  .option('--articleId <id>', 'Article id')
  .option('--shortHash <hash>', 'Article short hash')
  .option('--spam', 'Mark as spam (will be permanently skipped within TTL)')
  .action(async (opts: { articleId?: string; shortHash?: string; spam?: boolean }) => {
    const articleId = requireFlag(opts.articleId, '--articleId')
    const shortHash = requireFlag(opts.shortHash, '--shortHash')
    const spam = !!opts.spam
    const now = new Date().toISOString()

    const state = prunedState(readState())
    const idx = state.articles.findIndex((a) => a.articleId === articleId)
    if (idx >= 0) {
      state.articles[idx] = {
        articleId,
        shortHash,
        lastScannedAt: now,
        spam,
      }
    } else {
      state.articles.push({ articleId, shortHash, lastScannedAt: now, spam })
    }

    writeState(state)
    console.log(`mark-scanned ${articleId}${spam ? ' (spam)' : ''}`)
  })

const clusterCommand = new Command('cluster')
  .description('Build repeated spam comment candidates from spam-pending.json')
  .option('--minArticleSpread <number>', 'Minimum number of different articles hit by the same pattern', '3')
  .option('--dry-run', 'Print candidate summary without writing spam-candidates.json')
  .action(async (opts: { minArticleSpread?: string; dryRun?: boolean }) => {
    const minArticleSpread = Number(opts.minArticleSpread)
    if (!Number.isInteger(minArticleSpread) || minArticleSpread < 2) {
      console.error('--minArticleSpread must be an integer >= 2')
      process.exit(1)
    }

    const pending = readPending()
    const result = buildSpamCandidates(pending, minArticleSpread)

    console.log(
      `spam-scan cluster: ${result.candidates.length} candidates (minArticleSpread=${result.minArticleSpread})`,
    )
    for (const candidate of result.candidates) {
      const first = candidate.occurrences[0]
      console.log(
        `- ${candidate.fingerprint} articles=${candidate.articleSpread} comments=${candidate.commentCount} author=@${first.author.userName}`,
      )
      for (const occurrence of candidate.occurrences.slice(0, 3)) {
        console.log(`  ${occurrence.shortHash} ${occurrence.commentId}`)
      }
    }

    if (!opts.dryRun) {
      writeCandidates(result)
    }
  })

const planCleanCommand = new Command('plan-clean')
  .description('Build a dry-run community-watch clean plan from spam-candidates.json')
  .action(async () => {
    const candidates = readCandidates()
    const plan = buildSpamCleanPlan(candidates)

    console.log(`spam-scan plan-clean: ${plan.items.length} comments planned (dry-run only)`)
    for (const item of plan.items.slice(0, 20)) {
      console.log(`- ${item.reasonLabel} ${item.shortHash} ${item.commentId} @${item.author.userName}`)
    }
    if (plan.items.length > 20) {
      console.log(`... ${plan.items.length - 20} more`)
    }

    writeCleanPlan(plan)
  })

const COMMUNITY_WATCH_REMOVE_INTERVAL_MS = 1000

type CommunityWatchRemoveReason = 'porn_ad' | 'spam_ad'

const toCommunityWatchRemoveReason = (reason: string): CommunityWatchRemoveReason => {
  return reason === 'pornographic_advertising' ? 'porn_ad' : 'spam_ad'
}

const parsePositiveInteger = (value: string | undefined, label: string): number | null => {
  if (value === undefined) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${label} must be a positive integer`)
    process.exit(1)
  }
  return parsed
}

const submitCleanCommand = new Command('submit-clean')
  .description('Submit spam-clean-plan.json through communityWatchRemoveComment')
  .option('--execute', 'Actually remove comments; without this flag only writes a dry-run result')
  .option('--limit <number>', 'Submit at most this many plan items')
  .option('--intervalMs <number>', 'Delay between Community Watch mutations', `${COMMUNITY_WATCH_REMOVE_INTERVAL_MS}`)
  .action(async (opts: { execute?: boolean; limit?: string; intervalMs?: string }) => {
    const execute = !!opts.execute
    const limit = parsePositiveInteger(opts.limit, '--limit')
    const intervalMs = parsePositiveInteger(opts.intervalMs, '--intervalMs') ?? COMMUNITY_WATCH_REMOVE_INTERVAL_MS
    const cleanPlan = readCleanPlan()
    const items = limit ? cleanPlan.items.slice(0, limit) : cleanPlan.items
    if (items.length === 0) {
      const result: SpamCleanResult = {
        generatedAt: new Date().toISOString(),
        sourceGeneratedAt: cleanPlan.sourceGeneratedAt,
        execute,
        total: 0,
        removed: 0,
        failed: 0,
        dryRun: 0,
        items: [],
      }
      writeCleanResult(result)
      console.log('spam-scan submit-clean: no comments planned')
      return
    }

    if (!execute) {
      const resultItems: SpamCleanResultItem[] = items.map((item) => ({
        commentId: item.commentId,
        shortHash: item.shortHash,
        author: item.author,
        reason: item.reason,
        status: 'dry_run',
      }))
      writeCleanResult({
        generatedAt: new Date().toISOString(),
        sourceGeneratedAt: cleanPlan.sourceGeneratedAt,
        execute: false,
        total: resultItems.length,
        removed: 0,
        failed: 0,
        dryRun: resultItems.length,
        items: resultItems,
      })
      console.log(
        `spam-scan submit-clean dry-run: ${resultItems.length} comments planned; rerun with --execute to remove`,
      )
      return
    }

    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const resultItems: SpamCleanResultItem[] = []

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (i > 0) {
        await delay(intervalMs)
      }
      const { result, errorMessage } = await fetchGqlWithAuthRetry(
        envJsonPath,
        mattersApi,
        COMMUNITY_WATCH_REMOVE_COMMENT_MUTATION,
        {
          input: {
            id: item.commentId,
            reason: toCommunityWatchRemoveReason(item.reason),
          },
        },
      )
      if (errorMessage) {
        resultItems.push({
          commentId: item.commentId,
          shortHash: item.shortHash,
          author: item.author,
          reason: item.reason,
          status: 'failed',
          error: errorMessage,
        })
        console.error(`submit-clean failed: ${item.shortHash} ${item.commentId}: ${errorMessage}`)
        continue
      }
      const action = (
        result as {
          data?: {
            communityWatchRemoveComment?: {
              communityWatchAction?: {
                uuid?: string
                createdAt?: string
              } | null
            }
          }
        }
      )?.data?.communityWatchRemoveComment?.communityWatchAction
      resultItems.push({
        commentId: item.commentId,
        shortHash: item.shortHash,
        author: item.author,
        reason: item.reason,
        status: 'removed',
        uuid: action?.uuid,
        createdAt: action?.createdAt,
      })
    }

    const removed = resultItems.filter((item) => item.status === 'removed').length
    const failed = resultItems.filter((item) => item.status === 'failed').length
    writeCleanResult({
      generatedAt: new Date().toISOString(),
      sourceGeneratedAt: cleanPlan.sourceGeneratedAt,
      execute: true,
      total: resultItems.length,
      removed,
      failed,
      dryRun: 0,
      items: resultItems,
    })
    console.log(`spam-scan submit-clean: removed ${removed}, failed ${failed}`)
    if (failed > 0) {
      process.exit(1)
    }
  })

const noteCwCommand = new Command('note-cw')
  .description('Update communityWatchHistory on existing spammer; no-op when user not in roster')
  .option('--userName <name>', 'Spammer userName')
  .option('--uuid <uuid>', 'Community watch action uuid')
  .option('--createdAt <iso>', 'Community watch action createdAt ISO timestamp')
  .action(async (opts: { userName?: string; uuid?: string; createdAt?: string }) => {
    const userName = requireFlag(opts.userName, '--userName')
    const uuid = requireFlag(opts.uuid, '--uuid')
    const createdAt = requireFlag(opts.createdAt, '--createdAt')

    const spammers = readSpammers()
    const user = spammers.users[userName]
    if (!user) {
      console.log(`note-cw: ${userName} not in roster, no-op`)
      return
    }
    user.communityWatchHistory = {
      seen: true,
      lastUuid: uuid,
      lastSeenAt: createdAt,
    }
    writeSpammers(spammers)
    console.log(`note-cw: updated CW history for @${userName}`)
  })

const listUnreportedCommand = new Command('list-unreported')
  .description('Print all unreported spammers as plain text for downstream notifications')
  .action(() => {
    const spammers = readSpammers()
    const { text, userNames } = formatUnreportedReport(spammers.users)
    if (userNames.length === 0) {
      console.log('No unreported spammers.')
      return
    }
    console.log(text)
  })

const USER_LOOKUP_INTERVAL_MS = 1000

interface UserStateResult {
  found: boolean
  state: 'active' | 'banned' | 'archived' | 'frozen' | null
  errorMessage: string | null
}

const fetchUserState = async (mattersApi: string, userName: string): Promise<UserStateResult> => {
  const result = (await fetchGql(mattersApi, USER_STATE_QUERY, {
    input: { userName },
  })) as {
    data?: {
      user?: {
        status?: { state?: 'active' | 'banned' | 'archived' | 'frozen' }
      } | null
    }
    errors?: { message: string }[]
  }
  const errorMessage = formatGqlErrors(result)
  if (errorMessage) {
    return { found: false, state: null, errorMessage }
  }
  const user = result.data?.user
  if (!user) {
    return { found: false, state: null, errorMessage: null }
  }
  return { found: true, state: user.status?.state ?? null, errorMessage: null }
}

const cleanupCommand = new Command('cleanup')
  .description('Remove archived/banned/missing spammers from spammers.json by checking matters API')
  .action(async () => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)

    const spammers = readSpammers()
    const userNames = Object.keys(spammers.users)
    if (userNames.length === 0) {
      console.log('cleanup: roster is empty, nothing to check')
      return
    }

    let kept = 0
    let archived = 0
    let banned = 0
    let missing = 0
    let errored = 0

    for (let i = 0; i < userNames.length; i += 1) {
      const userName = userNames[i]
      if (i > 0) {
        await delay(USER_LOOKUP_INTERVAL_MS)
      }
      const result = await fetchUserState(mattersApi, userName)
      if (result.errorMessage) {
        console.error(`cleanup: @${userName} lookup failed: ${result.errorMessage}`)
        errored += 1
        continue
      }
      if (!result.found) {
        delete spammers.users[userName]
        missing += 1
        continue
      }
      if (result.state === 'archived') {
        delete spammers.users[userName]
        archived += 1
        continue
      }
      if (result.state === 'banned') {
        delete spammers.users[userName]
        banned += 1
        continue
      }
      kept += 1
    }

    const removed = archived + banned + missing
    if (removed > 0) {
      writeSpammers(spammers)
    }
    console.log(
      `cleanup: kept ${kept}, removed ${removed} (archived: ${archived}, banned: ${banned}, missing: ${missing}), errors: ${errored}`,
    )
  })

const SLACK_API = 'https://slack.com/api/chat.postMessage'

interface SlackConfig {
  token: string
  channel: string
}

const requireSlackConfig = (envJson: Record<string, unknown>): SlackConfig => {
  const slack = envJson.slack as { token?: unknown; channel?: unknown } | undefined
  const token = typeof slack?.token === 'string' ? slack.token.trim() : ''
  const channel = typeof slack?.channel === 'string' ? slack.channel.trim() : ''
  if (!token) {
    console.error('slack.token is required in env.json')
    process.exit(1)
  }
  if (!channel) {
    console.error('slack.channel is required in env.json')
    process.exit(1)
  }
  return { token, channel }
}

const postSlackMessage = async (config: SlackConfig, text: string): Promise<{ ok: boolean; error: string | null }> => {
  const res = await fetch(SLACK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({ channel: config.channel, text }),
  })
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
  }
  const body = (await res.json()) as { ok?: boolean; error?: string }
  if (!body.ok) {
    return { ok: false, error: body.error ?? 'unknown slack error' }
  }
  return { ok: true, error: null }
}

const reportCommand = new Command('report')
  .description('Send unreported spammers to Slack and mark them reported on success')
  .action(async () => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const slack = requireSlackConfig(envJson)

    const spammers = readSpammers()
    const { text, userNames } = formatUnreportedReport(spammers.users)
    if (userNames.length === 0) {
      console.log('no unreported spammers, skipped')
      return
    }

    const result = await postSlackMessage(slack, text)
    if (!result.ok) {
      console.error(`slack send failed: ${result.error}`)
      process.exit(1)
    }

    const fresh = readSpammers()
    for (const name of userNames) {
      const u = fresh.users[name]
      if (u) {
        u.reported = true
      }
    }
    writeSpammers(fresh)
    console.log(`report: sent ${userNames.length} entries, flipped reported`)
  })

const markReportedCommand = new Command('mark-reported')
  .description('Flip reported=true on one user (--userName) or all unreported (--all)')
  .option('--userName <name>', 'Spammer userName')
  .option('--all', 'Mark all unreported as reported')
  .action(async (opts: { userName?: string; all?: boolean }) => {
    const spammers = readSpammers()

    if (opts.all) {
      let count = 0
      for (const user of Object.values(spammers.users)) {
        if (!user.reported) {
          user.reported = true
          count += 1
        }
      }
      writeSpammers(spammers)
      console.log(`mark-reported: flipped ${count} entries`)
      return
    }

    const userName =
      opts.userName ??
      (await input({
        message: 'Spammer userName:',
        validate: (val) => (val.trim() ? true : 'userName is required'),
      }))

    const user = spammers.users[userName]
    if (!user) {
      console.error(`user not found: ${userName}`)
      process.exit(1)
    }
    user.reported = true
    writeSpammers(spammers)
    console.log(`mark-reported: ${userName}`)
  })

const spamScanCommand = new Command('spam-scan').description('Spam article and comment patrol')

spamScanCommand.addCommand(queryCommand)
spamScanCommand.addCommand(recordCommand)
spamScanCommand.addCommand(markScannedCommand)
spamScanCommand.addCommand(clusterCommand)
spamScanCommand.addCommand(planCleanCommand)
spamScanCommand.addCommand(submitCleanCommand)
spamScanCommand.addCommand(noteCwCommand)
spamScanCommand.addCommand(listUnreportedCommand)
spamScanCommand.addCommand(markReportedCommand)
spamScanCommand.addCommand(reportCommand)
spamScanCommand.addCommand(cleanupCommand)

export {
  buildArticleCommentsQuery,
  CHANNEL_QUERY,
  COMMUNITY_WATCH_REMOVE_COMMENT_MUTATION,
  HOTTEST_QUERY,
  ICYMI_QUERY,
  spamScanCommand,
  USER_STATE_QUERY,
}
