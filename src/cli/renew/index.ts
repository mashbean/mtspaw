import fs from 'node:fs'
import path from 'node:path'

import { select } from '@inquirer/prompts'
import { Command } from 'commander'

const buildTargets = (): Record<string, { src: string; dest: string }> => ({
  'AGENTS.md': {
    src: path.resolve(import.meta.dirname, '../../../src/guides/AGENTS.md'),
    dest: path.join(process.cwd(), 'AGENTS.md'),
  },
  'post-article.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/post-article.md'),
    dest: path.join(process.cwd(), 'playbooks/post-article.md'),
  },
  'track-and-post-comment.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/track-and-post-comment.md'),
    dest: path.join(process.cwd(), 'playbooks/track-and-post-comment.md'),
  },
})

const renewCommand = new Command('renew').description('Renew workspace files from source')

renewCommand
  .command('doc')
  .description('Refresh a doc in the current workspace')
  .option('--target <name>', 'Doc to renew (AGENTS.md, post-article.md, track-and-post-comment.md)')
  .action(async (options: { target?: string }) => {
    const targets = buildTargets()
    let chosen = options.target

    if (!chosen) {
      chosen = await select({
        message: 'Select a doc to renew',
        choices: Object.keys(targets).map((name) => ({ name, value: name })),
      })
    }

    const entry = targets[chosen]

    if (!entry) {
      console.error(`Unknown target: ${chosen}`)
      console.error(`Available targets: ${Object.keys(targets).join(', ')}`)
      process.exit(1)
    }

    if (!fs.existsSync(entry.src)) {
      console.error(`Source not found: ${entry.src}`)
      process.exit(1)
    }

    fs.mkdirSync(path.dirname(entry.dest), { recursive: true })
    fs.copyFileSync(entry.src, entry.dest)
    console.log(`Renewed: ${entry.dest}`)
  })

export { renewCommand }
