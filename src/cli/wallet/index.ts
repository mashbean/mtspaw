import fs from 'node:fs'

import { Command } from 'commander'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson } from '../../services/auth/index.js'
import { fetchGql, formatGqlErrors } from '../../services/gql/index.js'
import { requireWallet, requireWalletJsonPath, writeWalletJson } from '../../services/wallet/index.js'

const GENERATE_SIGNING_MESSAGE_MUTATION = `
  mutation GenerateSigningMessage($input: GenerateSigningMessageInput!) {
    generateSigningMessage(input: $input) {
      nonce
      signingMessage
    }
  }
`

const ADD_WALLET_LOGIN_MUTATION = `
  mutation AddWalletLogin($input: WalletLoginInput!) {
    addWalletLogin(input: $input) {
      id
      info {
        ethAddress
      }
    }
  }
`

const REMOVE_WALLET_LOGIN_MUTATION = `
  mutation RemoveWalletLogin {
    removeWalletLogin {
      id
    }
  }
`

const requireMattersApi = (envJson: Record<string, unknown>): string => {
  const mattersApi = envJson.mattersApi
  if (typeof mattersApi !== 'string' || !mattersApi) {
    console.error('Missing mattersApi in env.json')
    process.exit(1)
  }
  return mattersApi
}

const createCommand = new Command('create')
  .description('Create a new Ethereum wallet for this agent')
  .option('--force', 'Overwrite existing wallet')
  .action((opts: { force?: boolean }) => {
    const walletJsonPath = requireWalletJsonPath()

    if (fs.existsSync(walletJsonPath) && !opts.force) {
      console.error('Wallet already exists. Use --force to overwrite.')
      process.exit(1)
    }

    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)

    writeWalletJson(walletJsonPath, { address: account.address, privateKey })

    console.log(`Wallet created: ${account.address}`)
  })

const bindCommand = new Command('bind')
  .description('Bind the local wallet.json wallet to the current Matters account')
  .action(async () => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const { wallet } = requireWallet()

    try {
      const generated = await fetchGql(mattersApi, GENERATE_SIGNING_MESSAGE_MUTATION, {
        input: { address: wallet.address, purpose: 'connect' },
      })
      const generatedErr = formatGqlErrors(generated)
      if (generatedErr) {
        console.error('Failed to generate signing message:', generatedErr)
        process.exit(1)
      }

      const signingPayload = generated?.data?.generateSigningMessage
      if (!signingPayload?.nonce || !signingPayload?.signingMessage) {
        console.error('Invalid signing message response')
        process.exit(1)
      }

      const account = privateKeyToAccount(wallet.privateKey)
      const signature = await account.signMessage({ message: signingPayload.signingMessage })

      const { errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, ADD_WALLET_LOGIN_MUTATION, {
        input: {
          ethAddress: wallet.address,
          signedMessage: signingPayload.signingMessage,
          signature,
          nonce: signingPayload.nonce,
        },
      })

      if (errorMessage) {
        console.error('Bind failed:', errorMessage)
        process.exit(1)
      }

      console.log(`Wallet bound: ${wallet.address}`)
    } catch (err) {
      console.error('Bind failed:', (err as Error).message)
      process.exit(1)
    }
  })

const unbindCommand = new Command('unbind')
  .description('Remove the wallet currently bound to the Matters account')
  .action(async () => {
    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)

    try {
      const { errorMessage } = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, REMOVE_WALLET_LOGIN_MUTATION)

      if (errorMessage) {
        console.error('Unbind failed:', errorMessage)
        process.exit(1)
      }

      console.log('Wallet unbound')
    } catch (err) {
      console.error('Unbind failed:', (err as Error).message)
      process.exit(1)
    }
  })

const walletCommand = new Command('wallet').description('Manage agent Ethereum wallet')
walletCommand.addCommand(createCommand)
walletCommand.addCommand(bindCommand)
walletCommand.addCommand(unbindCommand)

export { walletCommand }
