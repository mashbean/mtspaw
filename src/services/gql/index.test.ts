import { afterEach, describe, expect, it, vi } from 'vitest'

import { delay, fetchGql, formatGqlErrors, fromGlobalId } from './index.js'

describe('delay', () => {
  it('resolves after given ms', async () => {
    const start = Date.now()
    await delay(50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })
})

describe('fetchGql', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('makes a POST request with correct headers', async () => {
    const mockResponse = { data: { viewer: { id: '1' } } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const result = await fetchGql('https://api.test', 'query { viewer { id } }', {})
    expect(fetch).toHaveBeenCalledWith('https://api.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query { viewer { id } }', variables: {} }),
    })
    expect(result).toEqual(mockResponse)
  })

  it('includes x-access-token header when token is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ data: {} }),
    } as Response)

    await fetchGql('https://api.test', 'query {}', {}, 'my-token')
    expect(fetch).toHaveBeenCalledWith('https://api.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-token': 'my-token' },
      body: expect.any(String),
    })
  })

  it('retries on failure and succeeds', async () => {
    const mockResponse = { data: { ok: true } }
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockResponse) } as Response)

    const result = await fetchGql('https://api.test', 'query {}', {})
    expect(result).toEqual(mockResponse)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))

    await expect(fetchGql('https://api.test', 'query {}', {})).rejects.toThrow('GQL request failed after 3 attempts')
  })
})

describe('fromGlobalId', () => {
  it('decodes a base64 User global id', () => {
    const encoded = Buffer.from('User:123', 'utf-8').toString('base64')
    expect(fromGlobalId(encoded)).toEqual({ type: 'User', id: '123' })
  })

  it('decodes an Article global id', () => {
    const encoded = Buffer.from('Article:42', 'utf-8').toString('base64')
    expect(fromGlobalId(encoded)).toEqual({ type: 'Article', id: '42' })
  })
})

describe('formatGqlErrors', () => {
  it('returns null when result has no errors', () => {
    expect(formatGqlErrors({ data: {} })).toBe(null)
    expect(formatGqlErrors(null)).toBe(null)
  })

  it('joins error messages with comma', () => {
    expect(formatGqlErrors({ errors: [{ message: 'one' }, { message: 'two' }] })).toBe('one, two')
  })
})
