import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  password: vi.fn(),
}))

import { input, password } from '@inquirer/prompts'

import { initAgentCommand } from './index.js'

describe('init-agent command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.OPENCLAW_PATH = '/test/sandbox'
    process.env.MATTERS_API = 'https://api.test'

    vi.mocked(input)
      .mockResolvedValueOnce('test-agent')
      .mockResolvedValueOnce('test@test.com')
      .mockResolvedValueOnce('user1')
      .mockResolvedValueOnce('User One')
    vi.mocked(password).mockResolvedValueOnce('secret')
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENCLAW_PATH
    delete process.env.MATTERS_API
  })

  it('creates workspace directory and files', async () => {
    await initAgentCommand.parseAsync([], { from: 'user' })

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/sandbox/workspace-test-agent', { recursive: true })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/sandbox/workspace-test-agent/env.json',
      expect.stringContaining('"email": "test@test.com"'),
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/sandbox/workspace-test-agent/env.json',
      expect.stringContaining('"features"'),
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/sandbox/workspace-test-agent/AGENTS.md', '')
    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/sandbox/workspace-test-agent/SOUL.md', '')
    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/sandbox/workspace-test-agent/TOOLS.md', '')
  })
})
