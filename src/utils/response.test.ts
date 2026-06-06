import { describe, it, expect } from 'vitest'
import { compactElement, compactWindow, compactifyData } from './response.js'
import type { ScreenElement, WindowInfo } from './types.js'

describe('compactElement', () => {
  it('abbreviates all fields for UIA element', () => {
    const el: ScreenElement = {
      id: 'btn-1',
      label: '确定',
      type: 'button',
      bounds: { x: 100, y: 200, width: 80, height: 32 },
      center: { x: 140, y: 216 },
      isEnabled: true,
      isVisible: true,
      isFocused: false,
      source: 'uia',
      confidence: 0.95,
      windowId: 'win-1',
      className: 'Button',
    }
    const c = compactElement(el)
    expect(c.i).toBe('btn-1')
    expect(c.l).toBe('确定')
    expect(c.t).toBe('button')
    expect(c.s).toBe('uia')
    expect(c.b).toEqual({ x: 100, y: 200, w: 80, h: 32 })
    expect(c.c).toEqual({ x: 140, y: 216 })
    expect(c.w).toBe('win-1')
    expect(c.cl).toBe('Button')
    expect(c.e).toBeUndefined()
    expect(c.v).toBeUndefined()
    expect(c.f).toBeUndefined()
    expect(c.co).toBe(0.95)
  })

  it('omits bounds/center for OCR elements', () => {
    const el: ScreenElement = {
      id: 'ocr-1',
      label: 'Hello',
      type: 'text_block',
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      center: { x: 0, y: 0 },
      isEnabled: true,
      isVisible: true,
      isFocused: false,
      source: 'ocr',
    }
    const c = compactElement(el)
    expect(c.i).toBe('ocr-1')
    expect(c.l).toBe('Hello')
    expect(c.s).toBe('ocr')
    expect(c.b).toBeUndefined()
    expect(c.c).toBeUndefined()
  })

  it('includes enabled/visible/focused when non-default', () => {
    const el: ScreenElement = {
      id: 'chk',
      label: '同意',
      type: 'checkbox',
      bounds: { x: 0, y: 0, width: 100, height: 20 },
      center: { x: 50, y: 10 },
      isEnabled: false,
      isVisible: false,
      isFocused: true,
      source: 'uia',
    }
    const c = compactElement(el)
    expect(c.e).toBe(false)
    expect(c.v).toBe(false)
    expect(c.f).toBe(true)
  })
})

describe('compactWindow', () => {
  it('abbreviates all fields', () => {
    const w: WindowInfo = {
      id: 'w-1',
      title: '测试窗口',
      processName: 'notepad.exe',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      isMinimized: false,
      isMaximized: false,
      isFocused: true,
      isDialog: false,
      zOrder: 1,
    }
    const c = compactWindow(w)
    expect(c.i).toBe('w-1')
    expect(c.tl).toBe('测试窗口')
    expect(c.pn).toBe('notepad.exe')
    expect(c.b).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(c.z).toBe(1)
    expect(c.f).toBe(true)
    expect(c.im).toBeUndefined()
    expect(c.ix).toBeUndefined()
    expect(c.id).toBeUndefined()
  })

  it('includes dialog/blockedBy when present', () => {
    const w: WindowInfo = {
      id: 'w-2',
      title: '确认',
      processName: 'notepad.exe',
      bounds: { x: 100, y: 100, width: 300, height: 150 },
      isMinimized: true,
      isMaximized: false,
      isFocused: false,
      isDialog: true,
      blockedBy: 'w-1',
      zOrder: 2,
    }
    const c = compactWindow(w)
    expect(c.id).toBe(true)
    expect(c.im).toBe(true)
    expect(c.bb).toBe('w-1')
  })
})

describe('compactifyData', () => {
  it('transforms elements and windows in response data', () => {
    const data = {
      success: true,
      elements: [
        { id: 'e1', label: 'OK', type: 'button', bounds: { x: 0, y: 0, width: 50, height: 20 }, center: { x: 25, y: 10 }, isEnabled: true, isVisible: true, isFocused: false, source: 'uia' } as ScreenElement,
      ],
      windows: [
        { id: 'w1', title: 'App', processName: 'app.exe', bounds: { x: 0, y: 0, width: 1024, height: 768 }, isMinimized: false, isMaximized: false, isFocused: true, zOrder: 0 } as WindowInfo,
      ],
    }
    const c = compactifyData(data)
    expect(c.elements).toHaveLength(1)
    expect((c.elements as Record<string, unknown>[])[0].i).toBe('e1')
    expect(c.windows).toHaveLength(1)
    expect((c.windows as Record<string, unknown>[])[0].i).toBe('w1')
  })
})
