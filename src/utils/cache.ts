import { config } from './config.js'
import { logger } from './logger.js'

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const store = new Map<string, CacheEntry<unknown>>()

export function getCache<T>(key: string, ttl?: number): T | null {
  if (!config.cacheEnabled) return null
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.timestamp > (ttl ?? config.cacheTtl)) {
    store.delete(key)
    return null
  }
  logger.debug(`Cache HIT: ${key}`)
  return entry.data
}

export function setCache<T>(key: string, data: T): void {
  if (!config.cacheEnabled) return
  store.set(key, { data, timestamp: Date.now() })
  logger.debug(`Cache SET: ${key}`)
}

export function clearCache(pattern?: string): void {
  if (pattern) {
    const regex = new RegExp(pattern)
    for (const key of store.keys()) {
      if (regex.test(key)) store.delete(key)
    }
  } else {
    store.clear()
  }
  logger.debug(`Cache CLEAR${pattern ? ` (pattern=${pattern})` : ''}`)
}
