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

export { delay, fetchGql }
