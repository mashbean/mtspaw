import { input } from '@inquirer/prompts'
import { Command } from 'commander'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import type {
  AuthorRef,
  ChannelFeed,
  PendingArticle,
  PendingComment,
  PendingCommentCW,
  SpammerOccurrence,
  Spammers,
  SpamPending,
  SpamScanState,
} from '../../services/spam-scan/index.js'
import {
  OCCURRENCES_CAP,
  prunedState,
  readChannels,
  readSpammers,
  readState,
  stripHtml,
  writePending,
  writeSpammers,
  writeState,
} from '../../services/spam-scan/index.js'

const PER_FEED_ARTICLE_COUNT = 10
const TOP_LEVEL_COMMENT_COUNT = 5
const NESTED_COMMENT_COUNT = 5

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
  const edges = (result as { data?: { viewer?: { recommendation?: { icymi?: { edges?: { node: RawArticle }[] } } } } })
    ?.data?.viewer?.recommendation?.icymi?.edges
  return edges?.map((e) => e.node) ?? []
}

const articleEdgesFromHottest = (result: unknown): RawArticle[] => {
  const edges = (
    result as { data?: { viewer?: { recommendation?: { hottest?: { edges?: { node: RawArticle }[] } } } } }
  )?.data?.viewer?.recommendation?.hottest?.edges
  return edges?.map((e) => e.node) ?? []
}

const articleEdgesFromChannel = (result: unknown): RawArticle[] => {
  const edges = (result as { data?: { channel?: { articles?: { edges?: { node: RawArticle }[] } } } })?.data?.channel
    ?.articles?.edges
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
      articlesInput: { first: PER_FEED_ARTICLE_COUNT, sort: 'newest' },
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
  articleId: string,
  cwSupported: boolean,
): Promise<FetchCommentsResult> => {
  const query = buildArticleCommentsQuery(cwSupported)
  const { result, errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, query, {
    input: { id: articleId },
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
    console.error(`article ${articleId} comments failed: ${errorMessage}`)
    return { comments: [], cwUnsupported: false }
  }

  const edges = (result as { data?: { article?: { comments?: { edges?: { node: RawComment }[] } } } })?.data?.article
    ?.comments?.edges
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
      out.push({
        commentId: top.id,
        content: stripHtml(top.content ?? ''),
        author,
        depth: 'top',
        communityWatchAction: top.communityWatchAction ?? null,
      })
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
        out.push({
          commentId: nested.id,
          content: stripHtml(nested.content ?? ''),
          author: nestedAuthor,
          depth: 'reply',
          communityWatchAction: nested.communityWatchAction ?? null,
        })
      }
    }
  }
  return out
}

const queryCommand = new Command('query')
  .description('Fetch articles and comments from configured feeds into spam-pending.json')
  .action(async () => {
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
    let cwSupported = true

    for (const feed of channels.feeds) {
      const articles = await fetchFeedArticles(envJsonPath, mattersApi, feed)
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

        let fetched = await fetchArticleComments(envJsonPath, mattersApi, article.id, cwSupported)
        if (fetched.cwUnsupported) {
          cwSupported = false
          console.log('communityWatchAction field unsupported, retrying without it')
          fetched = await fetchArticleComments(envJsonPath, mattersApi, article.id, false)
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
  .action(
    async (opts: {
      userName?: string
      displayName?: string
      type?: string
      contentId?: string
      shortHash?: string
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

      const spammers: Spammers = readSpammers()
      const existing = spammers.users[userName]
      if (existing) {
        existing.displayName = displayName || existing.displayName
        existing.lastSeenAt = now
        existing.occurrences.push(occurrence)
        if (existing.occurrences.length > OCCURRENCES_CAP) {
          existing.occurrences = existing.occurrences.slice(-OCCURRENCES_CAP)
        }
      } else {
        spammers.users[userName] = {
          displayName,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: [occurrence],
          reported: false,
          communityWatchHistory: { seen: false, lastUuid: null, lastSeenAt: null },
        }
      }

      writeSpammers(spammers)
      console.log(`recorded ${type} occurrence for @${userName}`)
    },
  )

const markScannedCommand = new Command('mark-scanned')
  .description('Upsert article into spam-scan-state.json and prune stale entries')
  .option('--articleId <id>', 'Article id')
  .option('--spam', 'Mark as spam (will be permanently skipped within TTL)')
  .action(async (opts: { articleId?: string; spam?: boolean }) => {
    const articleId = requireFlag(opts.articleId, '--articleId')
    const spam = !!opts.spam
    const now = new Date().toISOString()

    const state = prunedState(readState())
    const idx = state.articles.findIndex((a) => a.articleId === articleId)
    if (idx >= 0) {
      state.articles[idx] = { articleId, lastScannedAt: now, spam }
    } else {
      state.articles.push({ articleId, lastScannedAt: now, spam })
    }

    writeState(state)
    console.log(`mark-scanned ${articleId}${spam ? ' (spam)' : ''}`)
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
    user.communityWatchHistory = { seen: true, lastUuid: uuid, lastSeenAt: createdAt }
    writeSpammers(spammers)
    console.log(`note-cw: updated CW history for @${userName}`)
  })

const formatOccurrences = (occ: SpammerOccurrence[]): string => {
  return occ.map((o) => `    ${o.foundAt}  ${o.type}  ${o.contentId}  shortHash=${o.shortHash}`).join('\n')
}

const listUnreportedCommand = new Command('list-unreported')
  .description('Print all unreported spammers as plain text for downstream notifications')
  .action(() => {
    const spammers = readSpammers()
    const entries = Object.entries(spammers.users).filter(([, u]) => !u.reported)
    if (entries.length === 0) {
      console.log('No unreported spammers.')
      return
    }
    for (const [userName, user] of entries) {
      console.log(`@${userName} (${user.displayName})`)
      console.log(`  first: ${user.firstSeenAt}  last: ${user.lastSeenAt}  occurrences: ${user.occurrences.length}`)
      if (user.communityWatchHistory.seen) {
        console.log(`  community watch: handled at ${user.communityWatchHistory.lastSeenAt}`)
      }
      console.log(formatOccurrences(user.occurrences))
      console.log('')
    }
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
spamScanCommand.addCommand(noteCwCommand)
spamScanCommand.addCommand(listUnreportedCommand)
spamScanCommand.addCommand(markReportedCommand)

export { spamScanCommand }
