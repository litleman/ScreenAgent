import { describe, it, expect, beforeEach } from 'vitest'
import { ClickSmoother } from '../smoother.js'

describe('ClickSmoother', () => {
  let smoother: ClickSmoother

  beforeEach(() => {
    smoother = new ClickSmoother()
  })

  it('returns raw coordinates on first call', () => {
    const result = smoother.getSmoothedPosition('btn_1', 500, 300)
    expect(result.x).toBe(500)
    expect(result.y).toBe(300)
    expect(result.smoothed).toBe(false)
  })

  it('applies EMA smoothing after multiple calls', () => {
    smoother.getSmoothedPosition('btn_1', 500, 300)
    smoother.getSmoothedPosition('btn_1', 501, 301)
    const result = smoother.getSmoothedPosition('btn_1', 502, 302)
    expect(result.smoothed).toBe(true)
    expect(result.x).toBeGreaterThan(500)
    expect(result.x).toBeLessThan(503)
    expect(result.y).toBeGreaterThan(300)
    expect(result.y).toBeLessThan(303)
  })

  it('rejects outliers beyond threshold', () => {
    smoother.getSmoothedPosition('btn_1', 500, 300)
    smoother.getSmoothedPosition('btn_1', 501, 301)
    const result = smoother.getSmoothedPosition('btn_1', 600, 300, { x: 490, y: 290, width: 20, height: 20 })
    expect(result.smoothed).toBe(true)
    expect(result.reason).toBe('outlier')
    expect(Math.abs(result.x - 500)).toBeLessThanOrEqual(1)
  })

  it('tracks stability count', () => {
    expect(smoother.getStability('unknown')).toBe(0)
    smoother.getSmoothedPosition('btn_1', 500, 300)
    expect(smoother.getStability('btn_1')).toBe(0)
    smoother.getSmoothedPosition('btn_1', 501, 301)
    expect(smoother.getStability('btn_1')).toBe(1)
    smoother.getSmoothedPosition('btn_1', 502, 302)
    expect(smoother.getStability('btn_1')).toBe(2)
  })

  it('recordSuccessfulClick uses EMA on next call', () => {
    smoother.getSmoothedPosition('btn_1', 500, 300)
    smoother.recordSuccessfulClick('btn_1', 600, 400)
    const result = smoother.getSmoothedPosition('btn_1', 603, 403)
    expect(result.smoothed).toBe(true)
  })

  it('treats each element independently', () => {
    smoother.getSmoothedPosition('a', 100, 100)
    smoother.getSmoothedPosition('a', 101, 101)
    smoother.getSmoothedPosition('b', 900, 700)
    smoother.getSmoothedPosition('b', 901, 701)
    const a = smoother.getSmoothedPosition('a', 102, 102)
    expect(a.smoothed).toBe(true)
    const b = smoother.getSmoothedPosition('b', 902, 702)
    expect(b.smoothed).toBe(true)
    expect(a.x).not.toEqual(b.x)
  })

  it('removeElement clears tracking data', () => {
    smoother.getSmoothedPosition('btn_1', 500, 300)
    smoother.removeElement('btn_1')
    const result = smoother.getSmoothedPosition('btn_1', 500, 300)
    expect(result.smoothed).toBe(false)
    expect(result.x).toBe(500)
  })

  it('clear resets all data', () => {
    smoother.getSmoothedPosition('a', 100, 100)
    smoother.getSmoothedPosition('b', 200, 200)
    smoother.clear()
    const a = smoother.getSmoothedPosition('a', 100, 100)
    expect(a.smoothed).toBe(false)
    const b = smoother.getSmoothedPosition('b', 200, 200)
    expect(b.smoothed).toBe(false)
  })

  it('returns raw value for outlier without bounds', () => {
    smoother.getSmoothedPosition('btn_1', 500, 300)
    smoother.getSmoothedPosition('btn_1', 501, 301)
    const result = smoother.getSmoothedPosition('btn_1', 600, 300)
    expect(result.smoothed).toBe(false)
    expect(result.x).toBe(600)
  })

  it('handles single element with two stable calls correctly', () => {
    smoother.getSmoothedPosition('btn_1', 100, 100)
    smoother.getSmoothedPosition('btn_1', 101, 101)
    const result = smoother.getSmoothedPosition('btn_1', 102, 102)
    expect(result.smoothed).toBe(true)
    expect(result.reason).toBe('ema')
    expect(result.x).toBeGreaterThanOrEqual(101)
    expect(result.x).toBeLessThanOrEqual(102)
  })
})
