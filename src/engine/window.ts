import type { WindowInfo, Bounds, ScreenElement } from '../utils/types.js'
import { logger } from '../utils/logger.js'

function computeIoU(a: Bounds, b: Bounds): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const intersection = xOverlap * yOverlap
  const union = a.width * a.height + b.width * b.height - intersection
  return union <= 0 ? 0 : intersection / union
}

function boundsCenter(b: Bounds): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

function boundsDistance(a: Bounds, b: Bounds): number {
  const ca = boundsCenter(a)
  const cb = boundsCenter(b)
  return Math.sqrt((ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2)
}

type WindowChangeType =
  | 'unchanged'
  | 'resized'
  | 'moved'
  | 'minimized'
  | 'maximized'
  | 'restored'
  | 'closed'
  | 'new'
  | 'focus_changed'

interface WindowChange {
  type: WindowChangeType
  before: WindowInfo | null
  after: WindowInfo | null
}

const WINDOW_MATCH_IoU_THRESHOLD = 0.5
const WINDOW_MATCH_DISTANCE_THRESHOLD = 200

export class WindowTracker {
  private previousWindows: WindowInfo[] = []
  private windowIdCounter = 0

  matchWindows(
    currentWindows: WindowInfo[]
  ): { windows: WindowInfo[]; changes: WindowChange[] } {
    const changes: WindowChange[] = []
    const matched = new Set<number>()
    const merged: WindowInfo[] = []

    for (const curr of currentWindows) {
      let bestMatch: { idx: number; score: number } | null = null

      for (let i = 0; i < this.previousWindows.length; i++) {
        if (matched.has(i)) continue
        const prev = this.previousWindows[i]
        const iou = computeIoU(prev.bounds, curr.bounds)
        const dist = boundsDistance(prev.bounds, curr.bounds)
        const titleSim = titleSimilarity(prev.title, curr.title)
        const score = iou * 0.5 + titleSim * 0.3 + Math.max(0, 1 - dist / WINDOW_MATCH_DISTANCE_THRESHOLD) * 0.2

        if (score > 0.4 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { idx: i, score }
        }
      }

      if (bestMatch !== null) {
        matched.add(bestMatch.idx)
        const prev = this.previousWindows[bestMatch.idx]
        const change = this.detectChange(prev, curr)
        if (change.type !== 'unchanged') {
          changes.push(change)
        }
        merged.push({ ...curr, id: prev.id })
      } else {
        changes.push({ type: 'new', before: null, after: curr })
        merged.push({ ...curr, id: `win_${++this.windowIdCounter}` })
      }
    }

    for (let i = 0; i < this.previousWindows.length; i++) {
      if (!matched.has(i)) {
        changes.push({ type: 'closed', before: this.previousWindows[i], after: null })
      }
    }

    this.previousWindows = merged
    return { windows: merged, changes }
  }

  private detectChange(prev: WindowInfo, curr: WindowInfo): WindowChange {
    if (curr.isMinimized && !prev.isMinimized) {
      return { type: 'minimized', before: prev, after: curr }
    }
    if (curr.isMaximized && !prev.isMaximized) {
      return { type: 'maximized', before: prev, after: curr }
    }
    if (!curr.isMinimized && prev.isMinimized) {
      return { type: 'restored', before: prev, after: curr }
    }
    if (curr.isFocused && !prev.isFocused) {
      return { type: 'focus_changed', before: prev, after: curr }
    }
    if (
      prev.bounds.width !== curr.bounds.width ||
      prev.bounds.height !== curr.bounds.height
    ) {
      return { type: 'resized', before: prev, after: curr }
    }
    if (
      prev.bounds.x !== curr.bounds.x ||
      prev.bounds.y !== curr.bounds.y
    ) {
      return { type: 'moved', before: prev, after: curr }
    }
    return { type: 'unchanged', before: prev, after: curr }
  }

  findElementWindow(
    element: ScreenElement,
    windows: WindowInfo[]
  ): WindowInfo | null {
    if (element.windowId) {
      const byId = windows.find(w => w.id === element.windowId)
      if (byId) return byId
    }

    const elBounds: Bounds = {
      x: element.center.x - 5,
      y: element.center.y - 5,
      width: 10,
      height: 10,
    }

    const scored = windows
      .filter(w => !w.isMinimized)
      .map(w => ({
        window: w,
        contained: isContainedIn(elBounds, w.bounds),
        overlap: computeIoU(elBounds, w.bounds),
        centerDist: boundsDistance(
          { x: element.center.x, y: element.center.y, width: 0, height: 0 },
          { x: w.bounds.x, y: w.bounds.y, width: 0, height: 0 }
        ),
      }))
      .sort((a, b) => {
        if (a.contained && !b.contained) return -1
        if (!a.contained && b.contained) return 1
        return a.centerDist - b.centerDist
      })

    return scored.length > 0 && scored[0].overlap > 0 ? scored[0].window : null
  }

  assignElementsToWindows(
    elements: ScreenElement[],
    windows: WindowInfo[]
  ): ScreenElement[] {
    return elements.map(el => {
      if (el.windowId) return el
      const win = this.findElementWindow(el, windows)
      return win ? { ...el, windowId: win.id } : el
    })
  }

  reset(): void {
    this.previousWindows = []
  }
}

function isContainedIn(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function titleSimilarity(a: string, b: string): number {
  const an = a.toLowerCase().trim()
  const bn = b.toLowerCase().trim()
  if (an === bn) return 1
  if (an.includes(bn) || bn.includes(an)) return 0.85

  const wordsA = new Set(an.split(/\s+/))
  const wordsB = new Set(bn.split(/\s+/))
  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const union = wordsA.size + wordsB.size - intersection
  return union > 0 ? intersection / union : 0
}

export function isClickWithinBounds(
  x: number,
  y: number,
  bounds: Bounds,
  margin = 0
): boolean {
  return (
    x >= bounds.x - margin &&
    x <= bounds.x + bounds.width + margin &&
    y >= bounds.y - margin &&
    y <= bounds.y + bounds.height + margin
  )
}

export { computeIoU, isContainedIn, WindowChangeType }
export type { WindowChange }
