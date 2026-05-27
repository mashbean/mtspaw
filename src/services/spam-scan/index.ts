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
  parentCommentId?: string
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

interface SpamCandidateOccurrence {
  articleId: string
  shortHash: string
  title: string
  commentId: string
  parentCommentId?: string
  author: AuthorRef
  content: string
}

interface SpamCandidate {
  fingerprint: string
  articleSpread: number
  commentCount: number
  reason: 'repeated_comment'
  occurrences: SpamCandidateOccurrence[]
}

interface SpamCandidates {
  generatedAt: string
  minArticleSpread: number
  candidates: SpamCandidate[]
}

type CommunityWatchSpamReason = 'flood_advertising' | 'pornographic_advertising'

interface SpamCleanPlanItem {
  commentId: string
  parentCommentId?: string
  articleId: string
  shortHash: string
  title: string
  author: AuthorRef
  content: string
  fingerprint: string
  reason: CommunityWatchSpamReason
  reasonLabel: '濫發廣告' | '色情廣告'
}

interface SpamCleanPlan {
  generatedAt: string
  sourceGeneratedAt: string
  dryRunOnly: true
  items: SpamCleanPlanItem[]
}

type SpamCleanResultStatus = 'dry_run' | 'removed' | 'failed'

interface SpamCleanResultItem {
  commentId: string
  shortHash: string
  author: AuthorRef
  reason: CommunityWatchSpamReason
  status: SpamCleanResultStatus
  uuid?: string
  createdAt?: string
  error?: string
}

interface SpamCleanResult {
  generatedAt: string
  sourceGeneratedAt: string
  execute: boolean
  total: number
  removed: number
  failed: number
  dryRun: number
  items: SpamCleanResultItem[]
}

interface SpammerOccurrence {
  type: 'article' | 'comment'
  contentId: string
  shortHash: string
  foundAt: string
  parentCommentId?: string
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
const USERS_CAP = 100

const channelsPath = () => path.resolve(process.cwd(), 'spam-scan-channels.json')
const statePath = () => path.resolve(process.cwd(), 'spam-scan-state.json')
const pendingPath = () => path.resolve(process.cwd(), 'spam-pending.json')
const candidatesPath = () => path.resolve(process.cwd(), 'spam-candidates.json')
const cleanPlanPath = () => path.resolve(process.cwd(), 'spam-clean-plan.json')
const cleanResultPath = () => path.resolve(process.cwd(), 'spam-clean-result.json')
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

const writeCandidates = (data: SpamCandidates) => {
  fs.writeFileSync(candidatesPath(), JSON.stringify(data, null, 2))
}

const readCandidates = (): SpamCandidates => {
  const p = candidatesPath()
  if (!fs.existsSync(p)) {
    return { generatedAt: '', minArticleSpread: 3, candidates: [] }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const writeCleanPlan = (data: SpamCleanPlan) => {
  fs.writeFileSync(cleanPlanPath(), JSON.stringify(data, null, 2))
}

const readCleanPlan = (): SpamCleanPlan => {
  const p = cleanPlanPath()
  if (!fs.existsSync(p)) {
    return {
      generatedAt: '',
      sourceGeneratedAt: '',
      dryRunOnly: true,
      items: [],
    }
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

const writeCleanResult = (data: SpamCleanResult) => {
  fs.writeFileSync(cleanResultPath(), JSON.stringify(data, null, 2))
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

const MIN_MEANINGFUL_LENGTH = 5
const FIRST_PARTY_DOMAINS = new Set(['matters.town', 'matters.news', 'matters.icu'])

const isCommentBenign = (content: string): boolean => {
  const trimmed = content.trim()
  if (trimmed.length === 0) {
    return true
  }
  if (/https?:\/\//i.test(trimmed)) {
    return false
  }
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return true
  }
  const hasAlnum = /[a-zA-Z0-9]/.test(trimmed)
  const hasCJK = /[一-鿿぀-ヿ가-힯]/.test(trimmed)
  if (!hasAlnum && !hasCJK) {
    return true
  }
  return false
}

const stripHtml = (html: string): string => {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const inner = text.replace(/<[^>]+>/g, '').trim()
      return inner ? `${inner} (${href})` : href
    })
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

const normalizeDomain = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

const extractSignal = (content: string): string | null => {
  const normalized = content
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const urlMatch = normalized.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i)
  if (urlMatch) {
    const domain = normalizeDomain(urlMatch[0])
    if (domain && !FIRST_PARTY_DOMAINS.has(domain)) {
      return `domain:${domain}`
    }
  }

  const handleMatch = normalized.match(
    /(?:line|telegram|tg|whatsapp|微信|wechat|賴|line\s*id)[:：\s@-]*([a-z0-9_.-]{4,})/i,
  )
  if (handleMatch?.[1]) {
    return `contact:${handleMatch[1]}`
  }

  const compact = normalized.replace(/https?:\/\/[^\s)]+/g, '').replace(/[^\p{Letter}\p{Number}]+/gu, '')
  if (compact.length < 16) {
    return null
  }
  return `text:${compact.slice(0, 80)}`
}

const fingerprintComment = (comment: PendingComment): string | null => {
  const signal = extractSignal(comment.content)
  if (!signal) {
    return null
  }
  return `${comment.author.userName}:${signal}`
}

const buildSpamCandidates = (pending: SpamPending, minArticleSpread = 3): SpamCandidates => {
  const groups = new Map<string, SpamCandidateOccurrence[]>()

  for (const article of pending.articles) {
    for (const comment of article.comments) {
      if (comment.communityWatchAction) {
        continue
      }
      const fingerprint = fingerprintComment(comment)
      if (!fingerprint) {
        continue
      }
      const occurrence: SpamCandidateOccurrence = {
        articleId: article.articleId,
        shortHash: article.shortHash,
        title: article.title,
        commentId: comment.commentId,
        author: comment.author,
        content: comment.content,
      }
      if (comment.parentCommentId) {
        occurrence.parentCommentId = comment.parentCommentId
      }
      const existing = groups.get(fingerprint) ?? []
      existing.push(occurrence)
      groups.set(fingerprint, existing)
    }
  }

  const candidates = [...groups.entries()]
    .map(([fingerprint, occurrences]) => {
      const articleSpread = new Set(occurrences.map((o) => o.articleId)).size
      return {
        fingerprint,
        articleSpread,
        commentCount: occurrences.length,
        reason: 'repeated_comment' as const,
        occurrences,
      }
    })
    .filter((c) => c.articleSpread >= minArticleSpread)
    .sort((a, b) => b.articleSpread - a.articleSpread || b.commentCount - a.commentCount)

  return {
    generatedAt: new Date().toISOString(),
    minArticleSpread,
    candidates,
  }
}

const buildSpamCleanPlan = (source: SpamCandidates): SpamCleanPlan => {
  const seen = new Set<string>()
  const items: SpamCleanPlanItem[] = []

  for (const candidate of source.candidates) {
    for (const occurrence of candidate.occurrences) {
      if (seen.has(occurrence.commentId)) {
        continue
      }
      seen.add(occurrence.commentId)

      const item: SpamCleanPlanItem = {
        commentId: occurrence.commentId,
        articleId: occurrence.articleId,
        shortHash: occurrence.shortHash,
        title: occurrence.title,
        author: occurrence.author,
        content: occurrence.content,
        fingerprint: candidate.fingerprint,
        reason: 'flood_advertising',
        reasonLabel: '濫發廣告',
      }
      if (occurrence.parentCommentId) {
        item.parentCommentId = occurrence.parentCommentId
      }
      items.push(item)
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: source.generatedAt,
    dryRunOnly: true,
    items,
  }
}

const formatTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return ''
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

const formatOccurrence = (o: SpammerOccurrence): string => {
  const when = formatTime(o.foundAt)
  if (o.type === 'comment') {
    const fragment = o.parentCommentId ? `${o.parentCommentId}-${o.contentId}` : o.contentId
    const url = `https://matters.town/a/${o.shortHash}#${fragment}`
    return `${when}  評論  <${url}|${o.contentId}>`
  }
  const url = `https://matters.town/a/${o.shortHash}`
  return `${when}  文章  <${url}|${o.shortHash}>`
}

const formatUnreportedReport = (users: Record<string, SpammerUser>): { text: string; userNames: string[] } => {
  const entries = Object.entries(users).filter(([, u]) => !u.reported)
  if (entries.length === 0) {
    return { text: '', userNames: [] }
  }
  const lines: string[] = []
  for (const [userName, user] of entries) {
    lines.push(`<https://matters.town/@${userName}|@${userName}> (${user.displayName})`)
    const count = user.occurrences.length >= OCCURRENCES_CAP ? `${OCCURRENCES_CAP}+` : `${user.occurrences.length}`
    const cwMark = user.communityWatchHistory.seen ? '  守望相助檢舉過' : ''
    lines.push(`Spam 次數: ${count}${cwMark}`)
    const sorted = [...user.occurrences].sort((a, b) => Date.parse(b.foundAt) - Date.parse(a.foundAt))
    for (const o of sorted) {
      lines.push(formatOccurrence(o))
    }
    lines.push('')
  }
  return {
    text: lines.join('\n').replace(/\n+$/, ''),
    userNames: entries.map(([n]) => n),
  }
}

export {
  buildSpamCandidates,
  buildSpamCleanPlan,
  candidatesPath,
  channelsPath,
  cleanPlanPath,
  cleanResultPath,
  formatUnreportedReport,
  isCommentBenign,
  OCCURRENCES_CAP,
  pendingPath,
  prunedState,
  readCandidates,
  readChannels,
  readCleanPlan,
  readPending,
  readSpammers,
  readState,
  spammersPath,
  STATE_TTL_MS,
  statePath,
  stripHtml,
  USERS_CAP,
  writeCandidates,
  writeCleanPlan,
  writeCleanResult,
  writePending,
  writeSpammers,
  writeState,
}
export type {
  AuthorRef,
  ChannelFeed,
  CommunityWatchHistory,
  CommunityWatchSpamReason,
  PendingArticle,
  PendingComment,
  PendingCommentCW,
  SpamCandidate,
  SpamCandidateOccurrence,
  SpamCandidates,
  SpamCleanPlan,
  SpamCleanPlanItem,
  SpamCleanResult,
  SpamCleanResultItem,
  SpamCleanResultStatus,
  SpammerOccurrence,
  Spammers,
  SpammerUser,
  SpamPending,
  SpamScanChannels,
  SpamScanState,
  SpamScanStateEntry,
}
