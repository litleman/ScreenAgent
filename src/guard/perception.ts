import type { ScreenElement, Bounds, ClickValidation, RiskLevel } from '../utils/types.js'

export interface PerceptionResult {
  passed: boolean
  element: ScreenElement | null
  confidence: number
  warnings: string[]
}

export function findElementByLabel(
  elements: ScreenElement[],
  label: string,
  fuzzy = true,
): PerceptionResult {
  const exact = elements.find(
    e => e.label.toLowerCase() === label.toLowerCase()
  )
  if (exact) {
    return { passed: true, element: exact, confidence: 1, warnings: [] }
  }

  if (!fuzzy) {
    return { passed: false, element: null, confidence: 0, warnings: [`未找到元素 "${label}"`] }
  }

  const fuzzyMatches = elements
    .map(e => ({
      element: e,
      score: similarity(e.label.toLowerCase(), label.toLowerCase()),
    }))
    .filter(m => m.score > 0.5)
    .sort((a, b) => b.score - a.score)

  if (fuzzyMatches.length > 0) {
    const best = fuzzyMatches[0]
    const warnings = best.score < 0.8
      ? [`模糊匹配 "${label}" → "${best.element.label}" (${(best.score * 100).toFixed(0)}%)`]
      : []
    return {
      passed: best.score > 0.6,
      element: best.element,
      confidence: best.score,
      warnings,
    }
  }

  return { passed: false, element: null, confidence: 0, warnings: [`未找到元素 "${label}"`] }
}

export function isClickWithinBounds(
  x: number,
  y: number,
  bounds: Bounds,
  margin = 0,
): boolean {
  return (
    x >= bounds.x - margin &&
    x <= bounds.x + bounds.width + margin &&
    y >= bounds.y - margin &&
    y <= bounds.y + bounds.height + margin
  )
}

export function canInteract(element: ScreenElement): string[] {
  const warnings: string[] = []
  if (!element.isEnabled) warnings.push(`元素 "${element.label}" 已禁用`)
  if (!element.isVisible) warnings.push(`元素 "${element.label}" 不可见`)
  return warnings
}

export function findWindowByElement(
  element: ScreenElement,
  windows: Array<{ id: string; title: string; bounds: Bounds; isMinimized: boolean }>,
): { window: { id: string; title: string; bounds: Bounds } | null; containment: 'inside' | 'outside' | 'unknown' } {
  if (element.windowId) {
    const win = windows.find(w => w.id === element.windowId)
    if (win && !win.isMinimized) {
      const inside = isClickWithinBounds(element.center.x, element.center.y, win.bounds)
      return { window: win, containment: inside ? 'inside' : 'outside' }
    }
  }

  const scored = windows
    .filter(w => !w.isMinimized)
    .map(w => ({
      window: w,
      containsCenter: isClickWithinBounds(element.center.x, element.center.y, w.bounds),
      overlapArea: overlapAreaRatio(element.bounds, w.bounds),
    }))
    .sort((a, b) => {
      if (a.containsCenter && !b.containsCenter) return -1
      if (!a.containsCenter && b.containsCenter) return 1
      return b.overlapArea - a.overlapArea
    })

  if (scored.length > 0 && scored[0].overlapArea > 0) {
    return {
      window: scored[0].window,
      containment: scored[0].containsCenter ? 'inside' : 'outside',
    }
  }

  return { window: null, containment: 'unknown' }
}

function overlapAreaRatio(a: Bounds, b: Bounds): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const intersection = xOverlap * yOverlap
  if (intersection <= 0) return 0

  const areaA = a.width * a.height
  return areaA > 0 ? intersection / areaA : 0
}

export function estimateElementConfidence(
  element: ScreenElement,
  sourceElements: ScreenElement[],
): number {
  let score = element.confidence ?? 0.5
  if (element.source === 'uia') score = Math.max(score, 0.85)
  if (element.windowId) score = Math.min(1, score + 0.1)
  if (element.parentId) score = Math.min(1, score + 0.05)
  if (element.childIds && element.childIds.length > 0) score = Math.min(1, score + 0.05)
  return score
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.85

  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  )
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return 1 - dp[a.length][b.length] / maxLen
}
