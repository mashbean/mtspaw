import fs from 'node:fs'
import path from 'node:path'

import { input, select } from '@inquirer/prompts'
import { Command } from 'commander'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'

const sortFeatures = (features: Record<string, boolean>) => {
  return Object.fromEntries(Object.entries(features).sort(([a], [b]) => a.localeCompare(b)))
}

const requireEnvJson = () => {
  const envJsonPath = path.resolve(process.cwd(), 'env.json')
  if (!fs.existsSync(envJsonPath)) {
    console.error('env.json not found in current directory')
    process.exit(1)
  }
  return envJsonPath
}

const getFeatureChoices = (features: Record<string, boolean>) => {
  return Object.keys(features).map((key) => ({
    name: `${key} (${features[key] ? 'on' : 'off'})`,
    value: key,
  }))
}

const withFeature = async (
  opts: { feature?: string },
  config: {
    promptMessage: string
    promptType: 'select' | 'input'
    mustExist: boolean
    mutate: (features: Record<string, boolean>, name: string) => void
    successMessage: (name: string) => string
  },
) => {
  const envJsonPath = requireEnvJson()
  const envJson = readEnvJson(envJsonPath)
  const features = (envJson.features || {}) as Record<string, boolean>
  let featureName = opts.feature

  if (!featureName) {
    if (config.promptType === 'select') {
      const choices = getFeatureChoices(features)
      if (choices.length === 0) {
        console.log('No features available')
        return
      }
      featureName = await select({ message: config.promptMessage, choices })
    } else {
      featureName = await input({
        message: config.promptMessage,
        validate: (val) => {
          if (!val.trim()) {
            return 'Feature name is required'
          }
          return true
        },
      })
    }
  }

  if (config.mustExist && !(featureName in features)) {
    console.error(`Unknown feature: ${featureName}`)
    process.exit(1)
  }

  if (!config.mustExist && featureName in features) {
    console.error(`Feature already exists: ${featureName}`)
    process.exit(1)
  }

  config.mutate(features, featureName)
  envJson.features = sortFeatures(features)
  writeEnvJson(envJsonPath, envJson)
  console.log(config.successMessage(featureName))
}

const onCommand = new Command('on')
  .description('Turn on a feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    await withFeature(opts, {
      promptMessage: 'Select feature to turn on:',
      promptType: 'select',
      mustExist: true,
      mutate: (features, name) => {
        features[name] = true
      },
      successMessage: (name) => `Feature "${name}" is now on`,
    })
  })

const offCommand = new Command('off')
  .description('Turn off a feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    await withFeature(opts, {
      promptMessage: 'Select feature to turn off:',
      promptType: 'select',
      mustExist: true,
      mutate: (features, name) => {
        features[name] = false
      },
      successMessage: (name) => `Feature "${name}" is now off`,
    })
  })

const addCommand = new Command('add')
  .description('Add a new feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    await withFeature(opts, {
      promptMessage: 'Feature name:',
      promptType: 'input',
      mustExist: false,
      mutate: (features, name) => {
        features[name] = false
      },
      successMessage: (name) => `Feature "${name}" added`,
    })
  })

const removeFeatureCommand = new Command('remove')
  .description('Remove a feature')
  .option('--feature <name>', 'Feature name')
  .action(async (opts) => {
    await withFeature(opts, {
      promptMessage: 'Select feature to remove:',
      promptType: 'select',
      mustExist: true,
      mutate: (features, name) => {
        delete features[name]
      },
      successMessage: (name) => `Feature "${name}" removed`,
    })
  })

const featureCommand = new Command('feature').description('Manage features')

featureCommand.addCommand(onCommand)
featureCommand.addCommand(offCommand)
featureCommand.addCommand(addCommand)
featureCommand.addCommand(removeFeatureCommand)

export { featureCommand }
