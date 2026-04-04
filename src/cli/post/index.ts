import fs from 'node:fs'
import path from 'node:path'

import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { ensureAuth, login, readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'

const ARTICLE_QUERY = `
  query Article($input: ArticleInput!) {
    article(input: $input) {
      id
      title
      state
    }
  }
`

const ARTICLE_NODE_QUERY = `
  query Node($input: NodeInput!) {
    node(input: $input) {
      ... on Article {
        id
        title
        state
      }
    }
  }
`

const PUT_COMMENT_MUTATION = `
  mutation PutComment($input: PutCommentInput!) {
    putComment(input: $input) {
      id
      content
    }
  }
`

const resolveArticleId = async (mattersApi: string, shortHash: string) => {
  const result = await fetchGql(mattersApi, ARTICLE_QUERY, { input: { shortHash } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.article) {
    throw new Error(`Article not found for shortHash: ${shortHash}`)
  }

  const article = result.data.article
  if (article.state !== 'active') {
    console.log(`Article is not active (state: ${article.state}), skipping`)
    return null
  }

  console.log(`Resolved article: ${article.title} (${article.id})`)
  return article.id as string
}

const checkArticleState = async (mattersApi: string, articleId: string): Promise<boolean> => {
  const result = await fetchGql(mattersApi, ARTICLE_NODE_QUERY, { input: { id: articleId } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.node) {
    throw new Error(`Article not found: ${articleId}`)
  }

  if (result.data.node.state !== 'active') {
    console.log(`Article is not active (state: ${result.data.node.state}), skipping`)
    return false
  }

  return true
}

const postComment = async (mattersApi: string, token: string, params: Record<string, string>) => {
  return await fetchGql(
    mattersApi,
    PUT_COMMENT_MUTATION,
    {
      input: {
        comment: {
          content: params.content,
          type: 'article',
          articleId: params.articleId,
          ...(params.replyTo ? { replyTo: params.replyTo } : {}),
          ...(params.parentId ? { parentId: params.parentId } : {}),
        },
      },
    },
    token,
  )
}

const articleCommentCommand = new Command('article-comment')
  .description('Post a comment on an article')
  .option('--articleId <id>', 'Article ID')
  .option('--articleShortHash <hash>', 'Article short hash (from URL)')
  .option('--content <text>', 'Comment content')
  .option('--replyTo <id>', 'Reply to comment ID')
  .option('--parentId <id>', 'Parent comment ID')
  .action(async (opts) => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const params = { ...opts }
    const envJson = readEnvJson(envJsonPath)

    if (!params.articleId && !params.articleShortHash) {
      const idType = await select({
        message: 'Identify article by:',
        choices: [
          { name: 'Article ID', value: 'articleId' },
          { name: 'Article Short Hash (from URL)', value: 'articleShortHash' },
        ],
      })

      if (idType === 'articleId') {
        params.articleId = await input({
          message: 'Article ID:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Article ID is required'
            }
            return true
          },
        })
      } else {
        params.articleShortHash = await input({
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

    if (params.articleShortHash) {
      const articleId = await resolveArticleId(envJson.mattersApi, params.articleShortHash)
      if (!articleId) {
        return
      }
      params.articleId = articleId
    }

    if (!params.content) {
      params.content = await input({
        message: 'Comment content:',
        validate: (val) => {
          if (!val.trim()) {
            return 'Comment content is required'
          }
          return true
        },
      })
    }

    try {
      if (!params.articleShortHash) {
        const isActive = await checkArticleState(envJson.mattersApi, params.articleId)
        if (!isActive) {
          return
        }
      }
      const token = await ensureAuth(envJsonPath)
      let result = await postComment(envJson.mattersApi, token, params)

      if (result?.errors) {
        const errorMsg = result.errors.map((e: { message: string }) => e.message).join(', ')

        if (errorMsg.toLowerCase().includes('token') || errorMsg.toLowerCase().includes('auth')) {
          console.log('Token invalid, re-logging in...')
          const newToken = await login(envJsonPath)
          result = await postComment(envJson.mattersApi, newToken, params)

          if (result?.errors) {
            console.error('Post failed:', result.errors.map((e: { message: string }) => e.message).join(', '))
            process.exit(1)
          }
        } else {
          console.error('Post failed:', errorMsg)
          process.exit(1)
        }
      }

      console.log('Comment posted:', result.data.putComment.id)
    } catch (err) {
      console.error('Post failed:', (err as Error).message)
      process.exit(1)
    }
  })

const CAMPAIGN_QUERY = `
  query Campaign($input: CampaignInput!) {
    campaign(input: $input) {
      id
      ... on WritingChallenge {
        name
      }
    }
  }
`

const PUT_DRAFT_MUTATION = `
  mutation PutDraft($input: PutDraftInput!) {
    putDraft(input: $input) {
      id
    }
  }
`

const PUBLISH_ARTICLE_MUTATION = `
  mutation PublishArticle($input: PublishArticleInput!) {
    publishArticle(input: $input) {
      id
      article {
        id
        shortHash
        title
      }
    }
  }
`

const resolveEventId = async (mattersApi: string, shortHash: string) => {
  const result = await fetchGql(mattersApi, CAMPAIGN_QUERY, { input: { shortHash } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.campaign) {
    throw new Error(`Event not found for shortHash: ${shortHash}`)
  }

  console.log(`Resolved event: ${result.data.campaign.name} (${result.data.campaign.id})`)
  return result.data.campaign.id as string
}

const articleCommand = new Command('article')
  .description('Post a new article')
  .option('--title <text>', 'Article title')
  .option('--content <text>', 'Article content')
  .option('--eventId <id>', 'Submit to event (campaign ID)')
  .option('--eventShortHash <hash>', 'Submit to event (campaign short hash)')
  .option('--indentFirstLine <bool>', 'Indent first line of each paragraph', 'true')
  .action(async (opts) => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const envJson = readEnvJson(envJsonPath)
    const params = { ...opts }

    if (!params.title) {
      params.title = await input({
        message: 'Article title:',
        validate: (val) => {
          if (!val.trim()) {
            return 'Title is required'
          }
          return true
        },
      })
    }

    if (!params.content) {
      params.content = await input({
        message: 'Article content:',
        validate: (val) => {
          if (!val.trim()) {
            return 'Content is required'
          }
          return true
        },
      })
    }

    if (params.eventShortHash) {
      params.eventId = await resolveEventId(envJson.mattersApi, params.eventShortHash)
    }

    try {
      const token = await ensureAuth(envJsonPath)

      const draftInput: Record<string, unknown> = {
        title: params.title,
        content: params.content,
        indentFirstLine: params.indentFirstLine !== 'false',
      }

      if (params.eventId) {
        draftInput.campaigns = [{ campaign: params.eventId }]
      }

      const draftResult = await fetchGql(envJson.mattersApi, PUT_DRAFT_MUTATION, { input: draftInput }, token)

      if (draftResult?.errors) {
        console.error(
          'Draft creation failed:',
          draftResult.errors.map((e: { message: string }) => e.message).join(', '),
        )
        process.exit(1)
      }

      const draftId = draftResult?.data?.putDraft?.id
      if (!draftId) {
        console.error('Draft creation failed: no draft ID returned')
        process.exit(1)
      }

      console.log(`Draft created: ${draftId}`)

      const publishResult = await fetchGql(
        envJson.mattersApi,
        PUBLISH_ARTICLE_MUTATION,
        { input: { id: draftId } },
        token,
      )

      if (publishResult?.errors) {
        console.error('Publish failed:', publishResult.errors.map((e: { message: string }) => e.message).join(', '))
        process.exit(1)
      }

      const article = publishResult?.data?.publishArticle?.article
      if (article) {
        console.log(`Article published: ${article.title} (${article.shortHash})`)
      } else {
        console.log('Article published (pending IPFS)')
      }
    } catch (err) {
      console.error('Post failed:', (err as Error).message)
      process.exit(1)
    }
  })

const postCommand = new Command('post').description('Post content to Matters')

postCommand.addCommand(articleCommentCommand)
postCommand.addCommand(articleCommand)

export { postCommand }
