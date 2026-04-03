import fs from 'node:fs'
import path from 'node:path'

const MAX_LINES = 100
const LOG_FILE = 'action.log'
let loggerInitialized = false

const getLogPath = () => path.resolve(process.cwd(), LOG_FILE)

const rotate = (logPath: string) => {
  if (!fs.existsSync(logPath)) {
    return
  }

  const stat = fs.statSync(logPath)
  if (stat.size < MAX_LINES * 100) {
    return
  }

  const content = fs.readFileSync(logPath, 'utf-8')
  const lines = content.split('\n').filter((l) => l.length > 0)

  if (lines.length > MAX_LINES) {
    const trimmed = lines.slice(lines.length - MAX_LINES)
    fs.writeFileSync(logPath, trimmed.join('\n') + '\n')
  }
}

const appendToLog = (...args: unknown[]) => {
  const logPath = getLogPath()
  const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  fs.appendFileSync(logPath, message + '\n')
}

const logAction = (command: string, args: string[]) => {
  const logPath = getLogPath()
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${command} ${args.join(' ')}`.trim()

  fs.appendFileSync(logPath, line + '\n')
  rotate(logPath)
}

let quietMode = false
let fileLogging = true

const setQuietMode = (enabled: boolean) => {
  quietMode = enabled
}

const setFileLogging = (enabled: boolean) => {
  fileLogging = enabled
}

const setupConsoleLogger = () => {
  if (loggerInitialized) {
    return
  }
  loggerInitialized = true

  const originalLog = console.log
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    if (!quietMode) {
      originalLog(...args)
    }
    if (fileLogging) {
      appendToLog(...args)
    }
  }

  console.error = (...args: unknown[]) => {
    if (!quietMode) {
      originalError(...args)
    }
    if (fileLogging) {
      appendToLog('[ERROR]', ...args)
    }
  }
}

const resetLogger = () => {
  loggerInitialized = false
  quietMode = false
  fileLogging = true
}

export { logAction, resetLogger, setFileLogging, setQuietMode, setupConsoleLogger }
