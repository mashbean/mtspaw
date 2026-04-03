import fs from 'node:fs'
import path from 'node:path'

import { input, password } from '@inquirer/prompts'
import { Command } from 'commander'

const requiredValidator = (label: string) => (val: string) => {
  if (!val.trim()) {
    return `${label} is required`
  }
  return true
}

const initAgentCommand = new Command('init-agent').description('Initialize a new agent workspace').action(async () => {
  const agentName = await input({ message: 'Agent Name:', validate: requiredValidator('Agent Name') })
  const email = await input({ message: 'Account Email:', validate: requiredValidator('Account Email') })
  const pwd = await password({
    message: 'Account Password:',
    mask: '*',
    validate: requiredValidator('Account Password'),
  })
  const mattersId = await input({ message: 'Matters ID:', validate: requiredValidator('Matters ID') })
  const mattersDisplayName = await input({
    message: 'Matters Display Name:',
    validate: requiredValidator('Matters Display Name'),
  })

  const openclawPath = process.env.OPENCLAW_PATH || ''
  const mattersApi = process.env.MATTERS_API || ''

  const workspaceDir = path.resolve(openclawPath, `workspace-${agentName}`)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const envJson = {
    openclawPath,
    mattersApi,
    email,
    password: pwd,
    userName: mattersId,
    displayName: mattersDisplayName,
    features: {
      article: false,
      comment: false,
    },
  }
  fs.writeFileSync(path.join(workspaceDir, 'env.json'), JSON.stringify(envJson, null, 2))

  fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), '')
  fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), '')
  fs.writeFileSync(path.join(workspaceDir, 'TOOLS.md'), '')

  console.log(`Created workspace: ${workspaceDir}`)
})

export { initAgentCommand }
