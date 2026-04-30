import fs from 'node:fs'
import path from 'node:path'

import { fromGlobalId } from '../gql/index.js'

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
  const { id } = fromGlobalId(articleId)
  const dbId = parseInt(id, 10)
  if (Number.isNaN(dbId)) {
    throw new Error(`Cannot decode DB id from article id: ${articleId}`)
  }
  return dbId
}

export { decodeArticleDbId, readPendingJson, writePendingJson }
export type { PendingArticle, PendingJson }
