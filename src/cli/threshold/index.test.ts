import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  writeEnvJson: vi.fn(),
  requireEnvJson: vi.fn(() => '/test/env.json'),
  sortByKey: <V>(obj: Record<string, V>) =>
    Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))),
}))
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
}))

import { input, select } from '@inquirer/prompts'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'
import { thresholdCommand } from './index.js'

describe('threshold command', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('set', () => {
    it('sets a threshold via flags', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })

      await thresholdCommand.parseAsync(['set', '--name', 'comment', '--value', '75'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { thresholds: { comment: 75 } })
      expect(console.log).toHaveBeenCalledWith('Threshold "comment" set to 75')
    })

    it('sets a threshold via interactive prompts', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })
      vi.mocked(select).mockResolvedValue('comment')
      vi.mocked(input).mockResolvedValue('90')

      await thresholdCommand.parseAsync(['set'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { thresholds: { comment: 90 } })
    })

    it('initializes thresholds when missing in env.json', async () => {
      vi.mocked(readEnvJson).mockReturnValue({})

      await thresholdCommand.parseAsync(['set', '--name', 'comment', '--value', '80'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { thresholds: { comment: 80 } })
    })

    it('exits on unknown threshold name', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })

      await expect(
        thresholdCommand.parseAsync(['set', '--name', 'unknown', '--value', '50'], { from: 'user' }),
      ).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Unknown threshold: unknown')
    })

    it('exits on non-integer value', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })

      await expect(
        thresholdCommand.parseAsync(['set', '--name', 'comment', '--value', '7.5'], { from: 'user' }),
      ).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Value must be an integer')
    })

    it('exits on out-of-range value', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })

      await expect(
        thresholdCommand.parseAsync(['set', '--name', 'comment', '--value', '101'], { from: 'user' }),
      ).rejects.toThrow('process.exit')
      expect(console.error).toHaveBeenCalledWith('Value must be in 0-100')
    })
  })

  describe('list', () => {
    it('prints each threshold', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ thresholds: { comment: 80 } })

      await thresholdCommand.parseAsync(['list'], { from: 'user' })

      expect(console.log).toHaveBeenCalledWith('comment: 80')
    })

    it('prints message when no thresholds are set', async () => {
      vi.mocked(readEnvJson).mockReturnValue({})

      await thresholdCommand.parseAsync(['list'], { from: 'user' })

      expect(console.log).toHaveBeenCalledWith('No thresholds set')
    })
  })
})
