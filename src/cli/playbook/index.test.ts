import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')

import { playbookCommand } from './index.js'

describe('playbook list command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/work')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports ok when source and workspace versions match', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p)
      return s.endsWith('src/playbooks') || s.endsWith('.md')
    })
    vi.mocked(fs.readdirSync).mockReturnValue(['comment-reply.md'] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockReturnValue('# Comment Reply\n\nVersion: 0.1\n')

    await playbookCommand.parseAsync(['list'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/comment-reply\.md.*source=0\.1.*workspace=0\.1.*ok/),
    )
  })

  it('reports missing when workspace file does not exist', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p)
      if (s.endsWith('src/playbooks')) {
        return true
      }
      if (s.includes('src/playbooks/')) {
        return true
      }
      return false
    })
    vi.mocked(fs.readdirSync).mockReturnValue(['donate-article.md'] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockReturnValue('# Donate Article\n\nVersion: 0.1\n')

    await playbookCommand.parseAsync(['list'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/donate-article\.md.*source=0\.1.*workspace=-.*missing/),
    )
  })

  it('reports different when versions diverge', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['post-article.md'] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const s = String(p)
      if (s.includes('src/playbooks/')) {
        return '# Post Article\n\nVersion: 0.2\n'
      }
      return '# Post Article\n\nVersion: 0.1\n'
    })

    await playbookCommand.parseAsync(['list'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/post-article\.md.*source=0\.2.*workspace=0\.1.*different/),
    )
  })

  it('reports ? when version line is missing in either side', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['legacy.md'] as unknown as ReturnType<typeof fs.readdirSync>)
    vi.mocked(fs.readFileSync).mockReturnValue('# Legacy\n\nNo version field.\n')

    await playbookCommand.parseAsync(['list'], { from: 'user' })

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/legacy\.md.*source=\?.*workspace=\?.*\?/))
  })

  it('exits when source playbooks directory is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(playbookCommand.parseAsync(['list'], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Source playbooks dir not found'))
  })
})
