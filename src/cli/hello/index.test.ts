import { describe, expect, it, vi } from 'vitest'

import { helloCommand } from './index.js'

describe('hello command', () => {
  it('prints hello paw ~', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    helloCommand.parse([], { from: 'user' })
    expect(spy).toHaveBeenCalledWith('hello paw ~')
    spy.mockRestore()
  })
})
