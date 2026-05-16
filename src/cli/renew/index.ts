import fs from 'node:fs'
import path from 'node:path'

import { select } from '@inquirer/prompts'
import { Command } from 'commander'

const buildTargets = (): Record<string, { src: string; dest: string }> => ({
  'AGENTS.md': {
    src: path.resolve(import.meta.dirname, '../../../src/guides/AGENTS.md'),
    dest: path.join(process.cwd(), 'AGENTS.md'),
  },
  'comment-reply.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/comment-reply.md'),
    dest: path.join(process.cwd(), 'playbooks/comment-reply.md'),
  },
  'donate-article.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/donate-article.md'),
    dest: path.join(process.cwd(), 'playbooks/donate-article.md'),
  },
  'post-article.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/post-article.md'),
    dest: path.join(process.cwd(), 'playbooks/post-article.md'),
  },
  'post-trending-article.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/post-trending-article.md'),
    dest: path.join(process.cwd(), 'playbooks/post-trending-article.md'),
  },
  'spam-scan.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/spam-scan.md'),
    dest: path.join(process.cwd(), 'playbooks/spam-scan.md'),
  },
  'track-and-post-comment.md': {
    src: path.resolve(import.meta.dirname, '../../../src/playbooks/track-and-post-comment.md'),
    dest: path.join(process.cwd(), 'playbooks/track-and-post-comment.md'),
  },
})

const renewCommand = new Command('renew').description('Renew workspace files from source')

renewCommand
  .command('doc [mode]')
  .description('Refresh workspace doc(s). Pass "all" to refresh every doc.')
  .option('--target <name>', 'Doc to renew (AGENTS.md, post-article.md, track-and-post-comment.md)')
  .action(async (mode: string | undefined, options: { target?: string }) => {
    const targets = buildTargets()

    if (mode === 'all') {
      if (options.target) {
        console.error('--target cannot be combined with "all"')
        process.exit(1)
      }
      const entries = Object.entries(targets)
      for (const [name, entry] of entries) {
        if (!fs.existsSync(entry.src)) {
          console.error(`Source not found: ${entry.src} (${name})`)
          process.exit(1)
        }
      }
      for (const [, entry] of entries) {
        fs.mkdirSync(path.dirname(entry.dest), { recursive: true })
        fs.copyFileSync(entry.src, entry.dest)
        console.log(`Renewed: ${entry.dest}`)
      }
      return
    }

    if (mode) {
      console.error(`Unknown mode: ${mode}. Use "all" or omit and pass --target.`)
      process.exit(1)
    }

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
