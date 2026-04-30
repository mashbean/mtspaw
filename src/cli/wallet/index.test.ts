import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
}))
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
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
})
