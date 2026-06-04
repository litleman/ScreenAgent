import { describe, it, expect, beforeEach } from 'vitest'
import { WindowTracker, computeIoU, isContainedIn } from '../window.js'
import type { WindowInfo, ScreenElement } from '../../utils/types.js'

function makeWin(id: string, overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    id,
    title: `Window ${id}`,
    processName: 'test.exe',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    isMinimized: false,
    isMaximized: false,
    isFocused: false,
    zOrder: 0,
    ...overrides,
  }
}

function makeEl(id: string, overrides: Partial<ScreenElement> = {}): ScreenElement {
  return {
    id: `el_${id}`,
    label: id,
    type: 'button',
    bounds: { x: 100, y: 100, width: 50, height: 20 },
    center: { x: 125, y: 110 },
    isEnabled: true,
    isVisible: true,
    isFocused: false,
    source: 'ocr',
    confidence: 0.9,
    ...overrides,
  }
}

describe('computeIoU', () => {
  it('完全重叠时返回 1', () => {
    const b = { x: 0, y: 0, width: 100, height: 100 }
    expect(computeIoU(b, b)).toBe(1)
  })

  it('无重叠时返回 0', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    const b = { x: 100, y: 100, width: 10, height: 10 }
    expect(computeIoU(a, b)).toBe(0)
  })

  it('半重叠时返回正确值', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 50, y: 0, width: 100, height: 100 }
    const result = computeIoU(a, b)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
  })

  it('零面积时返回 0', () => {
    const a = { x: 0, y: 0, width: 0, height: 0 }
    const b = { x: 0, y: 0, width: 100, height: 100 }
    expect(computeIoU(a, b)).toBe(0)
  })
})

describe('isContainedIn', () => {
  it('内部框完全在外部框内时返回 true', () => {
    const inner = { x: 10, y: 10, width: 50, height: 50 }
    const outer = { x: 0, y: 0, width: 100, height: 100 }
    expect(isContainedIn(inner, outer)).toBe(true)
  })

  it('内部框超出外部框时返回 false', () => {
    const inner = { x: -10, y: 0, width: 50, height: 50 }
    const outer = { x: 0, y: 0, width: 100, height: 100 }
    expect(isContainedIn(inner, outer)).toBe(false)
  })
})

describe('WindowTracker', () => {
  let tracker: WindowTracker

  beforeEach(() => {
    tracker = new WindowTracker()
  })

  describe('matchWindows', () => {
    it('首次匹配分配新 ID', () => {
      const wins = [makeWin('w1')]
      const result = tracker.matchWindows(wins)
      expect(result.windows).toHaveLength(1)
      expect(result.windows[0].id).toMatch(/^win_\d+$/)
    })

    it('相同窗口保留 ID', () => {
      const wins = [makeWin('w1')]
      const first = tracker.matchWindows(wins)
      const second = tracker.matchWindows(wins)
      expect(second.windows[0].id).toBe(first.windows[0].id)
    })

    it('窗口移动后仍匹配', () => {
      const wins1 = [makeWin('w1', { bounds: { x: 0, y: 0, width: 800, height: 600 } })]
      const first = tracker.matchWindows(wins1)
      const wins2 = [makeWin('w1', { bounds: { x: 100, y: 50, width: 800, height: 600 } })]
      const second = tracker.matchWindows(wins2)
      expect(second.windows[0].id).toBe(first.windows[0].id)
    })

    it('检测窗口关闭', () => {
      const wins1 = [makeWin('w1'), makeWin('w2')]
      tracker.matchWindows(wins1)
      const result2 = tracker.matchWindows([makeWin('w1')])
      expect(result2.changes.some(c => c.type === 'closed')).toBe(true)
    })

    it('检测新窗口', () => {
      tracker.matchWindows([makeWin('w1')])
      const result = tracker.matchWindows([makeWin('w1'), makeWin('w2')])
      expect(result.changes.some(c => c.type === 'new')).toBe(true)
    })

    it('检测窗口最小化', () => {
      const wins1 = [makeWin('w1', { isMinimized: false })]
      tracker.matchWindows(wins1)
      const result = tracker.matchWindows([makeWin('w1', { isMinimized: true })])
      expect(result.changes.some(c => c.type === 'minimized')).toBe(true)
    })

    it('检测窗口还原', () => {
      tracker.matchWindows([makeWin('w1', { isMinimized: true })])
      const result = tracker.matchWindows([makeWin('w1', { isMinimized: false })])
      expect(result.changes.some(c => c.type === 'restored')).toBe(true)
    })

    it('检测焦点变化', () => {
      tracker.matchWindows([makeWin('w1', { isFocused: false })])
      const result = tracker.matchWindows([makeWin('w1', { isFocused: true })])
      expect(result.changes.some(c => c.type === 'focus_changed')).toBe(true)
    })
  })

  describe('findElementWindow', () => {
    it('通过 windowId 找到窗口', () => {
      const win = makeWin('w1')
      const el = makeEl('btn', { windowId: 'w1' })
      const found = tracker.findElementWindow(el, [win])
      expect(found?.id).toBe('w1')
    })

    it('无匹配时返回 null', () => {
      const el = makeEl('btn')
      const found = tracker.findElementWindow(el, [])
      expect(found).toBeNull()
    })

    it('通过重叠找到窗口', () => {
      const win = makeWin('w1', { bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const el = makeEl('btn', {
        center: { x: 400, y: 300 },
        bounds: { x: 390, y: 290, width: 20, height: 20 },
      })
      const found = tracker.findElementWindow(el, [win])
      expect(found?.id).toBe('w1')
    })
  })

  describe('assignElementsToWindows', () => {
    it('为无 windowId 的元素分配窗口', () => {
      const win = makeWin('w1', { bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const el = makeEl('btn', {
        center: { x: 400, y: 300 },
      })
      const assigned = tracker.assignElementsToWindows([el], [win])
      const result = tracker.findElementWindow(el, [win])
      expect(assigned[0].windowId ?? result?.id).toBe('w1')
    })

    it('保留已有 windowId', () => {
      const win = makeWin('w1')
      const el = makeEl('btn', { windowId: 'w1' })
      const assigned = tracker.assignElementsToWindows([el], [win])
      expect(assigned[0].windowId).toBe('w1')
    })
  })

  describe('reset', () => {
    it('重置后重新分配 ID', () => {
      const wins = [makeWin('w1')]
      const first = tracker.matchWindows(wins)
      tracker.reset()
      const second = tracker.matchWindows(wins)
      expect(second.windows[0].id).not.toBe(first.windows[0].id)
    })
  })
})
