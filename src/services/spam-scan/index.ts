import fs from 'node:fs'
import path from 'node:path'

interface ChannelFeed {
  type: 'icymi' | 'hottest' | 'channel'
  shortHash?: string
}

interface SpamScanChannels {
  feeds: ChannelFeed[]
}

interface SpamScanStateEntry {
  articleId: string
  shortHash: string
  lastScannedAt: string
  spam: boolean
}

interface SpamScanState {
  articles: SpamScanStateEntry[]
}

interface AuthorRef {
  userName: string
  displayName: string
  userId: string
}

interface PendingCommentCW {
  uuid: string
  createdAt: string
}

interface PendingComment {
  commentId: string
  content: string
  author: AuthorRef
  depth: 'top' | 'reply'
  communityWatchAction: PendingCommentCW | null
}

interface PendingArticle {
  articleId: string
  shortHash: string
  title: string
  needsArticleJudgement: boolean
  content?: string
  author: AuthorRef
  comments: PendingComment[]
}

interface SpamPending {
  articles: PendingArticle[]
}

interface SpammerOccurrence {
  type: 'article' | 'comment'
  contentId: string
  shortHash: string
  foundAt: string
}

interface CommunityWatchHistory {
  seen: boolean
  lastUuid: string | null
  lastSeenAt: string | null
}

interface SpammerUser {
  displayName: string
  firstSeenAt: string
  lastSeenAt: string
  occurrences: SpammerOccurrence[]
  reported: boolean
  communityWatchHistory: CommunityWatchHistory
}

interface Spammers {
  users: Record<string, SpammerUser>
}

const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const OCCURRENCES_CAP = 10

const channelsPath = () => path.resolve(process.cwd(), 'spam-scan-channels.json')
const statePath = () => path.resolve(process.cwd(), 'spam-scan-state.json')
const pendingPath = () => path.resolve(process.cwd(), 'spam-pending.json')
const spammersPath = () => path.resolve(process.cwd(), 'spammers.json')

const readChannels = (): SpamScanChannels => {
  const p = channelsPath()
  if (!fs.existsSync(p)) {
    return { feeds: [] }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const readState = (): SpamScanState => {
  const p = statePath()
  if (!fs.existsSync(p)) {
    return { articles: [] }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const writeState = (data: SpamScanState) => {
  fs.writeFileSync(statePath(), JSON.stringify(data, null, 2))
}

const prunedState = (data: SpamScanState): SpamScanState => {
  const cutoff = Date.now() - STATE_TTL_MS
  return {
    articles: data.articles.filter((a) => {
      const ts = Date.parse(a.lastScannedAt)
      return Number.isFinite(ts) && ts >= cutoff
    }),
  }
}

const readPending = (): SpamPending => {
  const p = pendingPath()
  if (!fs.existsSync(p)) {
    return { articles: [] }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const writePending = (data: SpamPending) => {
  fs.writeFileSync(pendingPath(), JSON.stringify(data, null, 2))
}

const readSpammers = (): Spammers => {
  const p = spammersPath()
  if (!fs.existsSync(p)) {
    return { users: {} }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const writeSpammers = (data: Spammers) => {
  fs.writeFileSync(spammersPath(), JSON.stringify(data, null, 2))
}

const stripHtml = (html: string): string => {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const formatUnreportedReport = (users: Record<string, SpammerUser>): { text: string; userNames: string[] } => {
  const entries = Object.entries(users).filter(([, u]) => !u.reported)
  if (entries.length === 0) {
    return { text: '', userNames: [] }
  }
  const lines: string[] = []
  for (const [userName, user] of entries) {
    lines.push(`@${userName} (${user.displayName})`)
    lines.push(`  first: ${user.firstSeenAt}  last: ${user.lastSeenAt}  occurrences: ${user.occurrences.length}`)
    if (user.communityWatchHistory.seen) {
      lines.push(`  community watch: handled at ${user.communityWatchHistory.lastSeenAt}`)
    }
    for (const o of user.occurrences) {
      lines.push(`    ${o.foundAt}  ${o.type}  ${o.contentId}  shortHash=${o.shortHash}`)
    }
    lines.push('')
  }
  return { text: lines.join('\n').replace(/\n+$/, ''), userNames: entries.map(([n]) => n) }
}

export {
  channelsPath,
  formatUnreportedReport,
  OCCURRENCES_CAP,
  pendingPath,
  prunedState,
  readChannels,
  readPending,
  readSpammers,
  readState,
  spammersPath,
  STATE_TTL_MS,
  statePath,
  stripHtml,
  writePending,
  writeSpammers,
  writeState,
}
export type {
  AuthorRef,
  ChannelFeed,
  CommunityWatchHistory,
  PendingArticle,
  PendingComment,
  PendingCommentCW,
  SpammerOccurrence,
  Spammers,
  SpammerUser,
  SpamPending,
  SpamScanChannels,
  SpamScanState,
  SpamScanStateEntry,
}
