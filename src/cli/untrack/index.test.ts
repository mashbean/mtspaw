import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/track/index.js', () => ({
  readTrackJson: vi.fn(),
  writeTrackJson: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}))

import { readTrackJson, writeTrackJson } from '../../services/track/index.js'
import { untrackCommand } from './index.js'

describe('untrack command', () => {
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

  it('untracks event by id', async () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: {},
    })

    await untrackCommand.parseAsync(['event', '--id', 'e1'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({ events: {}, channels: {} })
  })

  it('untracks event by shortHash', async () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: {},
    })

    await untrackCommand.parseAsync(['event', '--shortHash', 'abc'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({ events: {}, channels: {} })
  })

  it('untracks all events', () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: { c1: { id: 'c1', hash: 'xyz', name: 'Channel 1' } },
    })

    untrackCommand.parse(['event', 'all'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({
      events: {},
      channels: { c1: { id: 'c1', hash: 'xyz', name: 'Channel 1' } },
    })
  })

  it('untracks all channels', () => {
    vi.mocked(readTrackJson).mockReturnValue({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: { c1: { id: 'c1', hash: 'xyz', name: 'Channel 1' } },
    })

    untrackCommand.parse(['channel', 'all'], { from: 'user' })
    expect(writeTrackJson).toHaveBeenCalledWith({
      events: { e1: { id: 'e1', hash: 'abc', name: 'Event 1' } },
      channels: {},
    })
  })

  it('exits when event not found', async () => {
    vi.mocked(readTrackJson).mockReturnValue({ events: {}, channels: {} })

    await expect(untrackCommand.parseAsync(['event', '--id', 'missing'], { from: 'user' })).rejects.toThrow(
      'process.exit',
    )
  })
})
