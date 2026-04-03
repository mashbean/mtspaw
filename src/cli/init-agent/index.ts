import fs from 'node:fs'
import os from 'node:os'
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

  const rawOpenclawPath = process.env.OPENCLAW_PATH || ''
  const openclawPath =
    rawOpenclawPath === '~' || rawOpenclawPath.startsWith('~/')
      ? rawOpenclawPath.replace('~', os.homedir())
      : rawOpenclawPath
  const mattersApi = process.env.MATTERS_API || ''

  const workspaceDir = path.resolve(openclawPath, `workspace-${agentName}`)

  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true })
  }

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

  const playbooksSrc = path.resolve(import.meta.dirname, '../../../src/playbooks')
  const playbooksDest = path.join(workspaceDir, 'playbooks')

  if (!fs.existsSync(playbooksDest)) {
    fs.mkdirSync(playbooksDest, { recursive: true })
    const files = fs.readdirSync(playbooksSrc)
    for (const file of files) {
      fs.copyFileSync(path.join(playbooksSrc, file), path.join(playbooksDest, file))
    }
    console.log(`Copied playbooks to: ${playbooksDest}`)
  }

  console.log(`Initialized workspace: ${workspaceDir}`)
})

export { initAgentCommand }
