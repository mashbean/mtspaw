import fs from 'node:fs'
import path from 'node:path'

import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'

const KNOWN_THRESHOLDS = ['comment'] as const

const RANGES: Record<string, { min: number; max: number }> = {
  comment: { min: 0, max: 100 },
}

const sortThresholds = (thresholds: Record<string, number>) => {
  return Object.fromEntries(Object.entries(thresholds).sort(([a], [b]) => a.localeCompare(b)))
}

const requireEnvJson = () => {
  const envJsonPath = path.resolve(process.cwd(), 'env.json')
  if (!fs.existsSync(envJsonPath)) {
    console.error('env.json not found in current directory')
    process.exit(1)
  }
  return envJsonPath
}

const setCommand = new Command('set')
  .description('Set a threshold value')
  .option('--name <name>', 'Threshold name')
  .option('--value <number>', 'Threshold value')
  .action(async (opts: { name?: string; value?: string }) => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const thresholds = (envJson.thresholds || {}) as Record<string, number>

    let name = opts.name
    if (!name) {
      name = await select({
        message: 'Select threshold to set:',
        choices: KNOWN_THRESHOLDS.map((n) => ({ name: n, value: n })),
      })
    }

    if (!KNOWN_THRESHOLDS.includes(name as (typeof KNOWN_THRESHOLDS)[number])) {
      console.error(`Unknown threshold: ${name}`)
      console.error(`Available: ${KNOWN_THRESHOLDS.join(', ')}`)
      process.exit(1)
    }

    const range = RANGES[name]
    let rawValue = opts.value
    if (rawValue === undefined) {
      rawValue = await input({
        message: `Value (${range.min}-${range.max}):`,
        validate: (val) => {
          const n = Number(val)
          if (!Number.isInteger(n)) {
            return 'Value must be an integer'
          }
          if (n < range.min || n > range.max) {
            return `Value must be in ${range.min}-${range.max}`
          }
          return true
        },
      })
    }

    const value = Number(rawValue)
    if (!Number.isInteger(value)) {
      console.error('Value must be an integer')
      process.exit(1)
    }
    if (value < range.min || value > range.max) {
      console.error(`Value for "${name}" must be in ${range.min}-${range.max}`)
      process.exit(1)
    }

    thresholds[name] = value
    envJson.thresholds = sortThresholds(thresholds)
    writeEnvJson(envJsonPath, envJson)
    console.log(`Threshold "${name}" set to ${value}`)
  })

const listCommand = new Command('list').description('List all thresholds').action(() => {
  const envJsonPath = requireEnvJson()
  const envJson = readEnvJson(envJsonPath)
  const thresholds = (envJson.thresholds || {}) as Record<string, number>

  const keys = Object.keys(thresholds)
  if (keys.length === 0) {
    console.log('No thresholds set')
    return
  }

  for (const key of keys) {
    console.log(`${key}: ${thresholds[key]}`)
  }
})

const thresholdCommand = new Command('threshold').description('Manage thresholds')

thresholdCommand.addCommand(setCommand)
thresholdCommand.addCommand(listCommand)

export { thresholdCommand }
