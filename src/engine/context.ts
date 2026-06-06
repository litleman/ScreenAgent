import type { ScreenState, ScreenElement, WindowInfo, Bounds } from '../utils/types.js'
import { logger } from '../utils/logger.js'
import { WindowTracker, type WindowChange } from './window.js'
import { levenshteinSimilarity as sharedLevenshtein } from '../utils/levenshtein.js'

export class ScreenContext {
  private currentState: ScreenState | null = null
  private previousState: ScreenState | null = null
  private windowTracker = new WindowTracker()
  private windowResizedSinceLastScan = false
  private focusChangedSinceLastScan = false
  private menuTransitionSinceLastScan = false
  private previousFocusedType: string | null = null

  get state(): ScreenState | null {
    return this.currentState
  }

  get previous(): ScreenState | null {
    return this.previousState
  }

  hadWindowResizeSinceLastScan(): boolean {
    const val = this.windowResizedSinceLastScan
    this.windowResizedSinceLastScan = false
    return val
  }

  hadFocusChangeSinceLastScan(): boolean {
    const val = this.focusChangedSinceLastScan
    this.focusChangedSinceLastScan = false
    return val
  }

  hadMenuTransitionSinceLastScan(): boolean {
    const val = this.menuTransitionSinceLastScan
    this.menuTransitionSinceLastScan = false
    return val
  }

  update(
    elements: ScreenElement[],
    windows: WindowInfo[],
    focusedApp: string | null,
    focusedWindowId: string | null,
    screenshotPath: string | null,
    isLoading = false,
    loadingIndicators: string[] = [],
  ): ScreenState {
    this.previousState = this.currentState

    const { windows: trackedWindows, changes } = this.windowTracker.matchWindows(windows)
    const oldToNew = new Map<string, string>()
    for (let i = 0; i < trackedWindows.length; i++) {
      oldToNew.set(windows[i]?.id ?? '', trackedWindows[i].id)
    }
    const remappedElements = elements.map(el => ({
      ...el,
      windowId: el.windowId ? (oldToNew.get(el.windowId) ?? el.windowId) : undefined,
    }))
    const windowAssigned = this.windowTracker.assignElementsToWindows(remappedElements, trackedWindows)

    const hasResize = changes.some(c => c.type === 'resized' || c.type === 'moved' || c.type === 'minimized' || c.type === 'restored' || c.type === 'maximized')
    if (hasResize) {
      this.windowResizedSinceLastScan = true
    }

    const hasFocusChange = changes.some(c => c.type === 'focus_changed')
    if (hasFocusChange) {
      this.focusChangedSinceLastScan = true
    }

    const newState: ScreenState = {
      timestamp: new Date().toISOString(),
      focusedApp,
      focusedWindowId,
      windows: trackedWindows,
      elements: windowAssigned,
      isLoading,
      loadingIndicators,
      screenshotPath,
    }

    this.currentState = newState

    this.detectMenuTransition(windowAssigned, focusedWindowId)

    return newState
  }

  private detectMenuTransition(elements: ScreenElement[], focusedWindowId: string | null): void {
    if (!focusedWindowId) return
    const focusedEls = elements.filter(e => e.windowId === focusedWindowId && e.isFocused)
    const currentType = focusedEls.length > 0 ? focusedEls[0].type : null
    if (currentType === 'menu' && this.previousFocusedType !== null && this.previousFocusedType !== 'menu') {
      this.menuTransitionSinceLastScan = true
    }
    this.previousFocusedType = currentType
  }

  findElement(
    label: string,
    fuzzy = true,
    windowTitle?: string,
  ): { element: ScreenElement | null; window: WindowInfo | null; confidence: number } {
    const state = this.currentState
    if (!state) return { element: null, window: null, confidence: 0 }

    let candidates = state.elements

    if (windowTitle) {
      const win = state.windows.find(
        w => w.title.toLowerCase().includes(windowTitle.toLowerCase())
      )
      if (win) {
        candidates = candidates.filter(e => e.windowId === win.id)
      }
    }

    const exact = candidates.find(
      e => e.label.toLowerCase() === label.toLowerCase()
    )
    if (exact) {
      const win = this.windowTracker.findElementWindow(exact, state.windows)
      return { element: exact, window: win, confidence: 1 }
    }

    if (!fuzzy) {
      return { element: null, window: null, confidence: 0 }
    }

    const scored = candidates
      .map(e => ({
        element: e,
        score: labelSimilarity(e.label, label),
      }))
      .filter(m => m.score > 0.5)
      .sort((a, b) => b.score - a.score)

    if (scored.length > 0) {
      const best = scored[0]
      const win = this.windowTracker.findElementWindow(best.element, state.windows)
      return { element: best.element, window: win, confidence: best.score }
    }

    return { element: null, window: null, confidence: 0 }
  }

  findWindowChangeSinceLastScan(): string[] {
    const changes: string[] = []
    if (!this.currentState || !this.previousState) return changes

    const prevWindows = new Map(this.previousState.windows.map(w => [w.id, w]))
    for (const curr of this.currentState.windows) {
      const prev = prevWindows.get(curr.id)
      if (!prev) {
        changes.push(`窗口已打开: ${curr.title}`)
        continue
      }
      if (prev.bounds.x !== curr.bounds.x || prev.bounds.y !== curr.bounds.y) {
        changes.push(`窗口移动: ${curr.title}`)
      }
      if (
        prev.bounds.width !== curr.bounds.width ||
        prev.bounds.height !== curr.bounds.height
      ) {
        changes.push(`窗口缩放: ${curr.title} (${prev.bounds.width}x${prev.bounds.height} → ${curr.bounds.width}x${curr.bounds.height})`)
      }
      if (curr.isFocused && !prev.isFocused) {
        changes.push(`窗口获得焦点: ${curr.title}`)
      }
      if (curr.isMinimized && !prev.isMinimized) {
        changes.push(`窗口最小化: ${curr.title}`)
      }
      if (!curr.isMinimized && prev.isMinimized) {
        changes.push(`窗口还原: ${curr.title}`)
      }
    }

    for (const prev of this.previousState.windows) {
      if (!this.currentState.windows.find(w => w.id === prev.id)) {
        changes.push(`窗口已关闭: ${prev.title}`)
      }
    }

    return changes
  }

  getWindowById(id: string): WindowInfo | null {
    return this.currentState?.windows.find(w => w.id === id) ?? null
  }

  getFocusedWindow(): WindowInfo | null {
    return this.currentState?.windows.find(w => w.isFocused) ?? null
  }

  getActiveWindowElements(): ScreenElement[] {
    const state = this.currentState
    if (!state) return []
    const focused = state.windows.find(w => w.isFocused)
    if (!focused) return state.elements
    return state.elements.filter(e => e.windowId === focused.id)
  }

  getWindowForElement(elementId: string): { element: ScreenElement | null; window: WindowInfo | null } {
    const state = this.currentState
    if (!state) return { element: null, window: null }

    const el = state.elements.find(e => e.id === elementId)
    if (!el) return { element: null, window: null }

    const win = el.windowId
      ? state.windows.find(w => w.id === el.windowId) ?? null
      : null
    return { element: el, window: win }
  }

  reset(): void {
    this.currentState = null
    this.previousState = null
    this.windowTracker.reset()
  }
}

function labelSimilarity(a: string, b: string): number {
  const al = a.toLowerCase().trim()
  const bl = b.toLowerCase().trim()
  if (al === bl) return 1
  if (al.includes(bl) || bl.includes(al)) return 0.85

  return sharedLevenshtein(al, bl)
}

export const screenContext = new ScreenContext()
