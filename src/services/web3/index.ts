import type { Chain } from 'viem'
import { createPublicClient, createWalletClient, erc20Abi, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism, optimismSepolia } from 'viem/chains'

type Network = 'production' | 'staging'

interface NetworkConfig {
  chain: Chain
  tokenAddress: `0x${string}`
  curationAddress: `0x${string}`
  curationVaultAddress: `0x${string}`
  tokenDecimals: number
}

const DEFAULT_NETWORK: Network = 'production'

const networks: Record<Network, NetworkConfig> = {
  production: {
    chain: optimism,
    tokenAddress: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    curationAddress: '0x5edebbdae7B5C79a69AaCF7873796bb1Ec664DB8',
    curationVaultAddress: '0x79691206F498CdfAEDD059A48f61835408d81a2F',
    tokenDecimals: 6,
  },
  staging: {
    chain: optimismSepolia,
    tokenAddress: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    curationAddress: '0x92a117aeA74963Cd0CEdF9C50f99435451a291F7',
    curationVaultAddress: '0xd41be66Bf309Ce5c3949BDe5C8091edc4870c27F',
    tokenDecimals: 6,
  },
}

const isNetwork = (value: string): value is Network => {
  return value in networks
}

const resolveNetwork = (envJson: Record<string, unknown>): Network => {
  const raw = (envJson.network as string | undefined) ?? DEFAULT_NETWORK
  if (!isNetwork(raw)) {
    console.error(`Unknown network in env.json: ${raw}. Use "production" or "staging".`)
    process.exit(1)
  }
  return raw
}

const toCurationVaultUID = (userId: string) => {
  return `matters:${userId}`
}

const getPublicClient = (network: Network) => {
  return createPublicClient({
    chain: networks[network].chain,
    transport: http(),
  })
}

const getWalletClient = (network: Network, privateKey: `0x${string}`) => {
  return createWalletClient({
    chain: networks[network].chain,
    transport: http(),
    account: privateKeyToAccount(privateKey),
  })
}

const readWalletBalances = async (
  publicClient: ReturnType<typeof getPublicClient>,
  config: NetworkConfig,
  address: `0x${string}`,
) => {
  const [usdtBalance, ethBalance] = await Promise.all([
    publicClient.readContract({
      address: config.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    publicClient.getBalance({ address }),
  ])
  return { usdtBalance, ethBalance }
}

export {
  DEFAULT_NETWORK,
  getPublicClient,
  getWalletClient,
  isNetwork,
  networks,
  readWalletBalances,
  resolveNetwork,
  toCurationVaultUID,
}
export type { Network, NetworkConfig }
