import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTrackJson, writeTrackJson } from './index.js'

vi.mock('node:fs')

describe('track service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readTrackJson', () => {
    it('returns empty structure when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const result = readTrackJson()
      expect(result).toEqual({ events: {}, channels: {} })
    })

    it('reads and parses existing file', () => {
      const data = { events: { '1': { id: '1', hash: 'abc', name: 'test' } }, channels: {} }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data))
      const result = readTrackJson()
      expect(result).toEqual(data)
    })
  })

  describe('writeTrackJson', () => {
    it('writes json to file', () => {
      const data = { events: {}, channels: {} }
      writeTrackJson(data)
      expect(fs.writeFileSync).toHaveBeenCalledWith('/test/track.json', JSON.stringify(data, null, 2))
    })
  })
})
