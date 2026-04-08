import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

const SCHEMA_BASE_URL = 'https://raw.githubusercontent.com/thematters/matters-server'

const syncSchemaCommand = new Command('sync-schema')
  .description('Fetch the latest GraphQL schema from matters-server')
  .option('--branch <name>', 'Branch to fetch schema from', 'master')
  .action(async (opts) => {
    const branch = opts.branch as string

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
