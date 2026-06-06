import type { WindowInfo } from './types.js'

export function mergeWindows(a?: WindowInfo[], b?: WindowInfo[]): WindowInfo[] {
  const map = new Map<string, WindowInfo>()
  for (const w of a ?? []) map.set(w.id, w)
  for (const w of b ?? []) {
    if (!map.has(w.id)) map.set(w.id, w)
  }
  return Array.from(map.values())
}

export function parseWindows(raw: unknown): WindowInfo[] | undefined {
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
      isDialog: w.isDialog != null ? Boolean(w.isDialog) : undefined,
      blockedBy: w.blockedBy != null ? String(w.blockedBy) : undefined,
    }
  })
}
