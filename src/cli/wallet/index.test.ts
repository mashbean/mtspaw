import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  writeEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
}))
vi.mock('viem/accounts', () => ({
  generatePrivateKey: vi.fn(() => '0xprivkey'),
  privateKeyToAccount: vi.fn(() => ({ address: '0xaddress' })),
}))

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'
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
    it('creates a wallet and writes to env.json', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ email: 'a@b.com' })

      await walletCommand.parseAsync(['create'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', {
        email: 'a@b.com',
        wallet: { address: '0xaddress', privateKey: '0xprivkey' },
      })
      expect(console.log).toHaveBeenCalledWith('Wallet created: 0xaddress')
    })

    it('exits when wallet already exists without --force', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ wallet: { address: '0xold', privateKey: '0xold' } })

      await expect(walletCommand.parseAsync(['create'], { from: 'user' })).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Wallet already exists. Use --force to overwrite.')
      expect(writeEnvJson).not.toHaveBeenCalled()
    })

    it('overwrites existing wallet with --force', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ wallet: { address: '0xold', privateKey: '0xold' } })

      await walletCommand.parseAsync(['create', '--force'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', {
        wallet: { address: '0xaddress', privateKey: '0xprivkey' },
      })
    })
  })
})
