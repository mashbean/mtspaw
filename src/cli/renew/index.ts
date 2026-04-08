import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

const renewCommand = new Command('renew').description('Renew workspace files from source')

renewCommand
  .command('doc')
  .description('Refresh AGENTS.md in the current workspace')
  .action(() => {
    const src = path.resolve(import.meta.dirname, '../../../src/guides/AGENTS.md')
    const dest = path.join(process.cwd(), 'AGENTS.md')

    if (!fs.existsSync(src)) {
      console.error(`Source not found: ${src}`)
      process.exit(1)
    }

    fs.copyFileSync(src, dest)
    console.log(`Renewed: ${dest}`)
  })

export { renewCommand }
