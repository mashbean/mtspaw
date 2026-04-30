const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_RETRIES = 3
const RETRY_DELAY = 500

const fetchGql = async (mattersApi: string, query: string, variables: Record<string, unknown>, token?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['x-access-token'] = token
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(mattersApi, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      })
      return await response.json()
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`GQL request failed after ${MAX_RETRIES} attempts: ${(err as Error).message}`, { cause: err })
      }
      await delay(RETRY_DELAY)
    }
  }
}

const fromGlobalId = (globalId: string) => {
  const [type, id] = Buffer.from(globalId, 'base64').toString('utf-8').split(':')
  return { type, id }
}

const formatGqlErrors = (result: unknown): string | null => {
  const errors = (result as { errors?: { message: string }[] } | null)?.errors
  if (!errors || errors.length === 0) {
    return null
  }
  return errors.map((e) => e.message).join(', ')
}

export { delay, fetchGql, formatGqlErrors, fromGlobalId }
