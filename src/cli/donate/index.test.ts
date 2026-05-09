import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const writeContract = vi.fn()
const readContract = vi.fn()
const getBalance = vi.fn()
const waitForTransactionReceipt = vi.fn()

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
vi.mock('../../services/wallet/index.js', () => ({
  requireWallet: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
  formatGqlErrors: vi.fn((result: unknown) => {
    const errors = (result as { errors?: { message: string }[] } | null)?.errors
    if (!errors || errors.length === 0) {
      return null
    }
    return errors.map((e) => e.message).join(', ')
  }),
  fromGlobalId: vi.fn(() => ({ type: 'User', id: '42' })),
}))
vi.mock('../../services/web3/index.js', () => {
  const networks = {
    production: {
      chain: { id: 10 },
      tokenAddress: '0xtoken',
      curationAddress: '0xcuration',
      curationVaultAddress: '0xvault',
      tokenDecimals: 6,
    },
    staging: {
      chain: { id: 11155420 },
      tokenAddress: '0xtokenStaging',
      curationAddress: '0xcurationStaging',
      curationVaultAddress: '0xvaultStaging',
      tokenDecimals: 6,
    },
  }
  return {
    networks,
    toCurationVaultUID: vi.fn((id: string) => `matters:${id}`),
    getPublicClient: vi.fn(() => ({ readContract, getBalance, waitForTransactionReceipt })),
    getWalletClient: vi.fn(() => ({ writeContract, account: { address: '0xagent' } })),
    resolveNetwork: vi.fn((envJson: Record<string, unknown>) => {
      const raw = (envJson.network as string | undefined) ?? 'production'
      if (!(raw in networks)) {
        console.error(`Unknown network in env.json: ${raw}. Use "production" or "staging".`)
        process.exit(1)
      }
      return raw
    }),
    readWalletBalances: vi.fn(
      async (
        publicClient: { readContract: typeof readContract; getBalance: typeof getBalance },
        config: { tokenAddress: string },
        address: string,
      ) => {
        const [usdtBalance, ethBalance] = await Promise.all([
          publicClient.readContract({
            address: config.tokenAddress,
            abi: [],
            functionName: 'balanceOf',
            args: [address],
          }),
          publicClient.getBalance({ address }),
        ])
        return { usdtBalance, ethBalance }
      },
    ),
  }
})

import { fetchGqlWithAuthRetry, readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { requireWallet } from '../../services/wallet/index.js'
import { donateCommand } from './index.js'

const setBaseEnv = () => {
  vi.mocked(readEnvJson).mockReturnValue({
    mattersApi: 'https://api',
    network: 'production',
  })
  vi.mocked(requireWallet).mockReturnValue({
    walletJsonPath: '/test/wallet.json',
    wallet: { address: '0xagent', privateKey: '0xkey' },
  })
}

const articleQueryResult = (overrides: Record<string, unknown> = {}) => ({
  data: {
    article: {
      id: 'Article:1',
      dataHash: 'QmHash',
      state: 'active',
      author: {
        id: 'User:42',
        info: { ethAddress: '0xauthor' },
      },
      ...overrides,
    },
  },
})

const payToDraft = {
  result: { data: { payTo: { transaction: { id: 'tx-draft', state: 'pending' } } } },
  errorMessage: null,
}
const payToSettle = {
  result: { data: { payTo: { transaction: { id: 'tx-final', state: 'succeeded' } } } },
  errorMessage: null,
}

describe('donate article command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    writeContract.mockReset()
    readContract.mockReset()
    getBalance.mockReset()
    waitForTransactionReceipt.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exits when wallet.json is missing', async () => {
    setBaseEnv()
    vi.mocked(requireWallet).mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(fetchGql).not.toHaveBeenCalled()
  })

  it('exits when article is not found', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce({ data: { article: null } })

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Article not found: abc')
  })

  it('exits when article is not active', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult({ state: 'archived' }))

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Article is not active (state: archived)')
  })

  it('falls back to matters web URL when dataHash is missing', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult({ dataHash: null }))
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(payToDraft).mockResolvedValueOnce(payToSettle)
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)
    writeContract.mockResolvedValueOnce('0xcurateHash')
    waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' })

    await donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' })

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'curate',
        args: ['0xauthor', '0xtoken', 1_000_000n, 'https://matters.town/a/abc'],
      }),
    )
  })

  it('exits on self-donation', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(
      articleQueryResult({ author: { id: 'User:42', info: { ethAddress: '0xAGENT' } } }),
    )

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Self-donation is not allowed (SelfCuration)')
  })

  it('exits on insufficient USDT balance', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult())
    readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Insufficient USDT balance'))
  })

  it('exits on zero ETH balance', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult())
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(0n)

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Native ETH balance is zero'))
  })

  it('runs the direct path with sufficient allowance', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult())
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(payToDraft).mockResolvedValueOnce(payToSettle)
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)
    writeContract.mockResolvedValueOnce('0xcurateHash')
    waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' })

    await donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' })

    expect(writeContract).toHaveBeenCalledTimes(1)
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xcuration',
        functionName: 'curate',
        args: ['0xauthor', '0xtoken', 1_000_000n, 'ipfs://QmHash'],
      }),
    )
    expect(fetchGqlWithAuthRetry).toHaveBeenNthCalledWith(
      2,
      '/test/env.json',
      'https://api',
      expect.stringContaining('payTo'),
      expect.objectContaining({ txHash: '0xcurateHash', id: 'tx-draft' }),
    )
  })

  it('runs the vault path when author has no ethAddress', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(
      articleQueryResult({ author: { id: 'User:42', info: { ethAddress: null } } }),
    )
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(payToDraft).mockResolvedValueOnce(payToSettle)
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)
    writeContract.mockResolvedValueOnce('0xvaultHash')
    waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' })

    await donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' })

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xvault',
        functionName: 'curate',
        args: ['matters:42', '0xtoken', 1_000_000n, 'ipfs://QmHash'],
      }),
    )
  })

  it('approves before curate when allowance is zero', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult())
    vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce(payToDraft).mockResolvedValueOnce(payToSettle)
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(0n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)
    writeContract.mockResolvedValueOnce('0xapproveHash').mockResolvedValueOnce('0xcurateHash')
    waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' }).mockResolvedValueOnce({ status: 'success' })

    await donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' })

    expect(writeContract).toHaveBeenCalledTimes(2)
    expect(writeContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: '0xtoken',
        functionName: 'approve',
        args: ['0xcuration', 1_000_000n],
      }),
    )
    expect(writeContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: '0xcuration',
        functionName: 'curate',
      }),
    )
  })

  it('exits non-zero when payTo settle fails after a successful on-chain transfer', async () => {
    setBaseEnv()
    vi.mocked(fetchGql).mockResolvedValueOnce(articleQueryResult())
    vi.mocked(fetchGqlWithAuthRetry)
      .mockResolvedValueOnce(payToDraft)
      .mockResolvedValueOnce({
        result: { errors: [{ message: 'settle exploded' }] },
        errorMessage: 'settle exploded',
      })
    readContract.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n)
    getBalance.mockResolvedValueOnce(10_000_000_000_000n)
    writeContract.mockResolvedValueOnce('0xcurateHash')
    waitForTransactionReceipt.mockResolvedValueOnce({ status: 'success' })

    await expect(
      donateCommand.parseAsync(['article', '--shortHash', 'abc', '--amount', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('payTo settle failed (on-chain succeeded, txHash=0xcurateHash)'),
      'settle exploded',
    )
  })
})
