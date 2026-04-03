import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

import { ensureAuth, readEnvJson } from '../../services/auth/index.js'
import { delay, fetchGql } from '../../services/gql/index.js'
import type { PendingArticle } from '../../services/pending/index.js'
import { decodeArticleDbId, readPendingJson, writePendingJson } from '../../services/pending/index.js'
import { readTrackJson } from '../../services/track/index.js'

const CAMPAIGN_ARTICLES_QUERY = `
  query CampaignArticles($input: CampaignInput!, $articlesInput: CampaignArticlesInput!) {
    campaign(input: $input) {
      articles(input: $articlesInput) {
        edges {
          node {
            id
            shortHash
            comments(input: { first: 0 }) {
              totalCount
            }
          }
        }
      }
    }
  }
`

const CHANNEL_ARTICLES_QUERY = `
  query ChannelArticles($input: ChannelInput!, $articlesInput: ChannelArticlesInput!) {
    channel(input: $input) {
      ... on TopicChannel {
        articles(input: $articlesInput) {
          edges {
            node {
              id
              shortHash
              comments(input: { first: 0 }) {
                totalCount
              }
            }
          }
        }
      }
    }
  }
`

const ARTICLE_COMMENTS_QUERY = `
  query ArticleComments($input: ArticleInput!, $commentsInput: CommentsInput!) {
    article(input: $input) {
      comments(input: $commentsInput) {
        edges {
          node {
            author {
              id
            }
          }
        }
      }
    }
  }
`

const hasUserCommented = async (
  mattersApi: string,
  token: string,
  shortHash: string,
  userId: string,
): Promise<boolean> => {
  const result = await fetchGql(
    mattersApi,
    ARTICLE_COMMENTS_QUERY,
    { input: { shortHash }, commentsInput: { first: 50 } },
    token,
  )

  const edges = result?.data?.article?.comments?.edges || []
  return edges.some((edge: { node: { author: { id: string } } }) => edge.node.author.id === userId)
}

const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
    }
  }
`

const getViewerId = async (mattersApi: string, token: string): Promise<string> => {
  const result = await fetchGql(mattersApi, VIEWER_QUERY, {}, token)
  return result?.data?.viewer?.id || ''
}

const trackQueryCommand = new Command('track-query')
  .description('Query articles from tracked events and channels')
  .action(async () => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const envJson = readEnvJson(envJsonPath)
    const token = await ensureAuth(envJsonPath)
    const trackJson = readTrackJson()
    const pendingJson = readPendingJson()
    const viewerId = await getViewerId(envJson.mattersApi, token)

    if (!viewerId) {
      console.error('Could not get viewer id. Is the token valid?')
      process.exit(1)
    }

    const events = Object.values(trackJson.events)
    const channels = Object.values(trackJson.channels)

    if (events.length === 0 && channels.length === 0) {
      console.log('No tracked events or channels')
      return
    }

    const isFirstRun = pendingJson.articleLast === 0
    const fetchCount = isFirstRun ? 10 : 20
    const collectedArticles: PendingArticle[] = []
    const MAX_ARTICLES = 50

    for (const event of events) {
      if (collectedArticles.length >= MAX_ARTICLES) {
        break
      }

      await delay(500)
      console.log(`Querying articles from event: ${event.name}...`)
      const result = await fetchGql(
        envJson.mattersApi,
        CAMPAIGN_ARTICLES_QUERY,
        { input: { shortHash: event.hash }, articlesInput: { first: fetchCount } },
        token,
      )

      if (result?.errors) {
        console.error(`  Query error:`, result.errors.map((e: { message: string }) => e.message).join(', '))
        continue
      }

      const edges = result?.data?.campaign?.articles?.edges || []
      for (const edge of edges) {
        if (collectedArticles.length >= MAX_ARTICLES) {
          break
        }

        const article = edge.node
        const articleDbId = decodeArticleDbId(article.id)

        if (!isFirstRun && articleDbId <= pendingJson.articleLast) {
          continue
        }

        if (article.comments?.totalCount > 0) {
          await delay(500)
          const commented = await hasUserCommented(envJson.mattersApi, token, article.shortHash, viewerId)
          if (commented) {
            continue
          }
        }

        collectedArticles.push({
          articleId: article.id,
          articleDbId,
          shortHash: article.shortHash,
          eventIds: [event.id],
          channelIds: [],
        })
      }
    }

    for (const channel of channels) {
      if (collectedArticles.length >= MAX_ARTICLES) {
        break
      }

      await delay(500)
      console.log(`Querying articles from channel: ${channel.name}...`)
      const result = await fetchGql(
        envJson.mattersApi,
        CHANNEL_ARTICLES_QUERY,
        { input: { shortHash: channel.hash }, articlesInput: { first: fetchCount } },
        token,
      )

      if (result?.errors) {
        console.error(`  Query error:`, result.errors.map((e: { message: string }) => e.message).join(', '))
        continue
      }

      const edges = result?.data?.channel?.articles?.edges || []
      for (const edge of edges) {
        if (collectedArticles.length >= MAX_ARTICLES) {
          break
        }

        const article = edge.node
        const articleDbId = decodeArticleDbId(article.id)

        if (!isFirstRun && articleDbId <= pendingJson.articleLast) {
          continue
        }

        if (article.comments?.totalCount > 0) {
          await delay(500)
          const commented = await hasUserCommented(envJson.mattersApi, token, article.shortHash, viewerId)
          if (commented) {
            continue
          }
        }

        collectedArticles.push({
          articleId: article.id,
          articleDbId,
          shortHash: article.shortHash,
          eventIds: [],
          channelIds: [channel.id],
        })
      }
    }

    const merged = [...pendingJson.articles, ...collectedArticles]

    const articleMap = new Map<string, PendingArticle>()
    for (const article of merged) {
      const existing = articleMap.get(article.articleId)
      if (existing) {
        const eventSet = new Set([...existing.eventIds, ...article.eventIds])
        existing.eventIds = [...eventSet]
        const channelSet = new Set([...existing.channelIds, ...article.channelIds])
        existing.channelIds = [...channelSet]
      } else {
        articleMap.set(article.articleId, { ...article })
      }
    }
    const uniqueArticles = [...articleMap.values()]

    uniqueArticles.sort((a, b) => a.articleDbId - b.articleDbId)

    pendingJson.articles = uniqueArticles
    if (uniqueArticles.length > 0) {
      pendingJson.articleLast = uniqueArticles[uniqueArticles.length - 1].articleDbId
    }

    writePendingJson(pendingJson)
    console.log(`Found ${uniqueArticles.length} articles, saved to pending.json`)
  })

export { trackQueryCommand }
