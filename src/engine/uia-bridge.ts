import { execSync } from 'node:child_process'
import { config, checkPythonAvailable } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { getCache, setCache, clearCache } from '../utils/cache.js'
import { screenContext } from './context.js'
import type { ScreenElement, UiaResult, WindowInfo, DialogInfo, MenuItemInfo, Bounds } from '../utils/types.js'

/** 从新旧多种格式中提取 focus.app */
function parseFocusApp(parsed: Record<string, unknown>): string | null {
  const focus = parsed.focus as Record<string, unknown> | undefined
  if (focus?.app != null) return String(focus.app)
  if (parsed.focusedApp != null) return String(parsed.focusedApp)
  if (parsed.focused_app != null) return String(parsed.focused_app)
  return null
}

/** 从新旧多种格式中提取 focus.window */
function parseFocusWindow(parsed: Record<string, unknown>): string | null {
  const focus = parsed.focus as Record<string, unknown> | undefined
  if (focus?.window != null) return String(focus.window)
  if (parsed.focusedWindow != null) return String(parsed.focusedWindow)
  if (parsed.focused_window != null) return String(parsed.focused_window)
  return null
}

/** 从新旧多种格式中提取 windowBounds */
function parseWindowBounds(parsed: Record<string, unknown>): Bounds | null {
  for (const key of ['windowBounds', 'window_bounds']) {
    const b = parsed[key] as Record<string, unknown> | undefined
    if (b && typeof b.x === 'number' && typeof b.y === 'number' && typeof b.width === 'number' && typeof b.height === 'number') {
      return { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) }
    }
  }
  return null
}

export function scanUiaTree(force = false): UiaResult {
  if (!force) {
    if (screenContext.hadFocusChangeSinceLastScan()) {
      clearCache('uia:.*')
      logger.info('Focus changed, UIA cache cleared')
    }
    if (screenContext.hadMenuTransitionSinceLastScan()) {
      clearCache('uia:.*')
      logger.info('Menu transition detected, UIA cache cleared')
    }
    const cached = getCache<UiaResult>('uia:tree')
    if (cached) return cached
  }

  try {
    const pyCheck = checkPythonAvailable()
    if (!pyCheck.ok) {
      return { success: false, elements: [], focusedApp: null, focusedWindow: null, windowBounds: null, error: pyCheck.error }
    }
    const stdout = execSync(
      `"${config.pythonPath}" "${config.uiaScriptPath}"`,
      { encoding: 'utf-8', timeout: config.defaultTimeout },
    )
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    const windows = parseWindows(parsed.windows)

    const dialogWindows = parseDialogWindows(parsed.dialogWindows)
    const menuItems = parseMenuItems(parsed.menuItems)

    const result: UiaResult = {
      success: (parsed.success as boolean) ?? true,
      elements: ((parsed.elements ?? []) as Record<string, unknown>[]).map((e) => {
        const el: ScreenElement = {
          id: String(e.id ?? ''),
          label: String(e.label ?? ''),
          type: (e.type as ScreenElement['type']) ?? 'unknown',
          bounds: e.bounds as ScreenElement['bounds'] ?? { x: 0, y: 0, width: 0, height: 0 },
          center: e.center as ScreenElement['center'] ?? { x: 0, y: 0 },
          isEnabled: Boolean(e.isEnabled ?? true),
          isVisible: Boolean(e.isVisible ?? true),
          isFocused: Boolean(e.isFocused ?? false),
          source: 'uia',
          windowId: String(e.windowId ?? e.window_id ?? ''),
          className: e.className as string | undefined,
          automationId: e.automationId as string | undefined,
          value: e.value as string | undefined,
        }
        return el
      }),
      windows,
      dialogWindows,
      menuItems,
      focusedApp: parseFocusApp(parsed),
      focusedWindow: parseFocusWindow(parsed),
      windowBounds: parseWindowBounds(parsed),
      error: parsed.error as string | undefined,
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
      dialogWindows: undefined,
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
      isDialog: w.isDialog != null ? Boolean(w.isDialog) : undefined,
      blockedBy: w.blockedBy != null ? String(w.blockedBy) : undefined,
      zOrder: Number(w.zOrder ?? w.z_order ?? 0),
    }
  })
}

function parseMenuItems(raw: unknown): MenuItemInfo[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((m: Record<string, unknown>) => {
    const bounds = m.bounds as { x?: number; y?: number; width?: number; height?: number } | undefined
    const center = m.center as { x?: number; y?: number } | undefined
    return {
      id: String(m.id ?? ''),
      label: String(m.label ?? ''),
      controlType: String(m.controlType ?? 'MenuItem'),
      bounds: {
        x: bounds?.x ?? 0,
        y: bounds?.y ?? 0,
        width: bounds?.width ?? 0,
        height: bounds?.height ?? 0,
      },
      center: {
        x: center?.x ?? (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
        y: center?.y ?? (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2,
      },
      isEnabled: Boolean(m.isEnabled ?? true),
      isVisible: Boolean(m.isVisible ?? true),
      hasSubMenu: Boolean(m.hasSubMenu ?? false),
      windowId: m.windowId != null ? String(m.windowId) : undefined,
    }
  })
}

function parseDialogWindows(raw: unknown): DialogInfo[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((d: Record<string, unknown>) => ({
    id: String(d.id ?? ''),
    title: String(d.title ?? ''),
    blocksWindowId: d.blocksWindowId != null ? String(d.blocksWindowId) : null,
  }))
}
