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

import { select } from '@inquirer/prompts'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'
import { featureCommand } from './index.js'

describe('feature command', () => {
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

  describe('on', () => {
    it('turns on a feature via --feature flag', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await featureCommand.parseAsync(['on', '--feature', 'comment'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: true } })
      expect(console.log).toHaveBeenCalledWith('Feature "comment" is now on')
    })

    it('turns on a feature via interactive select', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })
      vi.mocked(select).mockResolvedValue('comment')

      await featureCommand.parseAsync(['on'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: true } })
    })

    it('exits on unknown feature', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await expect(featureCommand.parseAsync(['on', '--feature', 'unknown'], { from: 'user' })).rejects.toThrow(
        'process.exit',
      )
      expect(console.error).toHaveBeenCalledWith('Unknown feature: unknown')
    })
  })

  describe('off', () => {
    it('turns off a feature via --feature flag', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: true } })

      await featureCommand.parseAsync(['off', '--feature', 'comment'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: false } })
      expect(console.log).toHaveBeenCalledWith('Feature "comment" is now off')
    })

    it('turns off a feature via interactive select', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: true } })
      vi.mocked(select).mockResolvedValue('comment')

      await featureCommand.parseAsync(['off'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: false } })
    })
  })

  describe('add', () => {
    it('adds a new feature via --feature flag', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await featureCommand.parseAsync(['add', '--feature', 'article'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', {
        features: { article: false, comment: false },
      })
      expect(console.log).toHaveBeenCalledWith('Feature "article" added')
    })

    it('exits when feature already exists', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await expect(featureCommand.parseAsync(['add', '--feature', 'comment'], { from: 'user' })).rejects.toThrow(
        'process.exit',
      )
      expect(console.error).toHaveBeenCalledWith('Feature already exists: comment')
    })
  })

  describe('remove', () => {
    it('removes a feature via --feature flag', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { article: false, comment: false } })

      await featureCommand.parseAsync(['remove', '--feature', 'article'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: false } })
      expect(console.log).toHaveBeenCalledWith('Feature "article" removed')
    })

    it('exits when feature not found', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await expect(featureCommand.parseAsync(['remove', '--feature', 'unknown'], { from: 'user' })).rejects.toThrow(
        'process.exit',
      )
      expect(console.error).toHaveBeenCalledWith('Unknown feature: unknown')
    })
  })
})
