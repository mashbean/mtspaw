import fs from 'node:fs'
import path from 'node:path'

interface ScoreEntry {
  articleId: string
  shortHash: string
  score: number
  author: string
  scoredAt: string
}

interface ScoreJson {
  articles: ScoreEntry[]
}

const getScoreJsonPath = () => path.resolve(process.cwd(), 'score.json')

const readScoreJson = (): ScoreJson => {
  const scoreJsonPath = getScoreJsonPath()
  if (!fs.existsSync(scoreJsonPath)) {
    return { articles: [] }
  }
  return JSON.parse(fs.readFileSync(scoreJsonPath, 'utf-8'))
}

const writeScoreJson = (data: ScoreJson) => {
  fs.writeFileSync(getScoreJsonPath(), JSON.stringify(data, null, 2))
}

export { readScoreJson, writeScoreJson }
export type { ScoreEntry, ScoreJson }
