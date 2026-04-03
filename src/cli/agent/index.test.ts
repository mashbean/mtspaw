import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs')
vi.mock('../../services/auth/index.js', () => ({
  readEnvJson: vi.fn(),
  writeEnvJson: vi.fn(),
}))
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}))

import { select } from '@inquirer/prompts'

import { readEnvJson, writeEnvJson } from '../../services/auth/index.js'
import { agentCommand } from './index.js'

describe('agent command', () => {
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

      await agentCommand.parseAsync(['on', '--feature', 'comment'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: true } })
      expect(console.log).toHaveBeenCalledWith('Feature "comment" is now on')
    })

    it('turns on a feature via interactive select', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })
      vi.mocked(select).mockResolvedValue('comment')

      await agentCommand.parseAsync(['on'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: true } })
    })

    it('exits on unknown feature', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: false } })

      await expect(agentCommand.parseAsync(['on', '--feature', 'unknown'], { from: 'user' })).rejects.toThrow(
        'process.exit',
      )
      expect(console.error).toHaveBeenCalledWith('Unknown feature: unknown')
    })
  })

  describe('off', () => {
    it('turns off a feature via --feature flag', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: true } })

      await agentCommand.parseAsync(['off', '--feature', 'comment'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: false } })
      expect(console.log).toHaveBeenCalledWith('Feature "comment" is now off')
    })

    it('turns off a feature via interactive select', async () => {
      vi.mocked(readEnvJson).mockReturnValue({ features: { comment: true } })
      vi.mocked(select).mockResolvedValue('comment')

      await agentCommand.parseAsync(['off'], { from: 'user' })

      expect(writeEnvJson).toHaveBeenCalledWith('/test/env.json', { features: { comment: false } })
    })
  })
})
