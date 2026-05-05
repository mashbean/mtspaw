import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson, requireEnvJson, sortByKey, writeEnvJson } from '../../services/auth/index.js'

const KNOWN_THRESHOLDS = ['comment', 'donate'] as const
type ThresholdName = (typeof KNOWN_THRESHOLDS)[number]

const RANGES: Record<ThresholdName, { min: number; max: number }> = {
  comment: { min: 0, max: 100 },
  donate: { min: 0, max: 100 },
}

const isKnownThreshold = (name: string): name is ThresholdName => {
  return (KNOWN_THRESHOLDS as readonly string[]).includes(name)
}

const validateValue = (raw: string, range: { min: number; max: number }): string | true => {
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    return 'Value must be an integer'
  }
  if (n < range.min || n > range.max) {
    return `Value must be in ${range.min}-${range.max}`
  }
  return true
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

    if (!isKnownThreshold(name)) {
      console.error(`Unknown threshold: ${name}`)
      console.error(`Available: ${KNOWN_THRESHOLDS.join(', ')}`)
      process.exit(1)
    }

    const range = RANGES[name]
    let rawValue = opts.value
    if (rawValue === undefined) {
      rawValue = await input({
        message: `Value (${range.min}-${range.max}):`,
        validate: (val) => validateValue(val, range),
      })
    } else {
      const result = validateValue(rawValue, range)
      if (result !== true) {
        console.error(result)
        process.exit(1)
      }
    }

    thresholds[name] = Number(rawValue)
    envJson.thresholds = sortByKey(thresholds)
    writeEnvJson(envJsonPath, envJson)
    console.log(`Threshold "${name}" set to ${thresholds[name]}`)
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
