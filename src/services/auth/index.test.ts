import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearTokens, ensureAuth, login, readEnvJson, writeEnvJson } from './index.js'

vi.mock('node:fs')
vi.mock('../gql/index.js', () => ({
  fetchGql: vi.fn(),
}))

import { fetchGql } from '../gql/index.js'

const mockEnvJson = {
  mattersApi: 'https://api.test',
  email: 'test@test.com',
  password: 'pass123',
  accessToken: '',
  accessTokenExpiredAt: '',
}

describe('auth service', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readEnvJson', () => {
    it('reads and parses env.json', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockEnvJson))
      const result = readEnvJson('/test/env.json')
      expect(result).toEqual(mockEnvJson)
    })
  })

  describe('writeEnvJson', () => {
    it('writes json to file', () => {
      writeEnvJson('/test/env.json', mockEnvJson)
      expect(fs.writeFileSync).toHaveBeenCalledWith('/test/env.json', JSON.stringify(mockEnvJson, null, 2))
    })
  })

  describe('clearTokens', () => {
    it('clears accessToken and accessTokenExpiredAt', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ ...mockEnvJson, accessToken: 'old-token' }))
      clearTokens('/test/env.json')
      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string)
      expect(written.accessToken).toBe('')
      expect(written.accessTokenExpiredAt).toBe('')
    })
  })

  describe('login', () => {
    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockEnvJson))
      vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    it('returns token on success', async () => {
      vi.mocked(fetchGql).mockResolvedValue({
        data: { emailLogin: { auth: true, token: 'new-token' } },
      })

      const token = await login('/test/env.json')
      expect(token).toBe('new-token')
    })

    it('throws on API errors', async () => {
      vi.mocked(fetchGql).mockResolvedValue({
        errors: [{ message: 'Invalid credentials' }],
      })

      await expect(login('/test/env.json')).rejects.toThrow('Invalid credentials')
    })

    it('throws when no token returned', async () => {
      vi.mocked(fetchGql).mockResolvedValue({
        data: { emailLogin: { auth: false, token: null } },
      })

      await expect(login('/test/env.json')).rejects.toThrow('No token returned')
    })

    it('throws when missing credentials', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ mattersApi: '', email: '', password: '' }))

      await expect(login('/test/env.json')).rejects.toThrow('Missing mattersApi')
    })
  })

  describe('ensureAuth', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    it('returns existing token if not expired', async () => {
      const future = new Date(Date.now() + 60000).toISOString()
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ ...mockEnvJson, accessToken: 'valid-token', accessTokenExpiredAt: future }),
      )

      const token = await ensureAuth('/test/env.json')
      expect(token).toBe('valid-token')
    })

    it('re-logs in when token is expired', async () => {
      const past = new Date(Date.now() - 60000).toISOString()
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ ...mockEnvJson, accessToken: 'old-token', accessTokenExpiredAt: past }),
      )
      vi.mocked(fetchGql).mockResolvedValue({
        data: { emailLogin: { auth: true, token: 'fresh-token' } },
      })

      const token = await ensureAuth('/test/env.json')
      expect(token).toBe('fresh-token')
    })
  })
})
