import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validatePosition, resetInputStats, getInputStats } from '../input.js'
import type { InputAction } from '../input.js'

describe('validatePosition', () => {
  function makeAction(overrides: Partial<InputAction> = {}): InputAction {
    return { action: 'click', x: 100, y: 200, ...overrides }
  }

  it('validates normal coordinates', () => {
    const result = validatePosition(makeAction({ x: 500, y: 300 }))
    expect(result.success).toBe(true)
    expect(result.x).toBe(500)
    expect(result.y).toBe(300)
    expect(result.withinSafeBounds).toBe(true)
    expect(result.adjusted).toBe(false)
  })

  it('rejects NaN coordinates', () => {
    const result = validatePosition(makeAction({ x: NaN, y: 200 }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('NaN')
  })

  it('rejects negative coordinates', () => {
    const result = validatePosition(makeAction({ x: -1, y: 200 }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('负值')
  })

  it('rejects out-of-range coordinates', () => {
    const result = validatePosition(makeAction({ x: 100000, y: 200 }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('超出合理范围')
  })

  it('rejects undefined coordinates', () => {
    const result = validatePosition(makeAction({ x: undefined, y: undefined }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('需要坐标')
  })

  it('clamps to safeBounds when outside', () => {
    const result = validatePosition(makeAction({
      x: 999, y: 999,
      safeBounds: { x: 0, y: 0, width: 100, height: 100 },
    }))
    expect(result.success).toBe(true)
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
    expect(result.withinSafeBounds).toBe(false)
    expect(result.adjusted).toBe(true)
  })

  it('allows coordinates within safeBounds', () => {
    const result = validatePosition(makeAction({
      x: 50, y: 50,
      safeBounds: { x: 0, y: 0, width: 100, height: 100 },
    }))
    expect(result.success).toBe(true)
    expect(result.x).toBe(50)
    expect(result.y).toBe(50)
    expect(result.withinSafeBounds).toBe(true)
    expect(result.adjusted).toBe(false)
  })

  it('allows coordinates on safeBounds boundary', () => {
    const result = validatePosition(makeAction({
      x: 100, y: 100,
      safeBounds: { x: 0, y: 0, width: 100, height: 100 },
    }))
    expect(result.success).toBe(true)
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
  })

  it('handles zero-zero coordinates', () => {
    const result = validatePosition(makeAction({ x: 0, y: 0 }))
    expect(result.success).toBe(true)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })
})

describe('InputStats', () => {
  beforeEach(() => resetInputStats())

  it('starts at zero', () => {
    const stats = getInputStats()
    expect(stats.totalCalls).toBe(0)
    expect(stats.totalFailures).toBe(0)
  })

  it('returns a copy, not a reference', () => {
    const s1 = getInputStats()
    s1.totalCalls = 99
    const s2 = getInputStats()
    expect(s2.totalCalls).toBe(0)
  })
})
