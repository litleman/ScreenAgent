import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { config, checkPythonAvailable } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { getCache, setCache } from '../utils/cache.js'
import type { VisionSidecarResult } from '../utils/types.js'
import { parseWindows } from '../utils/windows.js'

export function runVisionSidecar(force = false): VisionSidecarResult {
  if (!force) {
    const cached = getCache<VisionSidecarResult>('vision:sidecar')
    if (cached) return cached
  }

  const start = performance.now()
  const pyCheck = checkPythonAvailable()
  if (!pyCheck.ok) {
    return { success: false, elements: [], screenshotPath: null, error: pyCheck.error, duration: 0 }
  }
  try {
    mkdirSync(config.screenshotDir, { recursive: true })
    const flag = force ? '--force' : ''
    const stdout = execSync(
      `"${config.pythonPath}" "${config.visionScriptPath}" ${flag}`,
      { encoding: 'utf-8', timeout: config.defaultTimeout },
    )
    const parsed = JSON.parse(stdout)
    const result: VisionSidecarResult = {
      success: parsed.success ?? true,
      elements: parsed.elements ?? [],
      windows: parseWindows(parsed.windows),
      screenshotPath: parsed.screenshotPath ?? null,
      error: parsed.error,
      duration: performance.now() - start,
    }
    logger.debug(`Vision sidecar: ${result.elements.length} elements, ${result.windows?.length ?? 0} windows in ${result.duration.toFixed(0)}ms`)
    setCache('vision:sidecar', result)
    return result
  } catch (err) {
    const duration = performance.now() - start
    logger.error(`Vision sidecar failed after ${duration.toFixed(0)}ms`, err)
    return {
      success: false,
      elements: [],
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
      duration,
    }
  }
}


