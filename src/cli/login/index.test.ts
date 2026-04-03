import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  login: vi.fn(),
  clearTokens: vi.fn(),
}))

import { clearTokens, login } from '../../services/auth/index.js'
import { loginCommand } from './index.js'

describe('login command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls login service when env.json exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(login).mockResolvedValue('token')

    await loginCommand.parseAsync([], { from: 'user' })
    expect(login).toHaveBeenCalledWith('/test/env.json')
  })

  it('exits with error when env.json not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(loginCommand.parseAsync([], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('env.json not found in current directory')
  })

  it('calls clearTokens on login failure', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(login).mockRejectedValue(new Error('bad credentials'))

    await expect(loginCommand.parseAsync([], { from: 'user' })).rejects.toThrow('process.exit')
    expect(clearTokens).toHaveBeenCalledWith('/test/env.json')
  })
})
