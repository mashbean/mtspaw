import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readWalletJson, requireWallet, requireWalletJsonPath, writeWalletJson } from './index.js'

vi.mock('node:fs')

describe('wallet service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('requireWalletJsonPath', () => {
    it('resolves to wallet.json in cwd', () => {
      expect(requireWalletJsonPath()).toBe('/test/wallet.json')
    })
  })

  describe('readWalletJson', () => {
    it('parses the wallet file', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ address: '0xabc', privateKey: '0xkey' }))
      expect(readWalletJson('/test/wallet.json')).toEqual({ address: '0xabc', privateKey: '0xkey' })
    })
  })

  describe('writeWalletJson', () => {
    it('writes JSON with two-space indent', () => {
      const writeSpy = vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
      const wallet = { address: '0xabc' as `0x${string}`, privateKey: '0xkey' as `0x${string}` }

      writeWalletJson('/test/wallet.json', wallet)

      expect(writeSpy).toHaveBeenCalledWith('/test/wallet.json', JSON.stringify(wallet, null, 2))
    })
  })

  describe('requireWallet', () => {
    it('returns wallet payload when wallet.json exists and is valid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ address: '0xabc', privateKey: '0xkey' }))

      const result = requireWallet()

      expect(result).toEqual({
        walletJsonPath: '/test/wallet.json',
        wallet: { address: '0xabc', privateKey: '0xkey' },
      })
    })

    it('exits when wallet.json does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(() => requireWallet()).toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('No wallet found. Run `mtspaw wallet create` first.')
    })

    it('exits when wallet payload is missing fields', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ address: '0xabc' }))

      expect(() => requireWallet()).toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith(
        'wallet.json is missing address or privateKey. Run `mtspaw wallet create --force` to recreate.',
      )
    })
  })
})
