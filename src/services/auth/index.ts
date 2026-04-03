import fs from 'node:fs'

import { fetchGql } from '../gql/index.js'

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

export { clearTokens, ensureAuth, login, readEnvJson, writeEnvJson }
