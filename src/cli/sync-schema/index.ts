import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

const SCHEMA_BASE_URL = 'https://raw.githubusercontent.com/thematters/matters-server'

const syncSchemaCommand = new Command('sync-schema')
  .description('Fetch the latest GraphQL schema from matters-server')
  .option('--branch <name>', 'Branch to fetch schema from', 'master')
  .option('--ttl <hours>', 'Skip fetch if local schema is younger than this', '24')
  .option('--force', 'Force re-fetch even if local schema is fresh')
  .action(async (opts) => {
    const branch = opts.branch as string
    const force = Boolean(opts.force)
    const ttlHours = Number(opts.ttl)
    const destPath = path.resolve(import.meta.dirname, '../../schema.graphql')

    if (!force && fs.existsSync(destPath)) {
      const ageMs = Date.now() - fs.statSync(destPath).mtimeMs
      const ttlMs = ttlHours * 3600 * 1000

      if (ageMs < ttlMs) {
        const ageHours = (ageMs / 3600 / 1000).toFixed(1)
        console.log(`Schema is fresh (age: ${ageHours}h, ttl: ${ttlHours}h), skipped. Use --force to override.`)
        return
      }
    }

    console.log(`Fetching schema.graphql from matters-server (${branch})...`)

    const response = await fetch(`${SCHEMA_BASE_URL}/${branch}/schema.graphql`)
    if (!response.ok) {
      console.error(`Failed to fetch schema: ${response.status} ${response.statusText}`)
      process.exit(1)
    }

    const schema = await response.text()
    fs.writeFileSync(destPath, schema)

    console.log(`Schema saved to ${destPath}`)
  })

export { syncSchemaCommand }
