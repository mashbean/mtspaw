import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logAction, resetLogger, setQuietMode, setupConsoleLogger } from './index.js'

vi.mock('node:fs')

describe('logger service', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
    resetLogger()
  })

  it('appends log line with timestamp', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined)

    logAction('track event', ['--shortHash', 'abc'])

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      '/test/action.log',
      expect.stringContaining('track event --shortHash abc'),
    )
  })

  it('includes ISO timestamp in log line', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined)

    logAction('hello', [])

    const written = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
    expect(written).toMatch(/^\[\d{4}-\d{2}-\d{2}T/)
  })

  it('rotates when exceeding 300 lines', () => {
    const lines = Array.from({ length: 310 }, (_, i) => `line ${i}`)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 999999 } as fs.Stats)
    vi.mocked(fs.readFileSync).mockReturnValue(lines.join('\n'))
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined)
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)

    logAction('test', [])

    expect(fs.writeFileSync).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
    const writtenLines = written.split('\n').filter((l) => l.length > 0)
    expect(writtenLines.length).toBe(300)
  })

  it('does not rotate when under 300 lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats)
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined)

    logAction('test', [])

    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  describe('setupConsoleLogger', () => {
    it('console.log writes to terminal and appends to log file', () => {
      vi.mocked(fs.appendFileSync).mockReturnValue(undefined)
      const originalLog = console.log

      setupConsoleLogger()
      console.log('test message')

      expect(fs.appendFileSync).toHaveBeenCalledWith('/test/action.log', 'test message\n')

      console.log = originalLog
    })

    it('console.error writes to terminal and appends with [ERROR] prefix', () => {
      vi.mocked(fs.appendFileSync).mockReturnValue(undefined)
      const originalError = console.error

      setupConsoleLogger()
      console.error('something broke')

      expect(fs.appendFileSync).toHaveBeenCalledWith('/test/action.log', '[ERROR] something broke\n')

      console.error = originalError
    })

    it('quiet mode still logs to file', () => {
      vi.mocked(fs.appendFileSync).mockReturnValue(undefined)
      const originalLog = console.log

      setupConsoleLogger()
      setQuietMode(true)
      console.log('quiet message')

      expect(fs.appendFileSync).toHaveBeenCalledWith('/test/action.log', 'quiet message\n')

      setQuietMode(false)
      console.log = originalLog
    })
  })
})
