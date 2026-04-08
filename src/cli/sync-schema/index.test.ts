import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')

import { syncSchemaCommand } from './index.js'

describe('sync-schema command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to master branch when --branch is not provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('type Query { hello: String }'),
    } as Response)

    await syncSchemaCommand.parseAsync([], { from: 'user' })

    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/thematters/matters-server/master/schema.graphql',
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('schema.graphql'), expect.any(String))
  })

  it('uses provided --branch value', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('type Query { hello: String }'),
    } as Response)

    await syncSchemaCommand.parseAsync(['--branch', 'develop'], { from: 'user' })

    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/thematters/matters-server/develop/schema.graphql',
    )
  })

  it('exits on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response)
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(syncSchemaCommand.parseAsync([], { from: 'user' })).rejects.toThrow('process.exit')
    expect(console.error).toHaveBeenCalledWith('Failed to fetch schema: 404 Not Found')
  })
})
