import fs from 'node:fs'
import path from 'node:path'

import { select } from '@inquirer/prompts'
import { Command } from 'commander'

const SCHEMA_BASE_URL = 'https://raw.githubusercontent.com/thematters/matters-server'

const syncSchemaCommand = new Command('sync-schema')
  .description('Fetch the latest GraphQL schema from matters-server')
  .action(async () => {
    const branch = await select({
      message: 'Select branch:',
      choices: [
        { name: 'master', value: 'master' },
        { name: 'develop', value: 'develop' },
      ],
    })

    console.log(`Fetching schema.graphql from matters-server (${branch})...`)

    const response = await fetch(`${SCHEMA_BASE_URL}/${branch}/schema.graphql`)
    if (!response.ok) {
      console.error(`Failed to fetch schema: ${response.status} ${response.statusText}`)
      process.exit(1)
    }

    const schema = await response.text()
    const destPath = path.resolve(import.meta.dirname, '../../schema.graphql')
    fs.writeFileSync(destPath, schema)

    console.log(`Schema saved to ${destPath}`)
  })

export { syncSchemaCommand }
