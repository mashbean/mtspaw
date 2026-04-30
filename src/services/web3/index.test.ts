import { describe, expect, it } from 'vitest'

import { networks, toCurationVaultUID } from './index.js'

describe('web3 helpers', () => {
  describe('toCurationVaultUID', () => {
    it('formats a userId into matters: prefix', () => {
      expect(toCurationVaultUID('123')).toBe('matters:123')
    })
  })

  describe('networks', () => {
    it('exposes production and staging entries with required fields', () => {
      for (const key of ['production', 'staging'] as const) {
        const entry = networks[key]
        expect(entry.tokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(entry.curationAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(entry.curationVaultAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(entry.tokenDecimals).toBe(6)
      }
    })

    it('uses Optimism mainnet for production and Optimism Sepolia for staging', () => {
      expect(networks.production.chain.id).toBe(10)
      expect(networks.staging.chain.id).toBe(11155420)
    })
  })
})
