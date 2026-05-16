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

  it('renew doc all copies every entry to its workspace dest', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    await renewCommand.parseAsync(['doc', 'all'], { from: 'user' })

    const dests = vi.mocked(fs.copyFileSync).mock.calls.map((c) => c[1])
    expect(dests).toEqual(
      expect.arrayContaining([
        '/test/workspace/AGENTS.md',
        '/test/workspace/playbooks/comment-reply.md',
        '/test/workspace/playbooks/donate-article.md',
        '/test/workspace/playbooks/post-article.md',
        '/test/workspace/playbooks/post-trending-article.md',
        '/test/workspace/playbooks/spam-scan.md',
        '/test/workspace/playbooks/track-and-post-comment.md',
      ]),
    )
    expect(dests).toHaveLength(7)
  })

  it('renew doc all aborts before any copy when any source is missing', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).endsWith('spam-scan.md'))

    await expect(renewCommand.parseAsync(['doc', 'all'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(fs.copyFileSync).not.toHaveBeenCalled()
  })

  it('renew doc all --target ... is rejected', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(renewCommand.parseAsync(['doc', 'all', '--target', 'AGENTS.md'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
    expect(console.error).toHaveBeenCalledWith('--target cannot be combined with "all"')
    expect(fs.copyFileSync).not.toHaveBeenCalled()
  })
})
