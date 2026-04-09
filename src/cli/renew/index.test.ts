import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')

import { renewCommand } from './index.js'

describe('renew doc command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'cwd').mockReturnValue('/test/workspace')
    vi.mocked(fs.copyFileSync).mockReturnValue(undefined)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies AGENTS.md from src/guides into the current workspace', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    await renewCommand.parseAsync(['doc', '--target', 'AGENTS.md'], { from: 'user' })

    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('src/guides/AGENTS.md'),
      '/test/workspace/AGENTS.md',
    )
  })

  it('exits when source AGENTS.md is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(renewCommand.parseAsync(['doc', '--target', 'AGENTS.md'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(fs.copyFileSync).not.toHaveBeenCalled()
  })
})
