import fs from 'node:fs'
import path from 'node:path'

import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { readTrackJson, writeTrackJson } from '../../services/track/index.js'

const CAMPAIGN_QUERY = `
  query Campaign($input: CampaignInput!) {
    campaign(input: $input) {
      id
      ... on WritingChallenge {
        shortHash
        name
      }
    }
  }
`

const NODE_QUERY = `
  query Node($input: NodeInput!) {
    node(input: $input) {
      id
      ... on WritingChallenge {
        shortHash
        name
      }
      ... on Tag {
        shortHash
        navbarTitle
      }
    }
  }
`

const resolveEventByShortHash = async (mattersApi: string, shortHash: string) => {
  const result = await fetchGql(mattersApi, CAMPAIGN_QUERY, { input: { shortHash } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.campaign) {
    throw new Error(`Event not found for shortHash: ${shortHash}`)
  }

  return {
    id: result.data.campaign.id as string,
    hash: result.data.campaign.shortHash as string,
    name: result.data.campaign.name as string,
  }
}

const resolveById = async (mattersApi: string, id: string) => {
  const result = await fetchGql(mattersApi, NODE_QUERY, { input: { id } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.node) {
    throw new Error(`Node not found for id: ${id}`)
  }

  const node = result.data.node
  return {
    id: node.id as string,
    hash: (node.shortHash || '') as string,
    name: (node.name || node.navbarTitle || '') as string,
  }
}

const eventCommand = new Command('event')
  .description('Track an event (campaign)')
  .showSuggestionAfterError(true)
  .configureOutput({
    outputError: (str, write) => {
      if (str.includes('too many arguments')) {
        write(`error: unknown subcommand. Available: list\n`)
        return
      }
      write(str)
    },
  })
  .option('--id <id>', 'Event ID')
  .option('--shortHash <hash>', 'Event short hash (from URL)')
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
        message: 'Identify event by:',
        choices: [
          { name: 'Event ID', value: 'id' },
          { name: 'Event Short Hash (from URL)', value: 'shortHash' },
        ],
      })

      if (idType === 'id') {
        params.id = await input({
          message: 'Event ID:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Event ID is required'
            }
            return true
          },
        })
      } else {
        params.shortHash = await input({
          message: 'Event Short Hash:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Event Short Hash is required'
            }
            return true
          },
        })
      }
    }

    const event = params.shortHash
      ? await resolveEventByShortHash(envJson.mattersApi, params.shortHash)
      : await resolveById(envJson.mattersApi, params.id)
    const trackJson = readTrackJson()

    trackJson.events[event.id] = {
      id: event.id,
      hash: event.hash,
      name: event.name,
    }

    writeTrackJson(trackJson)
    console.log(`Tracking event: ${event.name} (${event.id})`)
  })

const CHANNEL_QUERY = `
  query Channel($input: ChannelInput!) {
    channel(input: $input) {
      id
      shortHash
      navbarTitle
    }
  }
`

const resolveChannel = async (mattersApi: string, shortHash: string) => {
  const result = await fetchGql(mattersApi, CHANNEL_QUERY, { input: { shortHash } })

  if (result?.errors) {
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  if (!result?.data?.channel) {
    throw new Error(`Channel not found for shortHash: ${shortHash}`)
  }

  return {
    id: result.data.channel.id as string,
    hash: result.data.channel.shortHash as string,
    name: result.data.channel.navbarTitle as string,
  }
}

const channelCommand = new Command('channel')
  .description('Track a channel')
  .showSuggestionAfterError(true)
  .configureOutput({
    outputError: (str, write) => {
      if (str.includes('too many arguments')) {
        write(`error: unknown subcommand. Available: list\n`)
        return
      }
      write(str)
    },
  })
  .option('--id <id>', 'Channel ID')
  .option('--shortHash <hash>', 'Channel short hash (from URL)')
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
        message: 'Identify channel by:',
        choices: [
          { name: 'Channel ID', value: 'id' },
          { name: 'Channel Short Hash (from URL)', value: 'shortHash' },
        ],
      })

      if (idType === 'id') {
        params.id = await input({
          message: 'Channel ID:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Channel ID is required'
            }
            return true
          },
        })
      } else {
        params.shortHash = await input({
          message: 'Channel Short Hash:',
          validate: (val) => {
            if (!val.trim()) {
              return 'Channel Short Hash is required'
            }
            return true
          },
        })
      }
    }

    const channel = params.shortHash
      ? await resolveChannel(envJson.mattersApi, params.shortHash)
      : await resolveById(envJson.mattersApi, params.id)
    const trackJson = readTrackJson()

    trackJson.channels[channel.id] = {
      id: channel.id,
      hash: channel.hash,
      name: channel.name,
    }

    writeTrackJson(trackJson)
    console.log(`Tracking channel: ${channel.name} (${channel.id})`)
  })

const eventListCommand = new Command('list').description('List all tracked events').action(() => {
  const trackJson = readTrackJson()
  const events = Object.values(trackJson.events)

  if (events.length === 0) {
    console.log('No tracked events')
    return
  }

  console.log('Tracked events:')
  for (const event of events) {
    console.log(`  - ${event.name} (id: ${event.id}, hash: ${event.hash})`)
  }
})

const channelListCommand = new Command('list').description('List all tracked channels').action(() => {
  const trackJson = readTrackJson()
  const channels = Object.values(trackJson.channels)

  if (channels.length === 0) {
    console.log('No tracked channels')
    return
  }

  console.log('Tracked channels:')
  for (const channel of channels) {
    console.log(`  - ${channel.name} (id: ${channel.id}, hash: ${channel.hash})`)
  }
})

const listCommand = new Command('list').description('List all tracked events and channels').action(() => {
  const trackJson = readTrackJson()
  const events = Object.values(trackJson.events)
  const channels = Object.values(trackJson.channels)

  if (events.length === 0 && channels.length === 0) {
    console.log('No tracked items')
    return
  }

  if (events.length > 0) {
    console.log('Events:')
    for (const event of events) {
      console.log(`  - ${event.name} (id: ${event.id}, hash: ${event.hash})`)
    }
  }

  if (channels.length > 0) {
    console.log('Channels:')
    for (const channel of channels) {
      console.log(`  - ${channel.name} (id: ${channel.id}, hash: ${channel.hash})`)
    }
  }
})

eventCommand.addCommand(eventListCommand)
channelCommand.addCommand(channelListCommand)

const trackCommand = new Command('track').description('Track events or channels')

trackCommand.addCommand(eventCommand)
trackCommand.addCommand(channelCommand)
trackCommand.addCommand(listCommand)

export { trackCommand }
