import { describe, it, expect } from 'vitest'
import { validateClick, validateActionSequence, verifyWindowStability } from '../precision.js'
import type { ScreenElement, WindowInfo } from '../../utils/types.js'

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

describe('validateClick', () => {
  it('有效点击返回 safe', () => {
    const el = makeEl('btn', { bounds: { x: 100, y: 100, width: 50, height: 20 }, windowId: 'w1' })
    const wins = [makeWin('w1')]
    const result = validateClick(110, 105, el, wins)
    expect(result.safe).toBe(true)
    expect(result.riskLevel).toBe('none')
    expect(result.warnings).toEqual([])
  })

  it('超出元素边界返回 high risk', () => {
    const el = makeEl('btn', { bounds: { x: 100, y: 100, width: 50, height: 20 }, windowId: 'w1' })
    const wins = [makeWin('w1')]
    const result = validateClick(999, 999, el, wins)
    expect(result.safe).toBe(false)
    expect(result.riskLevel).toBe('high')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('窗口最小化时返回 high risk', () => {
    const el = makeEl('btn', { windowId: 'w1' })
    const wins = [makeWin('w1', { isMinimized: true })]
    const result = validateClick(110, 105, el, wins)
    expect(result.riskLevel).toBe('high')
    expect(result.warnings.some(w => w.includes('最小化'))).toBe(true)
  })

  it('焦点不匹配时返回 medium risk', () => {
    const el = makeEl('btn', { windowId: 'w1' })
    const wins = [makeWin('w1'), makeWin('w2', { isFocused: true, title: 'Other' })]
    const result = validateClick(110, 105, el, wins, 'w2')
    expect(result.riskLevel).toBe('medium')
    expect(result.warnings.some(w => w.includes('焦点'))).toBe(true)
  })

  it('超出窗口边界返回 high risk', () => {
    const el = makeEl('btn', { bounds: { x: 0, y: 0, width: 10, height: 10 }, windowId: 'w1' })
    const wins = [makeWin('w1')]
    const result = validateClick(-5, -5, el, wins)
    expect(result.riskLevel).toBe('high')
  })

  it('元素无 windowId 时返回 low risk', () => {
    const el = makeEl('btn')
    const result = validateClick(110, 105, el, [])
    expect(result.riskLevel).toBe('low')
  })

  it('靠近元素边界返回边界警告', () => {
    const el = makeEl('btn', { bounds: { x: 100, y: 100, width: 50, height: 20 }, windowId: 'w1' })
    const wins = [makeWin('w1')]
    const result = validateClick(100, 100, el, wins)
    const borderWarnings = result.warnings.filter(w => w.includes('边界'))
    expect(borderWarnings.length).toBeGreaterThan(0)
  })

  it('high risk 时提供建议坐标', () => {
    const el = makeEl('btn', { bounds: { x: 100, y: 100, width: 50, height: 20 }, windowId: 'w1' })
    const wins = [makeWin('w1', { isMinimized: true })]
    const result = validateClick(110, 105, el, wins)
    expect(result.safe).toBe(false)
    expect(result.riskLevel).toBe('high')
    expect(result.suggestedX).toBe(el.center.x)
    expect(result.suggestedY).toBe(el.center.y)
  })
})

describe('validateActionSequence', () => {
  it('空动作返回空结果', () => {
    const result = validateActionSequence([], [], [])
    expect(result).toEqual([])
  })

  it('有效动作返回 safe', () => {
    const el = makeEl('btn', { windowId: 'w1' })
    const win = makeWin('w1')
    const result = validateActionSequence(
      [{ type: 'click', targetX: 110, targetY: 105, label: 'btn' }],
      [el],
      [win],
    )
    expect(result[0].safe).toBe(true)
  })

  it('无匹配元素时返回默认 safe', () => {
    const result = validateActionSequence(
      [{ type: 'click', targetX: 110, targetY: 105, label: 'nonexistent' }],
      [],
      [],
    )
    expect(result[0].safe).toBe(true)
  })
})

describe('verifyWindowStability', () => {
  it('无变化时 passed', () => {
    const wins = [makeWin('w1')]
    const result = verifyWindowStability(wins, wins)
    expect(result.passed).toBe(true)
    expect(result.details).toEqual([])
  })

  it('检测新窗口', () => {
    const before = [makeWin('w1')]
    const after = [makeWin('w1'), makeWin('w2')]
    const result = verifyWindowStability(before, after)
    expect(result.details.some(d => d.includes('新窗口'))).toBe(true)
  })

  it('检测窗口关闭', () => {
    const before = [makeWin('w1'), makeWin('w2')]
    const after = [makeWin('w1')]
    const result = verifyWindowStability(before, after)
    expect(result.details.some(d => d.includes('已关闭'))).toBe(true)
  })

  it('检测窗口最小化', () => {
    const before = [makeWin('w1', { isMinimized: false })]
    const after = [makeWin('w1', { isMinimized: true })]
    const result = verifyWindowStability(before, after)
    expect(result.details.some(d => d.includes('最小化'))).toBe(true)
  })

  it('检测窗口最大化', () => {
    const before = [makeWin('w1', { isMaximized: false })]
    const after = [makeWin('w1', { isMaximized: true })]
    const result = verifyWindowStability(before, after)
    expect(result.details.some(d => d.includes('最大化'))).toBe(true)
  })

  it('检测窗口还原', () => {
    const before = [makeWin('w1', { isMinimized: true })]
    const after = [makeWin('w1', { isMinimized: false })]
    const result = verifyWindowStability(before, after)
    expect(result.details.some(d => d.includes('还原'))).toBe(true)
  })
})
