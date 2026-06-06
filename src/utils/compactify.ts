import type { ScreenElement, WindowInfo } from './types.js'

export type DetailLevel = 'minimal' | 'normal' | 'full'

export interface CompactScreenElement {
  id: string
  l?: string
  t?: string
  b: [number, number, number, number]
  c: [number, number]
  e?: boolean
  v?: boolean
  f?: boolean
  w?: string
  s?: string
}

export function compactElement(el: ScreenElement): CompactScreenElement {
  const out: CompactScreenElement = {
    id: el.id,
    l: el.label || undefined,
    t: el.type === 'unknown' ? undefined : el.type,
    b: [el.bounds.x, el.bounds.y, el.bounds.width, el.bounds.height],
    c: [el.center.x, el.center.y],
  }
  if (!el.isEnabled) out.e = false
  if (!el.isVisible) out.v = false
  if (el.isFocused) out.f = true
  if (el.windowId) out.w = el.windowId
  if (el.source !== 'uia') out.s = el.source
  return out
}

export function expandCompactElement(ce: CompactScreenElement): ScreenElement {
  return {
    id: ce.id,
    label: ce.l ?? '',
    type: (ce.t as ScreenElement['type']) ?? 'unknown',
    bounds: { x: ce.b[0], y: ce.b[1], width: ce.b[2], height: ce.b[3] },
    center: { x: ce.c[0], y: ce.c[1] },
    isEnabled: ce.e ?? true,
    isVisible: ce.v ?? true,
    isFocused: ce.f ?? false,
    windowId: ce.w,
    source: (ce.s as 'ocr' | 'uia') ?? 'uia',
  }
}

export function compactifyElements(
  elements: ScreenElement[],
  windows: WindowInfo[],
  level: DetailLevel = 'normal',
): Record<string, unknown> {
  if (level === 'minimal') {
    return {
      c: elements.length,
      w: windows.map(w => ({
        id: w.id,
        t: w.title.slice(0, 40),
        f: w.isFocused,
        d: w.isDialog,
      })),
      e: elements.slice(0, 20).map(compactElement),
    }
  }

  if (level === 'full') {
    return {
      elementCount: elements.length,
      windowCount: windows.length,
      windows: windows.map(w => ({
        ...w,
        elementCount: elements.filter(e => e.windowId === w.id).length,
      })),
      elements: elements.slice(0, 500).map(compactElement),
    }
  }

  return {
    elementCount: elements.length,
    windowCount: windows.length,
    windows: windows.map(w => ({
      id: w.id,
      title: w.title,
      processName: w.processName,
      bounds: w.bounds,
      isFocused: w.isFocused,
      isDialog: w.isDialog,
      elementCount: elements.filter(e => e.windowId === w.id).length,
    })),
    elements: elements.slice(0, 200).map(compactElement),
  }
}
