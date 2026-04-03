import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
}))
vi.mock('../../services/gql/index.js', () => ({
  fetchGql: vi.fn(),
}))
vi.mock('../../services/track/index.js', () => ({
  readTrackJson: vi.fn(),
  writeTrackJson: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))

import { readEnvJson } from '../../services/auth/index.js'
import { fetchGql } from '../../services/gql/index.js'
import { readTrackJson, writeTrackJson } from '../../services/track/index.js'
import { trackCommand } from './index.js'

describe('track command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(readEnvJson).mockReturnValue({ mattersApi: 'https://api.test' })
    vi.mocked(readTrackJson).mockReturnValue({ events: {}, channels: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tracks event by shortHash', async () => {
    vi.mocked(fetchGql).mockResolvedValue({
      data: { campaign: { id: 'e1', shortHash: 'abc', name: 'Event 1' } },
    })

    await trackCommand.parseAsync(['event', '--shortHash', 'abc'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: {},
    })
  })

  it('tracks channel by shortHash', async () => {
    vi.mocked(fetchGql).mockResolvedValue({
      data: { channel: { id: 'c1', shortHash: 'xyz', navbarTitle: 'Channel 1' } },
    })

    await trackCommand.parseAsync(['channel', '--shortHash', 'xyz'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({
      events: {},
      channels: { c1: { id: 'c1', hash: 'xyz', name: 'Channel 1' } },
    })
  })

  it('lists tracked events and channels', () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: { c1: { id: 'c1', hash: 'xyz', name: 'Channel 1' } },
    })

    trackCommand.parse(['list'], { from: 'user' })
    expect(console.log).toHaveBeenCalledWith('Events:')
    expect(console.log).toHaveBeenCalledWith('Channels:')
  })
})
