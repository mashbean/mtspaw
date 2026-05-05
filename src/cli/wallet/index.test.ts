import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readContract = vi.fn()
const getBalance = vi.fn()

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
}))
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  requireMattersApi: vi.fn((envJson: Record<string, unknown>) => envJson.mattersApi as string),
  fetchGqlWithAuthRetry: vi.fn(),
}))
vi.mock('../../services/wallet/index.js', () => ({
  requireWallet: vi.fn(),
  requireWalletJsonPath: vi.fn(() => '/test/wallet.json'),
  writeWalletJson: vi.fn(),
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
    getPublicClient: vi.fn(() => ({ readContract, getBalance })),
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
vi.mock('viem/accounts', () => ({
  generatePrivateKey: vi.fn(() => '0xprivkey'),
  privateKeyToAccount: vi.fn(() => ({
    address: '0xaddress',
    signMessage: vi.fn(async () => '0xsignature'),
  })),
}))

import fs from 'node:fs'

import { fetchGqlWithAuthRetry, readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { requireWallet, writeWalletJson } from '../../services/wallet/index.js'
import { walletCommand } from './index.js'

describe('wallet command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('create', () => {
    it('creates a wallet and writes wallet.json', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await walletCommand.parseAsync(['create'], { from: 'user' })

      expect(writeWalletJson).toHaveBeenCalledWith('/test/wallet.json', {
        address: '0xaddress',
        privateKey: '0xprivkey',
      })
      expect(console.log).toHaveBeenCalledWith('Wallet created: 0xaddress')
    })

    it('exits when wallet.json already exists without --force', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await expect(walletCommand.parseAsync(['create'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Wallet already exists. Use --force to overwrite.')
      expect(writeWalletJson).not.toHaveBeenCalled()
    })

    it('overwrites existing wallet.json with --force', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await walletCommand.parseAsync(['create', '--force'], { from: 'user' })

      expect(writeWalletJson).toHaveBeenCalledWith('/test/wallet.json', {
        address: '0xaddress',
        privateKey: '0xprivkey',
      })
    })
  })

  describe('bind', () => {
    it('exits when wallet.json is missing', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api' })
      vi.mocked(requireWallet).mockImplementation(() => {
        throw new Error('process.exit')
      })

      await expect(walletCommand.parseAsync(['bind'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(fetchGql).not.toHaveBeenCalled()
    })

    it('binds wallet successfully', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api' })
      vi.mocked(requireWallet).mockReturnValue({
        walletJsonPath: '/test/wallet.json',
        wallet: { address: '0xabc', privateKey: '0xkey' },
      })
      vi.mocked(fetchGql).mockResolvedValueOnce({
        data: { generateSigningMessage: { nonce: 'nonce1', signingMessage: 'msg' } },
      })
      vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
        result: { data: { addWalletLogin: { id: 'u1', info: { ethAddress: '0xabc' } } } },
        errorMessage: null,
      })

      await walletCommand.parseAsync(['bind'], { from: 'user' })

      expect(fetchGql).toHaveBeenCalledWith('https://api', expect.stringContaining('generateSigningMessage'), {
        input: { address: '0xabc', purpose: 'connect' },
      })
      expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
        '/test/env.json',
        'https://api',
        expect.stringContaining('addWalletLogin'),
        { input: { ethAddress: '0xabc', signedMessage: 'msg', signature: '0xsignature', nonce: 'nonce1' } },
      )
      expect(console.log).toHaveBeenCalledWith('Wallet bound: 0xabc')
    })

    it('surfaces server errors from addWalletLogin', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api' })
      vi.mocked(requireWallet).mockReturnValue({
        walletJsonPath: '/test/wallet.json',
        wallet: { address: '0xabc', privateKey: '0xkey' },
      })
      vi.mocked(fetchGql).mockResolvedValueOnce({
        data: { generateSigningMessage: { nonce: 'nonce1', signingMessage: 'msg' } },
      })
      vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
        result: { errors: [{ message: 'already bound' }] },
        errorMessage: 'already bound',
      })

      await expect(walletCommand.parseAsync(['bind'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Bind failed:', 'already bound')
    })
  })

  describe('unbind', () => {
    it('removes wallet binding successfully', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api' })
      vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
        result: { data: { removeWalletLogin: { id: 'u1' } } },
        errorMessage: null,
      })

      await walletCommand.parseAsync(['unbind'], { from: 'user' })

      expect(fetchGqlWithAuthRetry).toHaveBeenCalledWith(
        '/test/env.json',
        'https://api',
        expect.stringContaining('removeWalletLogin'),
      )
      expect(console.log).toHaveBeenCalledWith('Wallet unbound')
    })

    it('exits when server returns an error', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api' })
      vi.mocked(fetchGqlWithAuthRetry).mockResolvedValueOnce({
        result: { errors: [{ message: 'no wallet to remove' }] },
        errorMessage: 'no wallet to remove',
      })

      await expect(walletCommand.parseAsync(['unbind'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Unbind failed:', 'no wallet to remove')
    })
  })

  describe('balance', () => {
    beforeEach(() => {
      readContract.mockReset()
      getBalance.mockReset()
    })

    it('prints USDT and ETH balances on production', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ network: 'production' })
      vi.mocked(requireWallet).mockReturnValue({
        walletJsonPath: '/test/wallet.json',
        wallet: { address: '0xagent', privateKey: '0xkey' },
      })
      readContract.mockResolvedValueOnce(1_234_567n)
      getBalance.mockResolvedValueOnce(1_234_000_000_000_000n)

      await walletCommand.parseAsync(['balance'], { from: 'user' })

      expect(console.log).toHaveBeenCalledWith('USDT: 1.234567')
      expect(console.log).toHaveBeenCalledWith('ETH: 0.001234')
    })

    it('uses staging contracts when network is staging', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ network: 'staging' })
      vi.mocked(requireWallet).mockReturnValue({
        walletJsonPath: '/test/wallet.json',
        wallet: { address: '0xagent', privateKey: '0xkey' },
      })
      readContract.mockResolvedValueOnce(0n)
      getBalance.mockResolvedValueOnce(0n)

      await walletCommand.parseAsync(['balance'], { from: 'user' })

      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({ address: '0xtokenStaging', args: ['0xagent'] }),
      )
      expect(console.log).toHaveBeenCalledWith('USDT: 0')
      expect(console.log).toHaveBeenCalledWith('ETH: 0')
    })

    it('exits on unknown network', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ network: 'mainnet' })

      await expect(walletCommand.parseAsync(['balance'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Unknown network in env.json: mainnet. Use "production" or "staging".')
    })
  })
})
