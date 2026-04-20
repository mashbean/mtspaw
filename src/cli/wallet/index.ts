import { Command } from 'commander'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { readEnvJson, requireEnvJson, writeEnvJson } from '../../services/auth/index.js'

const createCommand = new Command('create')
  .description('Create a new Ethereum wallet for this agent')
  .option('--force', 'Overwrite existing wallet')
  .action((opts: { force?: boolean }) => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)

    if (envJson.wallet && !opts.force) {
      console.error('Wallet already exists. Use --force to overwrite.')
      process.exit(1)
    }

    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)

    envJson.wallet = {
      address: account.address,
      privateKey,
    }
    writeEnvJson(envJsonPath, envJson)

    console.log(`Wallet created: ${account.address}`)
  })

const walletCommand = new Command('wallet').description('Manage agent Ethereum wallet')
walletCommand.addCommand(createCommand)

export { walletCommand }
