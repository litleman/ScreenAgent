import type { ScreenElement, WindowInfo } from './types.js'

export interface ScoredElement extends ScreenElement {
  relevanceScore: number
}

export interface ScoringConfig {
  focusBoost: number
  centerBoost: number
  visiblePenalty: number
  dialogPenalty: number
  maxElements: number
}

const DEFAULT_CONFIG: ScoringConfig = {
  focusBoost: 0.3,
  centerBoost: 0.15,
  visiblePenalty: 0.5,
  dialogPenalty: 0.2,
  maxElements: 100,
}

export function scoreElements(
  elements: ScreenElement[],
  windows: WindowInfo[],
  config: Partial<ScoringConfig> = {},
): ScoredElement[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const activeWindowIds = new Set(
    windows.filter(w => w.isFocused).map(w => w.id),
  )
  const dialogWindowIds = new Set(
    windows.filter(w => w.isDialog).map(w => w.id),
  )

  const scored = elements.filter(e => {
    if (!e.isVisible) return false
    if (!e.isEnabled && e.type !== 'text' && e.type !== 'text_block') return false
    return true
  }).map(el => {
    let score = 0

    const windowId = el.windowId ?? ''
    if (activeWindowIds.has(windowId)) score += cfg.focusBoost
    if (dialogWindowIds.has(windowId)) score -= cfg.dialogPenalty

    const cx = el.center.x
    const cy = el.center.y
    const focusedWindow = windows.find(w => w.isFocused)
    if (focusedWindow) {
      const wb = focusedWindow.bounds
      const winCx = wb.x + wb.width / 2
      const winCy = wb.y + wb.height / 2
      const dist = Math.sqrt((cx - winCx) ** 2 + (cy - winCy) ** 2)
      const maxDist = Math.sqrt(wb.width ** 2 + wb.height ** 2) / 2
      if (maxDist > 0) {
        score += cfg.centerBoost * Math.max(0, 1 - dist / maxDist)
      }
    }

    score += (el.confidence ?? 0.5)

    if (!el.isVisible) score *= (1 - cfg.visiblePenalty)

    return { ...el, relevanceScore: score }
  })

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore)
  return scored
}

export function selectTopElements(
  elements: ScreenElement[],
  windows: WindowInfo[],
  maxElements: number = 20,
): ScoredElement[] {
  const scored = scoreElements(elements, windows, { maxElements })
  return scored.slice(0, maxElements)
}
