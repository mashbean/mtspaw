import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

const PLAYBOOKS_SRC_DIR = path.resolve(import.meta.dirname, '../../../src/playbooks')

const VERSION_RE = /^Version:\s*(.+)$/m

const parseVersion = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  const m = content.match(VERSION_RE)
  return m ? m[1].trim() : null
}

const listCommand = new Command('list')
  .description('List source playbooks with version comparison against the current workspace')
  .action(() => {
    if (!fs.existsSync(PLAYBOOKS_SRC_DIR)) {
      console.error(`Source playbooks dir not found: ${PLAYBOOKS_SRC_DIR}`)
      process.exit(1)
    }

    const sourceFiles = fs
      .readdirSync(PLAYBOOKS_SRC_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()

    const workspacePlaybooksDir = path.join(process.cwd(), 'playbooks')

    const rows = sourceFiles.map((file) => {
      const sourceVersion = parseVersion(path.join(PLAYBOOKS_SRC_DIR, file))
      const workspacePath = path.join(workspacePlaybooksDir, file)
      const workspaceExists = fs.existsSync(workspacePath)
      const workspaceVersion = workspaceExists ? parseVersion(workspacePath) : null

      let status: string
      if (!workspaceExists) {
        status = 'missing'
      } else if (sourceVersion !== null && workspaceVersion === null) {
        status = 'legacy'
      } else if (sourceVersion === null || workspaceVersion === null) {
        status = '?'
      } else if (sourceVersion === workspaceVersion) {
        status = 'ok'
      } else {
        status = 'different'
      }

      return { file, sourceVersion, workspaceVersion, workspaceExists, status }
    })

    const nameWidth = Math.max(...rows.map((r) => r.file.length))
    for (const row of rows) {
      const src = `source=${row.sourceVersion ?? '?'}`
      const wks = row.workspaceExists ? `workspace=${row.workspaceVersion ?? '?'}` : 'workspace=-'
      console.log(`${row.file.padEnd(nameWidth)}  ${src.padEnd(12)}  ${wks.padEnd(15)}  ${row.status}`)
    }
  })

const playbookCommand = new Command('playbook').description('Inspect playbook versions')

playbookCommand.addCommand(listCommand)

export { playbookCommand }
