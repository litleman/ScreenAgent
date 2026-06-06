import type { ScreenElement, WindowInfo, ToolHandler } from './types.js'

export interface McpResponse {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

type CompactElement = Record<string, unknown>
type CompactWindow = Record<string, unknown>

function compactElement(el: ScreenElement): CompactElement {
  const c: CompactElement = {
    i: el.id,
    l: el.label,
    t: el.type,
    s: el.source,
  }
  if (el.source !== 'ocr') {
    c.b = { x: el.bounds.x, y: el.bounds.y, w: el.bounds.width, h: el.bounds.height }
    c.c = { x: el.center.x, y: el.center.y }
  }
  if (!el.isEnabled) c.e = false
  if (!el.isVisible) c.v = false
  if (el.isFocused) c.f = true
  if (el.confidence != null && el.confidence < 1) c.co = el.confidence
  if (el.windowId) c.w = el.windowId
  if (el.value) c.va = el.value
  if (el.className) c.cl = el.className
  if (el.automationId) c.ai = el.automationId
  return c
}

function compactWindow(w: WindowInfo): CompactWindow {
  const c: CompactWindow = {
    i: w.id,
    tl: w.title,
    pn: w.processName,
    b: { x: w.bounds.x, y: w.bounds.y, w: w.bounds.width, h: w.bounds.height },
    z: w.zOrder,
  }
  if (w.isMinimized) c.im = true
  if (w.isMaximized) c.ix = true
  if (w.isFocused) c.f = true
  if (w.isDialog) c.id = true
  if (w.blockedBy) c.bb = w.blockedBy
  return c
}

function compactifyData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data }

  if (Array.isArray(result.elements)) {
    result.elements = result.elements.map(e => compactElement(e as ScreenElement))
  }
  if (Array.isArray(result.windows)) {
    result.windows = result.windows.map(w => compactWindow(w as WindowInfo))
  }

  return result
}

export function success(data: Record<string, unknown>, pretty = false, compact = false): McpResponse {
  const output = compact ? compactifyData(data) : data
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, pretty ? 2 : undefined) }],
  }
}

export function error(message: string, extra?: Record<string, unknown>): McpResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, error: message, ...extra }, null, 2),
    }],
    isError: true,
  }
}

export function wrapHandler(fn: (args: Record<string, unknown>) => Promise<McpResponse>): ToolHandler {
  return async (args) => {
    try {
      return await fn(args)
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err))
    }
  }
}

export { compactElement, compactWindow, compactifyData }
