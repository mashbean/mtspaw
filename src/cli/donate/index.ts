import { input } from '@inquirer/prompts'
import { Command } from 'commander'
import { erc20Abi, parseUnits } from 'viem'

import { fetchGqlWithAuthRetry, readEnvJson, requireEnvJson, requireMattersApi } from '../../services/auth/index.js'
import { fetchGql, formatGqlErrors, fromGlobalId } from '../../services/gql/index.js'
import { requireWallet } from '../../services/wallet/index.js'
import { curationAbi } from '../../services/web3/abis/curation.js'
import { curationVaultAbi } from '../../services/web3/abis/curationVault.js'
import {
  getPublicClient,
  getWalletClient,
  networks,
  readWalletBalances,
  resolveNetwork,
  toCurationVaultUID,
} from '../../services/web3/index.js'

const ARTICLE_QUERY = `
  query Article($input: ArticleInput!) {
    article(input: $input) {
      id
      dataHash
      state
      author {
        id
        info {
          ethAddress
        }
      }
    }
  }
`

const PAY_TO_MUTATION = `
  mutation PayTo(
    $amount: Float!
    $currency: TransactionCurrency!
    $purpose: TransactionPurpose!
    $recipientId: ID!
    $targetId: ID
    $chain: Chain
    $txHash: String
    $id: ID
  ) {
    payTo(
      input: {
        amount: $amount
        currency: $currency
        purpose: $purpose
        recipientId: $recipientId
        targetId: $targetId
        chain: $chain
        txHash: $txHash
        id: $id
      }
    ) {
      transaction {
        id
        state
      }
    }
  }
`

interface ArticleResponse {
  data?: {
    article?: {
      id: string
      dataHash: string | null
      state: string
      author: {
        id: string
        info: { ethAddress: `0x${string}` | null }
      } | null
    } | null
  }
  errors?: { message: string }[]
}

const validateAmount = (raw: string): string | true => {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return 'Amount must be a positive number with up to 2 decimal places'
  }
  if (Number(raw) <= 0) {
    return 'Amount must be greater than zero'
  }
  return true
}

const articleCommand = new Command('article')
  .description('Donate USDT to an article author on Optimism')
  .option('--shortHash <hash>', 'Article short hash (from URL)')
  .option('--amount <usdt>', 'Amount in USDT (up to 2 decimal places)', '0.1')
  .action(async (opts: { shortHash?: string; amount: string }) => {
    const shortHash =
      opts.shortHash ??
      (await input({
        message: 'Article short hash:',
        validate: (val) => (val.trim() ? true : 'Article short hash is required'),
      }))

    const amountRaw = opts.amount
    const validation = validateAmount(amountRaw)
    if (validation !== true) {
      console.error(validation)
      process.exit(1)
    }
    const amount = Number(amountRaw)

    const envJsonPath = requireEnvJson()
    const envJson = readEnvJson(envJsonPath)
    const mattersApi = requireMattersApi(envJson)
    const network = resolveNetwork(envJson)
    const config = networks[network]

    const { wallet } = requireWallet()

    const articleResult = (await fetchGql(mattersApi, ARTICLE_QUERY, { input: { shortHash } })) as ArticleResponse
    const articleErr = formatGqlErrors(articleResult)
    if (articleErr) {
      console.error('Article query failed:', articleErr)
      process.exit(1)
    }
    const article = articleResult?.data?.article
    if (!article) {
      console.error(`Article not found: ${shortHash}`)
      process.exit(1)
    }
    if (article.state !== 'active') {
      console.error(`Article is not active (state: ${article.state})`)
      process.exit(1)
    }
    if (!article.dataHash) {
      console.error('Article is missing dataHash; cannot construct uri')
      process.exit(1)
    }
    const author = article.author
    if (!author?.id) {
      console.error('Article author id missing')
      process.exit(1)
    }

    const recipientEthAddress = author.info?.ethAddress ?? null
    const useVault = !recipientEthAddress
    const vaultUID = useVault ? toCurationVaultUID(fromGlobalId(author.id).id) : null

    if (recipientEthAddress && recipientEthAddress.toLowerCase() === wallet.address.toLowerCase()) {
      console.error('Self-donation is not allowed (SelfCuration)')
      process.exit(1)
    }

    const parsedAmount = parseUnits(amountRaw, config.tokenDecimals)
    const uri = `ipfs://${article.dataHash}`
    const spender = useVault ? config.curationVaultAddress : config.curationAddress

    const publicClient = getPublicClient(network)
    const walletClient = getWalletClient(network, wallet.privateKey)

    const [{ usdtBalance, ethBalance }, allowance] = await Promise.all([
      readWalletBalances(publicClient, config, wallet.address),
      publicClient.readContract({
        address: config.tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [wallet.address, spender],
      }),
    ])

    if (usdtBalance < parsedAmount) {
      console.error(`Insufficient USDT balance: have ${usdtBalance}, need ${parsedAmount}`)
      process.exit(1)
    }
    if (ethBalance === 0n) {
      console.error('Native ETH balance is zero on Optimism; cannot pay gas')
      process.exit(1)
    }

    console.log(`Agent: ${wallet.address}`)
    console.log(`Article: ${article.id}`)
    console.log(`Path: ${useVault ? 'vault' : 'direct'} -> ${useVault ? vaultUID : recipientEthAddress}`)
    console.log(`Amount: ${amount} USDT`)

    if (allowance < parsedAmount) {
      console.log('Approving USDT spend...')
      const approveHash = await walletClient.writeContract({
        address: config.tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, parsedAmount],
      })
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash })
      if (approveReceipt.status !== 'success') {
        console.error(`approve tx reverted: ${approveHash}`)
        process.exit(1)
      }
      console.log(`Approve tx: ${approveHash}`)
    }

    const payToBase = {
      amount,
      currency: 'USDT',
      purpose: 'donation',
      recipientId: author.id,
      targetId: article.id,
      chain: 'Optimism',
    }

    const draft = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, PAY_TO_MUTATION, payToBase)
    if (draft.errorMessage) {
      console.error('payTo draft failed:', draft.errorMessage)
      process.exit(1)
    }
    const draftTxId = (draft.result as { data?: { payTo?: { transaction?: { id?: string } } } })?.data?.payTo
      ?.transaction?.id
    if (!draftTxId) {
      console.error('payTo draft did not return a transaction id')
      process.exit(1)
    }

    let curateHash: `0x${string}`
    try {
      curateHash = useVault
        ? await walletClient.writeContract({
            address: config.curationVaultAddress,
            abi: curationVaultAbi,
            functionName: 'curate',
            args: [vaultUID!, config.tokenAddress, parsedAmount, uri],
          })
        : await walletClient.writeContract({
            address: config.curationAddress,
            abi: curationAbi,
            functionName: 'curate',
            args: [recipientEthAddress!, config.tokenAddress, parsedAmount, uri],
          })
    } catch (err) {
      console.error('curate failed:', (err as Error).message)
      process.exit(1)
    }

    console.log(`Curate tx submitted: ${curateHash}`)
    const curateReceipt = await publicClient.waitForTransactionReceipt({ hash: curateHash })
    if (curateReceipt.status !== 'success') {
      console.error(`curate tx reverted: ${curateHash}`)
      process.exit(1)
    }

    const settle = await fetchGqlWithAuthRetry(envJsonPath, mattersApi, PAY_TO_MUTATION, {
      ...payToBase,
      txHash: curateHash,
      id: draftTxId,
    })
    if (settle.errorMessage) {
      console.error(`payTo settle failed (on-chain succeeded, txHash=${curateHash}):`, settle.errorMessage)
      process.exit(1)
    }

    const tx = (settle.result as { data?: { payTo?: { transaction?: { id?: string; state?: string } } } })?.data?.payTo
      ?.transaction
    console.log(`Donation complete. Transaction ${tx?.id} state=${tx?.state} txHash=${curateHash}`)
  })

const donateCommand = new Command('donate').description('Donate USDT to article authors on Optimism')
donateCommand.addCommand(articleCommand)

export { donateCommand }
