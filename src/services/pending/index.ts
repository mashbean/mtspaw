import fs from 'node:fs'
import path from 'node:path'

interface PendingArticle {
  articleId: string
  articleDbId: number
  shortHash: string
  eventIds: string[]
  channelIds: string[]
}

interface PendingJson {
  articles: PendingArticle[]
  articleLast: number
}

const getPendingJsonPath = () => path.resolve(process.cwd(), 'pending.json')

const readPendingJson = (): PendingJson => {
  const pendingJsonPath = getPendingJsonPath()
  if (!fs.existsSync(pendingJsonPath)) {
    return { articles: [], articleLast: 0 }
  }
  return JSON.parse(fs.readFileSync(pendingJsonPath, 'utf-8'))
}

const writePendingJson = (pendingJson: PendingJson) => {
  fs.writeFileSync(getPendingJsonPath(), JSON.stringify(pendingJson, null, 2))
}

const decodeArticleDbId = (articleId: string): number => {
  const decoded = Buffer.from(articleId, 'base64').toString('utf-8')
  const match = decoded.match(/(\d+)$/)
  if (!match) {
    throw new Error(`Cannot decode DB id from article id: ${articleId}`)
  }
  return parseInt(match[1], 10)
}

export { decodeArticleDbId, readPendingJson, writePendingJson }
export type { PendingArticle, PendingJson }
