import { Command } from 'commander'

import { readScoreJson, writeScoreJson } from '../../services/score/index.js'

const validateScore = (raw: string): string | true => {
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    return 'Score must be an integer'
  }
  if (n < 0 || n > 100) {
    return 'Score must be in 0-100'
  }
  return true
}

const addCommand = new Command('add')
  .description('Add or update an article score')
  .requiredOption('--articleId <id>', 'Article ID')
  .requiredOption('--shortHash <hash>', 'Article short hash')
  .requiredOption('--score <number>', 'Score (0-100)')
  .requiredOption('--author <username>', 'Article author user name')
  .action((opts: { articleId: string; shortHash: string; score: string; author: string }) => {
    const result = validateScore(opts.score)
    if (result !== true) {
      console.error(result)
      process.exit(1)
    }

    const score = Number(opts.score)
    const data = readScoreJson()
    const filtered = data.articles.filter((a) => a.articleId !== opts.articleId)
    filtered.push({
      articleId: opts.articleId,
      shortHash: opts.shortHash,
      score,
      author: opts.author,
      scoredAt: new Date().toISOString(),
    })
    writeScoreJson({ articles: filtered })
    console.log(`Score recorded: ${opts.articleId} (${score})`)
  })

const removeCommand = new Command('remove')
  .description('Remove an article from score.json')
  .requiredOption('--articleId <id>', 'Article ID')
  .action((opts: { articleId: string }) => {
    const data = readScoreJson()
    const filtered = data.articles.filter((a) => a.articleId !== opts.articleId)
    if (filtered.length === data.articles.length) {
      console.error(`Article not found in score.json: ${opts.articleId}`)
      process.exit(1)
    }
    writeScoreJson({ articles: filtered })
    console.log(`Score removed: ${opts.articleId}`)
  })

const clearCommand = new Command('clear').description('Remove all entries from score.json').action(() => {
  const data = readScoreJson()
  const count = data.articles.length
  if (count === 0) {
    console.log('Score is already empty')
    return
  }
  writeScoreJson({ articles: [] })
  console.log(`Score cleared (${count} removed)`)
})

const scoreCommand = new Command('score').description('Manage article scores')
scoreCommand.addCommand(addCommand)
scoreCommand.addCommand(removeCommand)
scoreCommand.addCommand(clearCommand)

export { scoreCommand }
