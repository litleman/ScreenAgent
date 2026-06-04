import { describe, it, expect, beforeEach } from 'vitest'
import { ScreenContext } from '../context.js'
import type { ScreenElement, WindowInfo } from '../../utils/types.js'

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

describe('ScreenContext', () => {
  let ctx: ScreenContext

  beforeEach(() => {
    ctx = new ScreenContext()
  })

  describe('update', () => {
    it('初始状态为 null', () => {
      expect(ctx.state).toBeNull()
      expect(ctx.previous).toBeNull()
    })

    it('更新后 state 不为 null', () => {
      ctx.update([], [], null, null, null)
      expect(ctx.state).not.toBeNull()
    })

    it('第二次更新后 previous 不为 null', () => {
      ctx.update([], [], null, null, null)
      ctx.update([], [], null, null, null)
      expect(ctx.previous).not.toBeNull()
    })

    it('保存时间戳', () => {
      ctx.update([], [], null, null, null)
      expect(ctx.state!.timestamp).toBeTruthy()
    })
  })

  describe('findElement', () => {
    it('无状态时返回空', () => {
      const result = ctx.findElement('anything')
      expect(result.element).toBeNull()
      expect(result.window).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('精确匹配返回元素', () => {
      ctx.update([makeEl('提交')], [], null, null, null)
      const result = ctx.findElement('提交')
      expect(result.element).not.toBeNull()
      expect(result.element!.label).toBe('提交')
      expect(result.confidence).toBe(1)
    })

    it('精确匹配忽略大小写', () => {
      ctx.update([makeEl('Submit')], [], null, null, null)
      const result = ctx.findElement('submit')
      expect(result.element?.label).toBe('Submit')
    })

    it('fuzzy=false 时不模糊匹配', () => {
      ctx.update([makeEl('确定')], [], null, null, null)
      const result = ctx.findElement('确定按钮', false)
      expect(result.element).toBeNull()
    })

    it('模糊匹配相近文本', () => {
      ctx.update([makeEl('确定')], [], null, null, null)
      const result = ctx.findElement('确定按钮')
      expect(result.element?.label).toBe('确定')
    })

    it('按窗口标题过滤', () => {
      const win = makeWin('w1', { id: 'w1', title: 'Main Window' })
      const el1 = makeEl('保存', { windowId: 'w1' })
      const el2 = makeEl('保存', { windowId: 'w2' })
      const win2 = makeWin('w2', { id: 'w2', title: 'Dialog' })
      ctx.update([el1, el2], [win, win2], null, null, null)
      const result = ctx.findElement('保存', true, 'Main')
      expect(result.element).not.toBeNull()
      const trackedWin = ctx.state?.windows.find(w => w.title === 'Main Window')
      expect(result.element?.windowId).toBe(trackedWin?.id)
    })
  })

  describe('findWindowChangeSinceLastScan', () => {
    it('无先前状态时返回空', () => {
      ctx.update([], [makeWin('w1')], null, null, null)
      expect(ctx.findWindowChangeSinceLastScan()).toEqual([])
    })

    it('检测新窗口', () => {
      ctx.update([], [makeWin('w1')], null, null, null)
      const changes = ctx.findWindowChangeSinceLastScan()
      expect(changes).toEqual([])
    })

    it('检测窗口移动', () => {
      ctx.update([], [makeWin('w1')], null, null, null)
      ctx.update([], [makeWin('w1', { bounds: { x: 10, y: 10, width: 800, height: 600 } })], null, null, null)
      const changes = ctx.findWindowChangeSinceLastScan()
      expect(changes.some(c => c.includes('移动'))).toBe(true)
    })
  })

  describe('getWindowById', () => {
    it('返回匹配窗口', () => {
      ctx.update([], [makeWin('w1', { title: 'Test' })], null, null, null)
      const state = ctx.state!
      expect(state.windows.length).toBe(1)
      const trackedId = state.windows[0].id
      const found = ctx.getWindowById(trackedId)
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Test')
    })

    it('无匹配时返回 null', () => {
      expect(ctx.getWindowById('nonexistent')).toBeNull()
    })
  })

  describe('getFocusedWindow', () => {
    it('返回有焦点的窗口', () => {
      const win1 = makeWin('w1', { isFocused: false })
      const win2 = makeWin('w2', { isFocused: true, title: 'Focused' })
      ctx.update([], [win1, win2], null, null, null)
      expect(ctx.getFocusedWindow()?.title).toBe('Focused')
    })

    it('无焦点窗口时返回 null', () => {
      ctx.update([], [makeWin('w1', { isFocused: false })], null, null, null)
      expect(ctx.getFocusedWindow()).toBeNull()
    })
  })

  describe('getWindowForElement', () => {
    it('返回元素关联的窗口', () => {
      const win = makeWin('w1')
      const el = makeEl('btn', { windowId: 'w1' })
      ctx.update([el], [win], null, null, null)
      const result = ctx.getWindowForElement('el_btn')
      expect(result.element?.label).toBe('btn')
      const trackedWin = ctx.state?.windows.find(w => w.title === 'Window w1')
      expect(result.window?.id).toBe(trackedWin?.id)
    })

    it('元素不存在时返回 null', () => {
      expect(ctx.getWindowForElement('nope')).toEqual({ element: null, window: null })
    })
  })

  describe('reset', () => {
    it('重置后状态清空', () => {
      ctx.update([], [], null, null, null)
      ctx.reset()
      expect(ctx.state).toBeNull()
      expect(ctx.previous).toBeNull()
    })
  })
})
