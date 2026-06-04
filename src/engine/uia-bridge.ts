import { execSync } from 'node:child_process'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { getCache, setCache } from '../utils/cache.js'
import type { ScreenElement, UiaResult, WindowInfo, Bounds } from '../utils/types.js'

export function scanUiaTree(force = false): UiaResult {
  if (!force) {
    const cached = getCache<UiaResult>('uia:tree')
    if (cached) return cached
  }

  try {
    const stdout = execSync(
      `"${config.pythonPath}" "${config.uiaScriptPath}"`,
      { encoding: 'utf-8', timeout: config.defaultTimeout },
    )
    const parsed = JSON.parse(stdout)
    const windows = parseWindows(parsed.windows)

    const result: UiaResult = {
      success: parsed.success ?? true,
      elements: (parsed.elements ?? []).map((e: Record<string, unknown>) => ({
        ...e,
        source: 'uia' as const,
        windowId: e.windowId ?? String(e.window_id ?? ''),
      })),
      windows,
      focusedApp: parsed.focusedApp ?? parsed.focused_app ?? null,
      focusedWindow: parsed.focusedWindow ?? parsed.focused_window ?? null,
      windowBounds: parsed.windowBounds
        ? { x: Number((parsed.windowBounds as Record<string, unknown>).x ?? 0), y: Number((parsed.windowBounds as Record<string, unknown>).y ?? 0), width: Number((parsed.windowBounds as Record<string, unknown>).width ?? 0), height: Number((parsed.windowBounds as Record<string, unknown>).height ?? 0) }
        : parsed.window_bounds
          ? { x: Number((parsed.window_bounds as Record<string, unknown>).x ?? 0), y: Number((parsed.window_bounds as Record<string, unknown>).y ?? 0), width: Number((parsed.window_bounds as Record<string, unknown>).width ?? 0), height: Number((parsed.window_bounds as Record<string, unknown>).height ?? 0) }
          : null,
      error: parsed.error,
    }

    setCache('uia:tree', result)
    return result
  } catch (err) {
    logger.error('UIA scan failed', err)
    return {
      success: false,
      elements: [],
      focusedApp: null,
      focusedWindow: null,
      windowBounds: null,
      error: String(err),
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
