import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  password: vi.fn(),
  checkbox: vi.fn(),
}))

import { checkbox, input, password } from '@inquirer/prompts'

import { initAgentCommand } from './index.js'

describe('init-agent command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.OPENCLAW_PATH = '/test/sandbox'
    process.env.MATTERS_API = 'https://api.test'

    vi.mocked(input)
      .mockResolvedValueOnce('test-agent')
      .mockResolvedValueOnce('test@test.com')
      .mockResolvedValueOnce('user1')
      .mockResolvedValueOnce('User One')
    vi.mocked(password).mockResolvedValueOnce('secret')
    vi.mocked(checkbox).mockResolvedValueOnce([])
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENCLAW_PATH
    delete process.env.MATTERS_API
  })

  it('skips mkdir, playbooks copy, and AGENTS.md copy when workspace and all files exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    await initAgentCommand.parseAsync([], { from: 'user' })

    expect(fs.mkdirSync).not.toHaveBeenCalled()
    expect(fs.copyFileSync).not.toHaveBeenCalled()
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/sandbox/workspace/test-agent/env.json',
      expect.stringContaining('"email": "test@test.com"'),
    )
  })

  it('creates workspace, copies playbooks and AGENTS.md when they do not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
    vi.mocked(fs.readdirSync).mockReturnValue(['post-article.md', 'track-and-post-comment.md'] as unknown as ReturnType<
      typeof fs.readdirSync
    >)
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined)

    await initAgentCommand.parseAsync([], { from: 'user' })

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/sandbox/workspace/test-agent', { recursive: true })
    expect(fs.mkdirSync).toHaveBeenCalledWith('/test/sandbox/workspace/test-agent/playbooks', { recursive: true })
    expect(fs.copyFileSync).toHaveBeenCalledTimes(3)
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('src/guides/AGENTS.md'),
      '/test/sandbox/workspace/test-agent/AGENTS.md',
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/sandbox/workspace/test-agent/env.json',
      expect.stringContaining('"email": "test@test.com"'),
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/test/sandbox/workspace/test-agent/MEMORY.md',
      expect.stringContaining('# Memory'),
    )
  })
})
