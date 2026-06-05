import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { config, checkPythonAvailable } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { getCache, setCache } from '../utils/cache.js'
import type { VisionSidecarResult, WindowInfo } from '../utils/types.js'

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

function parseWindows(raw: unknown): WindowInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((w: Record<string, unknown>) => {
    const b = w.bounds as Record<string, unknown> | undefined
    return {
      id: String(w.id ?? ''),
      title: String(w.title ?? ''),
      processName: String(w.processName ?? w.process_name ?? ''),
      bounds: {
        x: Number(b?.x ?? w.x ?? 0),
        y: Number(b?.y ?? w.y ?? 0),
        width: Number(b?.width ?? w.width ?? 0),
        height: Number(b?.height ?? w.height ?? 0),
      },
      isMinimized: Boolean(w.isMinimized ?? w.is_minimized ?? false),
      isMaximized: Boolean(w.isMaximized ?? w.is_maximized ?? false),
      isFocused: Boolean(w.isFocused ?? w.is_focused ?? false),
      zOrder: Number(w.zOrder ?? w.z_order ?? 0),
    }
  })
}
