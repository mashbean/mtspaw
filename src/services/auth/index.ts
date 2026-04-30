import fs from 'node:fs'
import path from 'node:path'

import { fetchGql, formatGqlErrors } from '../gql/index.js'

const LOGIN_MUTATION = `
  mutation EmailLogin($input: EmailLoginInput!) {
    emailLogin(input: $input) {
      auth
      token
    }
  }
`

const readEnvJson = (envJsonPath: string) => {
  return JSON.parse(fs.readFileSync(envJsonPath, 'utf-8'))
}

const writeEnvJson = (envJsonPath: string, envJson: Record<string, string>) => {
  fs.writeFileSync(envJsonPath, JSON.stringify(envJson, null, 2))
}

const requireEnvJson = () => {
  const envJsonPath = path.resolve(process.cwd(), 'env.json')
  if (!fs.existsSync(envJsonPath)) {
    console.error('env.json not found in current directory')
    process.exit(1)
  }
  return envJsonPath
}

const sortByKey = <V>(obj: Record<string, V>): Record<string, V> => {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
}

const clearTokens = (envJsonPath: string) => {
  const envJson = readEnvJson(envJsonPath)
  envJson.accessToken = ''
  envJson.accessTokenExpiredAt = ''
  writeEnvJson(envJsonPath, envJson)
}

const login = async (envJsonPath: string) => {
  const envJson = readEnvJson(envJsonPath)
  const { mattersApi, email, password } = envJson

  if (!mattersApi || !email || !password) {
    throw new Error('Missing mattersApi, email, or password in env.json')
  }

  console.log(`Logging in as ${email}...`)

  const result = await fetchGql(mattersApi, LOGIN_MUTATION, {
    input: {
      email,
      passwordOrCode: password,
    },
  })

  if (result?.errors) {
    clearTokens(envJsonPath)
    throw new Error(result.errors.map((e: { message: string }) => e.message).join(', '))
  }

  const authResult = result?.data?.emailLogin
  if (!authResult?.auth || !authResult?.token) {
    clearTokens(envJsonPath)
    throw new Error('No token returned')
  }

  envJson.accessToken = authResult.token
  envJson.accessTokenExpiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  writeEnvJson(envJsonPath, envJson)

  console.log('Login successful')
  return authResult.token
}

const ensureAuth = async (envJsonPath: string) => {
  const envJson = readEnvJson(envJsonPath)
  const { accessToken, accessTokenExpiredAt } = envJson

  if (accessToken && accessTokenExpiredAt) {
    const expiry = new Date(accessTokenExpiredAt)
    if (expiry > new Date()) {
      return accessToken
    }
    console.log('Token expired, re-logging in...')
  } else {
    console.log('No token found, logging in...')
  }

  return await login(envJsonPath)
}

const isAuthError = (message: string) => {
  const lower = message.toLowerCase()
  return lower.includes('token') || lower.includes('auth')
}

const fetchGqlWithAuthRetry = async (
  envJsonPath: string,
  mattersApi: string,
  query: string,
  variables: Record<string, unknown> = {},
) => {
  let token = await ensureAuth(envJsonPath)
  let result = await fetchGql(mattersApi, query, variables, token)
  let errorMessage = formatGqlErrors(result)

  if (errorMessage && isAuthError(errorMessage)) {
    console.log('Token invalid, re-logging in...')
    token = await login(envJsonPath)
    result = await fetchGql(mattersApi, query, variables, token)
    errorMessage = formatGqlErrors(result)
  }

  return { result, errorMessage }
}

export {
  clearTokens,
  ensureAuth,
  fetchGqlWithAuthRetry,
  isAuthError,
  login,
  readEnvJson,
  requireEnvJson,
  sortByKey,
  writeEnvJson,
}
