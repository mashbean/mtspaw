import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkbox, input, password } from '@inquirer/prompts'
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
  const enabledFeatures = await checkbox({
    message: 'Enable features (space to toggle, enter to confirm):',
    choices: [
      { name: 'article', value: 'article' },
      { name: 'comment', value: 'comment' },
      { name: 'comment_like', value: 'comment_like' },
      { name: 'comment_reply', value: 'comment_reply' },
      { name: 'wallet', value: 'wallet' },
      { name: 'donate', value: 'donate' },
      { name: 'spam_scan', value: 'spam_scan' },
    ],
  })

  const rawOpenclawPath = process.env.OPENCLAW_PATH || ''
  const openclawPath =
    rawOpenclawPath === '~' || rawOpenclawPath.startsWith('~/')
      ? rawOpenclawPath.replace('~', os.homedir())
      : rawOpenclawPath
  const mattersApi = process.env.MATTERS_API || ''

  const workspaceDir = path.resolve(openclawPath, `workspace/${agentName}`)

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
    network: 'production',
    features: {
      article: enabledFeatures.includes('article'),
      comment: enabledFeatures.includes('comment'),
      comment_like: enabledFeatures.includes('comment_like'),
      comment_reply: enabledFeatures.includes('comment_reply'),
      wallet: enabledFeatures.includes('wallet'),
      donate: enabledFeatures.includes('donate'),
      spam_scan: enabledFeatures.includes('spam_scan'),
    },
    thresholds: {
      comment: 80,
      donate: 85,
    },
    slack: {
      token: '',
      channel: '',
    },
  }
  fs.writeFileSync(path.join(workspaceDir, 'env.json'), JSON.stringify(envJson, null, 2))

  const spamScanChannelsPath = path.join(workspaceDir, 'spam-scan-channels.json')
  if (!fs.existsSync(spamScanChannelsPath)) {
    const channels = {
      feeds: [
        { type: 'icymi' },
        { type: 'hottest' },
        { type: 'channel', shortHash: 'nycmlq5d4w8a' },
        { type: 'channel', shortHash: 'iac3sxh237g7' },
        { type: 'channel', shortHash: 'q6yptbvr0ph7' },
        { type: 'channel', shortHash: 'bzs4ay4fzmkg' },
        { type: 'channel', shortHash: '1ptnue2cleq4' },
        { type: 'channel', shortHash: 'koumlwiel7va' },
        { type: 'channel', shortHash: '9cl0utzfi7s0' },
      ],
    }
    fs.writeFileSync(spamScanChannelsPath, JSON.stringify(channels, null, 2))
    console.log(`Seeded spam-scan channels: ${spamScanChannelsPath}`)
  }

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

  const agentsMdSrc = path.resolve(import.meta.dirname, '../../guides/AGENTS.md')
  const agentsMdDest = path.join(workspaceDir, 'AGENTS.md')
  if (!fs.existsSync(agentsMdDest)) {
    fs.copyFileSync(agentsMdSrc, agentsMdDest)
    console.log(`Copied AGENTS.md to: ${agentsMdDest}`)
  }

  const memoryPath = path.join(workspaceDir, 'MEMORY.md')
  if (!fs.existsSync(memoryPath)) {
    const memoryTemplate =
      '# Memory\n\n' +
      '<!-- Format:\n' +
      '[YYYY-MM-DD HH:mm:ss]\n' +
      '- Summary: <1-2 sentence description of the content itself>\n' +
      '- Keywords: <kw1, kw2, kw3>\n' +
      '-->\n' +
      '<!-- Keep at most 12 records, newest on top. -->\n'
    fs.writeFileSync(memoryPath, memoryTemplate)
    console.log(`Created memory file: ${memoryPath}`)
  }

  console.log(`Initialized workspace: ${workspaceDir}`)
})

export { initAgentCommand }
