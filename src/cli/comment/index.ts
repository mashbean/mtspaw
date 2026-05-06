import { input } from '@inquirer/prompts'
import { Command } from 'commander'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import { fetchGql, formatGqlErrors } from '../../services/gql/index.js'

const COMMENT_LOOKUP_QUERY = `
  query CommentLookup($input: NodeInput!) {
    node(input: $input) {
      ... on Comment {
        id
        state
      }
    }
  }
`

const VOTE_COMMENT_MUTATION = `
  mutation VoteComment($input: VoteCommentInput!) {
    voteComment(input: $input) {
      id
      myVote
    }
  }
`

const UNVOTE_COMMENT_MUTATION = `
  mutation UnvoteComment($input: UnvoteCommentInput!) {
    unvoteComment(input: $input) {
      id
      myVote
    }
  }
`

const promptCommentId = async (provided?: string) => {
  if (provided) {
    return provided
  }
  return await input({
    message: 'Comment ID:',
    validate: (val) => (val.trim() ? true : 'Comment ID is required'),
  })
}

const likeCommand = new Command('like')
  .description('Upvote a comment')
  .option('--commentId <id>', 'Comment ID')
  .action(async (opts: { commentId?: string }) => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const commentId = await promptCommentId(opts.commentId)

    try {
      const lookup = await fetchGql(mattersApi, COMMENT_LOOKUP_QUERY, { input: { id: commentId } })
      const lookupErr = formatGqlErrors(lookup)
      if (lookupErr) {
        console.error('Comment lookup failed:', lookupErr)
        process.exit(1)
      }

      const target = lookup?.data?.node
      if (!target?.id) {
        console.error(`Comment not found: ${commentId}`)
        process.exit(1)
      }
      if (target.state !== 'active') {
        console.log(`Comment is not active (state: ${target.state}), skipping`)
        return
      }

      const { errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, VOTE_COMMENT_MUTATION, {
        input: { id: commentId, vote: 'up' },
      })
      if (errorMessage) {
        console.error('Like failed:', errorMessage)
        process.exit(1)
      }

      console.log(`Comment liked: ${commentId}`)
    } catch (err) {
      console.error('Like failed:', (err as Error).message)
      process.exit(1)
    }
  })

const unlikeCommand = new Command('unlike')
  .description('Remove the upvote from a comment')
  .option('--commentId <id>', 'Comment ID')
  .action(async (opts: { commentId?: string }) => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const commentId = await promptCommentId(opts.commentId)

    try {
      const { errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, UNVOTE_COMMENT_MUTATION, {
        input: { id: commentId },
      })
      if (errorMessage) {
        console.error('Unlike failed:', errorMessage)
        process.exit(1)
      }

      console.log(`Comment unliked: ${commentId}`)
    } catch (err) {
      console.error('Unlike failed:', (err as Error).message)
      process.exit(1)
    }
  })

const commentCommand = new Command('comment').description('Comment actions (like, unlike)')

commentCommand.addCommand(likeCommand)
commentCommand.addCommand(unlikeCommand)

export { commentCommand }
