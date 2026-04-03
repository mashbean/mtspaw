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
import { logAction, setupConsoleLogger } from '../services/logger/index.js'
import { agentCommand } from './agent/index.js'
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

const printFullHelp = (cmd: Command, prefix = '') => {
  const name = prefix ? `${prefix} ${cmd.name()}` : cmd.name()
  const opts = cmd.options.filter((o) => !o.hidden && o.long !== '--help' && o.long !== '--version')
  const desc = cmd.description()

  if (desc) {
    const optStr = opts.map((o) => o.flags).join(', ')
    console.log(`  ${name}${optStr ? `  [${optStr}]` : ''}`)
    console.log(`    ${desc}`)
  }

  for (const sub of cmd.commands) {
    printFullHelp(sub, name)
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

program.name(pkg.name).version(pkg.version).description('A CLI tool for spawning agents').showSuggestionAfterError(true)

program.hook('preAction', (_, actionCommand) => {
  const commandPath = getCommandPath(actionCommand)
  const rawArgs = actionCommand.args || []
  const opts = actionCommand.opts()
  const optArgs = Object.entries(opts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `--${k} ${v}`)
  logAction(commandPath, [...rawArgs, ...optArgs])
})

program.addHelpText('after', () => {
  console.log('\nAll commands and options:\n')
  for (const cmd of program.commands) {
    printFullHelp(cmd)
  }
  return ''
})

program.addCommand(helloCommand)
program.addCommand(initAgentCommand)
program.addCommand(syncSchemaCommand)
program.addCommand(loginCommand)
program.addCommand(postCommand)
program.addCommand(trackCommand)
program.addCommand(untrackCommand)
program.addCommand(trackQueryCommand)
program.addCommand(removeCommand)
program.addCommand(readCommand)
program.addCommand(agentCommand)

program.parseAsync(process.argv).catch((err) => {
  if (err?.name === 'ExitPromptError') {
    console.log('\nBye bye paw ~')
    process.exit(0)
  }
  console.error(err.message)
  process.exit(1)
})
