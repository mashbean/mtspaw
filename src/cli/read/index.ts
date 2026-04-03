import fs from 'node:fs'
import path from 'node:path'

import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'

const ARTICLE_BY_ID_QUERY = `
  query Node($input: NodeInput!) {
    node(input: $input) {
      ... on Article {
        id
        title
        shortHash
        contents {
          markdown
        }
        author {
          displayName
          userName
        }
      }
    }
  }
`

const ARTICLE_BY_SHORTHASH_QUERY = `
  query Article($input: ArticleInput!) {
    article(input: $input) {
      id
      title
      shortHash
      contents {
        markdown
      }
      author {
        displayName
        userName
      }
    }
  }
`

const articleCommand = new Command('article')
  .description('Read an article content')
  .option('--id <id>', 'Article ID')
  .option('--shortHash <hash>', 'Article short hash (from URL)')
  .action(async (opts) => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const envJson = readEnvJson(envJsonPath)
    const params = { ...opts }

    if (!params.id && !params.shortHash) {
      const idType = await select({
        message: 'Identify article by:',
        choices: [
          { name: 'Article ID', value: 'id' },
          { name: 'Article Short Hash (from URL)', value: 'shortHash' },
        ],
      })

      if (idType === 'id') {
        params.id = await input({
          message: 'Article ID:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Article ID is required'
            }
            return true
          },
        })
      } else {
        params.shortHash = await input({
          message: 'Article Short Hash:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Article Short Hash is required'
            }
            return true
          },
        })
      }
    }

    const result = params.shortHash
      ? await fetchGql(envJson.mattersApi, ARTICLE_BY_SHORTHASH_QUERY, { input: { shortHash: params.shortHash } })
      : await fetchGql(envJson.mattersApi, ARTICLE_BY_ID_QUERY, { input: { id: params.id } })

    if (result?.errors) {
      console.error('Failed:', result.errors.map((e: { message: string }) => e.message).join(', '))
      process.exit(1)
    }

    const article = params.shortHash ? result?.data?.article : result?.data?.node
    if (!article?.title) {
      console.error(`Article not found: ${params.shortHash || params.id}`)
      process.exit(1)
    }

    console.log(`Title: ${article.title}`)
    console.log(`Author: ${article.author?.displayName} (@${article.author?.userName})`)
    console.log(`Hash: ${article.shortHash}`)
    console.log('---')
    console.log(article.contents.markdown)
  })

const readCommand = new Command('read').description('Read content from Matters')

readCommand.addCommand(articleCommand)

export { readCommand }
