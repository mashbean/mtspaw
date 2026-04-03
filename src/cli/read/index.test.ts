import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))

import { readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { readCommand } from './index.js'

describe('read article command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api.test' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads article by id', async () => {
    vi.mocked(fetchGql).mockResolvedValue({
      data: {
        node: {
          id: 'a1',
          title: 'Test Article',
          shortHash: 'abc',
          contents: { markdown: '# Hello' },
          author: { displayName: 'User', userName: 'user1' },
        },
      },
    })

    await readCommand.parseAsync(['article', '--id', 'a1'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Title: Test Article')
    expect(console.log).toHaveBeenCalledWith('# Hello')
  })

  it('reads article by shortHash', async () => {
    vi.mocked(fetchGql).mockResolvedValue({
      data: {
        article: {
          id: 'a1',
          title: 'Test Article',
          shortHash: 'abc',
          contents: { markdown: '# Hello' },
          author: { displayName: 'User', userName: 'user1' },
        },
      },
    })

    await readCommand.parseAsync(['article', '--shortHash', 'abc'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Title: Test Article')
  })

  it('exits when article not found', async () => {
    vi.mocked(fetchGql).mockResolvedValue({ data: { node: null } })

    await expect(readCommand.parseAsync(['article', '--id', 'missing'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
  })
})
