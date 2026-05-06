import { input } from '@inquirer/prompts'
import { Command } from 'commander'

import { readPendingJson, writePendingJson } from '../../services/pending/index.js'
import { readReplyPendingJson, writeReplyPendingJson } from '../../services/reply-pending/index.js'

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

const replyPendingCommand = new Command('reply-pending')
  .description('Remove a reply entry from reply-pending.json')
  .option('--replyId <id>', 'Reply comment ID to remove')
  .action(async (opts: { replyId?: string }) => {
    const replyId =
      opts.replyId ??
      (await input({
        message: 'Reply ID:',
        validate: (val) => (val.trim() ? true : 'Reply ID is required'),
      }))

    const data = readReplyPendingJson()
    const before = data.replies.length
    data.replies = data.replies.filter((r) => r.replyId !== replyId)
    const after = data.replies.length

    if (before === after) {
      console.error(`Reply not found in reply-pending.json: ${replyId}`)
      process.exit(1)
    }

    writeReplyPendingJson(data)
    console.log(`Removed reply ${replyId} from reply-pending.json`)
  })

const removeCommand = new Command('remove').description('Remove items')

removeCommand.addCommand(pendingCommand)
removeCommand.addCommand(replyPendingCommand)

export { removeCommand }
