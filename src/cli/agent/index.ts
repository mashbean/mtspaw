import fs from 'node:fs'
import path from 'node:path'

import { select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'

const getFeatureChoices = (envJson: Record<string, unknown>) => {
  const features = (envJson.features || {}) as Record<string, boolean>
  return Object.keys(features).map((key) => ({
    name: `${key} (${features[key] ? 'on' : 'off'})`,
    value: key,
  }))
}

const onCommand = new Command('on')
  .description('Turn on an agent feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const envJson = readEnvJson(envJsonPath)
    const features = (envJson.features || {}) as Record<string, boolean>
    let featureName = opts.feature

    if (!featureName) {
      const choices = getFeatureChoices(envJson)
      if (choices.length === 0) {
        console.log('No features available')
        return
      }
      featureName = await select({ message: 'Select feature to turn on:', choices })
    }

    if (!(featureName in features)) {
      console.error(`Unknown feature: ${featureName}`)
      process.exit(1)
    }

    features[featureName] = true
    envJson.features = features
    writeEnvJson(envJsonPath, envJson)
    console.log(`Feature "${featureName}" is now on`)
  })

const offCommand = new Command('off')
  .description('Turn off an agent feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    const envJson = readEnvJson(envJsonPath)
    const features = (envJson.features || {}) as Record<string, boolean>
    let featureName = opts.feature

    if (!featureName) {
      const choices = getFeatureChoices(envJson)
      if (choices.length === 0) {
        console.log('No features available')
        return
      }
      featureName = await select({ message: 'Select feature to turn off:', choices })
    }

    if (!(featureName in features)) {
      console.error(`Unknown feature: ${featureName}`)
      process.exit(1)
    }

    features[featureName] = false
    envJson.features = features
    writeEnvJson(envJsonPath, envJson)
    console.log(`Feature "${featureName}" is now off`)
  })

const agentCommand = new Command('agent').description('Manage agent features')

agentCommand.addCommand(onCommand)
agentCommand.addCommand(offCommand)

export { agentCommand }
