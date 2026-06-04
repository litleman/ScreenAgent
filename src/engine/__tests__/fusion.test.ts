import { describe, it, expect } from 'vitest'
import { fuseElements, dedupeByBounds } from '../fusion.js'
import type { ScreenElement, WindowInfo } from '../../utils/types.js'

function makeUia(id: string, label: string, x: number, y: number, w: number, h: number): ScreenElement {
  return {
    id, label, type: 'button', source: 'uia', confidence: 0.9,
    bounds: { x, y, width: w, height: h },
    center: { x: x + w / 2, y: y + h / 2 },
    isEnabled: true, isVisible: true, isFocused: false,
  }
}

function makeOcr(label: string, x: number, y: number, w: number, h: number, conf = 0.6): ScreenElement {
  return {
    id: `ocr_${x}_${y}_${w}_${h}`, label, type: 'text', source: 'ocr', confidence: conf,
    bounds: { x, y, width: w, height: h },
    center: { x: x + w / 2, y: y + h / 2 },
    isEnabled: true, isVisible: true, isFocused: false,
  }
}

function makeWin(id: string, title: string, x: number, y: number, w: number, h: number): WindowInfo {
  return {
    id, title, processName: 'test.exe',
    bounds: { x, y, width: w, height: h },
    isMinimized: false, isMaximized: false, isFocused: false, zOrder: 0,
  }
}

describe('fuseElements', () => {
  it('returns UIA elements when no OCR', () => {
    const uia = [makeUia('uia_1', '确定', 100, 100, 60, 30)]
    const result = fuseElements(uia, [], [])
    expect(result.elements).toHaveLength(1)
    expect(result.elements[0].label).toBe('确定')
    expect(result.stats.uiaOnly).toBe(1)
    expect(result.stats.ocrOnly).toBe(0)
    expect(result.stats.fused).toBe(0)
  })

  it('returns OCR elements when no UIA', () => {
    const ocr = [makeOcr('取消', 200, 200, 60, 30)]
    const result = fuseElements([], ocr, [])
    expect(result.elements).toHaveLength(1)
    expect(result.stats.ocrOnly).toBe(1)
  })

  it('fuses overlapping UIA and OCR elements', () => {
    const uia = [makeUia('uia_btn', '确定', 100, 100, 60, 30)]
    const ocr = [makeOcr('确定按钮', 102, 102, 56, 26, 0.85)]
    const result = fuseElements(uia, ocr, [])
    expect(result.stats.fused).toBe(1)
    expect(result.elements).toHaveLength(1)
    expect(result.elements[0].label).toBe('确定按钮')
    expect(result.elements[0].confidence).toBe(0.9)
  })

  it('UIA element keeps label when OCR confidence is low', () => {
    const uia = [makeUia('uia_btn', '确定', 100, 100, 60, 30)]
    const ocr = [makeOcr('确', 102, 102, 20, 26, 0.4)]
    const result = fuseElements(uia, ocr, [])
    expect(result.elements[0].label).toBe('确定')
  })

  it('assigns windowId to elements', () => {
    const win = [makeWin('win_1', '测试窗口', 0, 0, 800, 600)]
    const uia = [makeUia('uia_btn', '保存', 100, 100, 60, 30)]
    const result = fuseElements(uia, [], win)
    expect(result.elements[0].windowId).toBe('win_1')
  })

  it('keeps OCR-only elements not overlapping UIA', () => {
    const uia = [makeUia('uia_1', '确定', 100, 100, 60, 30)]
    const ocr = [
      makeOcr('确定', 102, 102, 56, 26),
      makeOcr('独立文本', 500, 500, 100, 20),
    ]
    const result = fuseElements(uia, ocr, [])
    expect(result.elements).toHaveLength(2)
    expect(result.stats.fused).toBe(1)
    expect(result.stats.ocrOnly).toBe(1)
  })
})

describe('dedupeByBounds', () => {
  it('removes near-identical elements', () => {
    const els = [
      makeUia('a', 'A', 100, 100, 50, 30),
      makeUia('b', 'B', 101, 101, 50, 30),
    ]
    const result = dedupeByBounds(els)
    expect(result).toHaveLength(1)
  })

  it('keeps distinct elements', () => {
    const els = [
      makeUia('a', 'A', 100, 100, 50, 30),
      makeUia('b', 'B', 300, 300, 50, 30),
    ]
    const result = dedupeByBounds(els)
    expect(result).toHaveLength(2)
  })
})
