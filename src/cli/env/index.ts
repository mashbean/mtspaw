import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

import { readEnvJson } from '../../services/auth/index.js'

const envCommand = new Command('env').description('Print the current env.json').action(() => {
  const envJsonPath = path.resolve(process.cwd(), 'env.json')

  if (!fs.existsSync(envJsonPath)) {
    console.error('env.json not found in current directory')
    process.exit(1)
  }

  console.log(`Path: ${envJsonPath}`)
  const envJson = readEnvJson(envJsonPath)
  const safe = {
    ...envJson,
    password: '***',
  }
  console.log(JSON.stringify(safe, null, 2))
})

export { envCommand }
