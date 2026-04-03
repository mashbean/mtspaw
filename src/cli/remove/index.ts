import { input } from '@inquirer/prompts'
import { Command } from 'commander'

import { readPendingJson, writePendingJson } from '../../services/pending/index.js'

const pendingCommand = new Command('pending')
  .description('Remove an article from pending.json')
  .option('--articleId <id>', 'Article ID to remove')
  .action(async (opts) => {
    const params = { ...opts }

    if (!params.articleId) {
      params.articleId = await input({
        message: 'Article ID:',
        validate: (val) => {
          if (!val.trim()) {
            return 'Article ID is required'
          }
          return true
        },
      })
    }

    const pendingJson = readPendingJson()
    const before = pendingJson.articles.length
    pendingJson.articles = pendingJson.articles.filter((a) => a.articleId !== params.articleId)
    const after = pendingJson.articles.length

    if (before === after) {
      console.error(`Article not found in pending.json: ${params.articleId}`)
      process.exit(1)
    }

    writePendingJson(pendingJson)
    console.log(`Removed article ${params.articleId} from pending.json`)
  })

const removeCommand = new Command('remove').description('Remove items')

removeCommand.addCommand(pendingCommand)

export { removeCommand }
