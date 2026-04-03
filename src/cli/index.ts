#!/usr/bin/env node

import path from 'node:path'

import { Command } from 'commander'
import dotenv from 'dotenv'

process.on('SIGINT', () => {
  console.log('\nBye bye paw ~')
  process.exit(0)
})

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true })
setupConsoleLogger()
import pkg from '../../package.json' with { type: 'json' }
import { logAction, setFileLogging, setQuietMode, setupConsoleLogger } from '../services/logger/index.js'
import { envCommand } from './env/index.js'
import { featureCommand } from './feature/index.js'
import { helloCommand } from './hello/index.js'
import { initAgentCommand } from './init-agent/index.js'
import { loginCommand } from './login/index.js'
import { postCommand } from './post/index.js'
import { readCommand } from './read/index.js'
import { removeCommand } from './remove/index.js'
import { syncSchemaCommand } from './sync-schema/index.js'
import { trackCommand } from './track/index.js'
import { trackQueryCommand } from './track-query/index.js'
import { untrackCommand } from './untrack/index.js'

const program = new Command()

let isFirstTopLevel = true

const printFullHelp = (cmd: Command, depth = 0) => {
  const indent = '  '.repeat(depth + 1)
  const opts = cmd.options.filter((o) => !o.hidden && o.long !== '--help' && o.long !== '--version')
  const desc = cmd.description()
  const optStr = opts.length > 0 ? `  [${opts.map((o) => o.flags).join(', ')}]` : ''

  if (desc) {
    if (depth === 0 && !isFirstTopLevel) {
      console.log('')
    }
    if (depth === 0) {
      isFirstTopLevel = false
    }
    const name = depth === 0 ? `\x1b[38;2;189;147;249m${cmd.name()}\x1b[0m` : cmd.name()
    console.log(`${indent}${name}${optStr} -- ${desc}`)
  }

  for (const sub of cmd.commands) {
    printFullHelp(sub, depth + 1)
  }
}

const getCommandPath = (cmd: Command): string => {
  const parts: string[] = []
  let current: Command | null = cmd
  while (current && current !== program) {
    parts.unshift(current.name())
    current = current.parent
  }
  return parts.join(' ')
}

program
  .name(pkg.name)
  .version(pkg.version)
  .description('A CLI tool for spawning agents')
  .showSuggestionAfterError(true)
  .option('-q, --quiet', 'Suppress terminal output (still logs to action.log)')

program.hook('preAction', (thisCommand, actionCommand) => {
  const opts = thisCommand.opts()
  if (opts.quiet) {
    setQuietMode(true)
  }

  const commandPath = getCommandPath(actionCommand)
  const rawArgs = actionCommand.args || []
  const actionOpts = actionCommand.opts()
  const omitFromLog = ['content']
  const optArgs = Object.entries(actionOpts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (omitFromLog.includes(k) ? `--${k} [omitted]` : `--${k} ${v}`))
  logAction(commandPath, [...rawArgs, ...optArgs])
})

program.addHelpText('after', () => {
  setFileLogging(false)
  try {
    console.log('\nAll commands and options:\n')
    for (const cmd of program.commands) {
      printFullHelp(cmd)
    }
  } finally {
    setFileLogging(true)
  }
  return ''
})

program.addCommand(envCommand)
program.addCommand(featureCommand)
program.addCommand(helloCommand)
program.addCommand(initAgentCommand)
program.addCommand(loginCommand)
program.addCommand(postCommand)
program.addCommand(readCommand)
program.addCommand(removeCommand)
program.addCommand(syncSchemaCommand)
program.addCommand(trackCommand)
program.addCommand(trackQueryCommand)
program.addCommand(untrackCommand)

program.parseAsync(process.argv).catch((err) => {
  if (err?.name === 'ExitPromptError') {
    console.log('\nBye bye paw ~')
    process.exit(0)
  }
  console.error(err.message)
  process.exit(1)
})
