import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readTrackJson, writeTrackJson } from '../../services/track/index.js'

const findEntryByIdOrHash = (entries: Record<string, { id: string; hash: string; name: string }>, value: string) => {
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.id === value || entry.hash === value) {
      return key
    }
  }
  return null
}

const untrackEventCommand = new Command('event')
  .description('Untrack an event')
  .showSuggestionAfterError(true)
  .configureOutput({
    outputError: (str, write) => {
      if (str.includes('too many arguments')) {
        write(`error: unknown subcommand. Available: all\n`)
        return
      }
      write(str)
    },
  })
  .option('--id <id>', 'Event ID')
  .option('--shortHash <hash>', 'Event short hash')
  .action(async (opts) => {
    const params = { ...opts }

    if (!params.id && !params.shortHash) {
      const idType = await select({
        message: 'Identify event by:',
        choices: [
          { name: 'Event ID', value: 'id' },
          { name: 'Event Short Hash', value: 'shortHash' },
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

    const trackJson = readTrackJson()
    const value = params.id || params.shortHash
    const key = findEntryByIdOrHash(trackJson.events, value)

    if (!key) {
      console.error(`Event not found in track.json: ${value}`)
      process.exit(1)
    }

    const removed = trackJson.events[key]
    delete trackJson.events[key]
    writeTrackJson(trackJson)

    console.log(`Untracked event: ${removed.name} (${removed.id})`)
  })

const untrackChannelCommand = new Command('channel')
  .description('Untrack a channel')
  .showSuggestionAfterError(true)
  .configureOutput({
    outputError: (str, write) => {
      if (str.includes('too many arguments')) {
        write(`error: unknown subcommand. Available: all\n`)
        return
      }
      write(str)
    },
  })
  .option('--id <id>', 'Channel ID')
  .option('--shortHash <hash>', 'Channel short hash')
  .action(async (opts) => {
    const params = { ...opts }

    if (!params.id && !params.shortHash) {
      const idType = await select({
        message: 'Identify channel by:',
        choices: [
          { name: 'Channel ID', value: 'id' },
          { name: 'Channel Short Hash', value: 'shortHash' },
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

    const trackJson = readTrackJson()
    const value = params.id || params.shortHash
    const key = findEntryByIdOrHash(trackJson.channels, value)

    if (!key) {
      console.error(`Channel not found in track.json: ${value}`)
      process.exit(1)
    }

    const removed = trackJson.channels[key]
    delete trackJson.channels[key]
    writeTrackJson(trackJson)

    console.log(`Untracked channel: ${removed.name} (${removed.id})`)
  })

const untrackEventAllCommand = new Command('all').description('Untrack all events').action(() => {
  const trackJson = readTrackJson()
  const count = Object.keys(trackJson.events).length

  if (count === 0) {
    console.log('No tracked events to remove')
    return
  }

  trackJson.events = {}
  writeTrackJson(trackJson)
  console.log(`Untracked all events (${count} removed)`)
})

const untrackChannelAllCommand = new Command('all').description('Untrack all channels').action(() => {
  const trackJson = readTrackJson()
  const count = Object.keys(trackJson.channels).length

  if (count === 0) {
    console.log('No tracked channels to remove')
    return
  }

  trackJson.channels = {}
  writeTrackJson(trackJson)
  console.log(`Untracked all channels (${count} removed)`)
})

untrackEventCommand.addCommand(untrackEventAllCommand)
untrackChannelCommand.addCommand(untrackChannelAllCommand)

const untrackCommand = new Command('untrack').description('Untrack events or channels')

untrackCommand.addCommand(untrackEventCommand)
untrackCommand.addCommand(untrackChannelCommand)

export { untrackCommand }
