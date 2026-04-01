#!/usr/bin/env node

import { Command } from 'commander'
import { helloCommand } from './hello.js'

const program = new Command()

program.name('mtspaw').version('1.0.0').description('A CLI tool for spawning agents')

program.addCommand(helloCommand)

program.parse(process.argv)
