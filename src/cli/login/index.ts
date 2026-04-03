import fs from 'node:fs'
import path from 'node:path'

import { Command } from 'commander'

import { clearTokens, login } from '../../services/auth/index.js'

const loginCommand = new Command('login')
  .description('Login to Matters API using workspace env.json')
  .action(async () => {
    const envJsonPath = path.resolve(process.cwd(), 'env.json')

    if (!fs.existsSync(envJsonPath)) {
      console.error('env.json not found in current directory')
      process.exit(1)
    }

    console.log(`Using env.json from: ${envJsonPath}`)

    try {
      await login(envJsonPath)
    } catch (err) {
      console.error('Login failed:', (err as Error).message)
      clearTokens(envJsonPath)
      process.exit(1)
    }
  })

export { loginCommand }
