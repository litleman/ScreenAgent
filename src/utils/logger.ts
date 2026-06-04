import { config } from './config.js'

const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const

function log(level: keyof typeof levels, msg: string, data?: unknown) {
  if (levels[level] < levels[config.logLevel]) return
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase()}]`
  if (data !== undefined) {
    console.error(`${prefix} ${msg}`, data)
  } else {
    console.error(`${prefix} ${msg}`)
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
}
