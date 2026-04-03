import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
}))

import { readEnvJson } from '../../services/auth/index.js'
import { envCommand } from './index.js'

describe('env command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints env.json with masked password', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(readEnvJson).mockReturnValue({
      mattersApi: 'https://api.test',
      email: 'test@test.com',
      password: 'secret',
    })

    await envCommand.parseAsync([], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"password": "***"'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"email": "test@test.com"'))
  })

  it('exits when env.json not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(envCommand.parseAsync([], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('env.json not found in current directory')
  })
})
