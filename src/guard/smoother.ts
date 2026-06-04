import type { Bounds } from '../utils/types.js'
import { logger } from '../utils/logger.js'

const MAX_TRACKED_ELEMENTS = 100
const SMOOTHING_ALPHA = 0.6
const OUTLIER_THRESHOLD = 50
const MAX_HISTORY_PER_ELEMENT = 10
const POSITION_STABILITY_THRESHOLD = 15

interface PositionHistory {
  x: number
  y: number
  timestamp: number
}

interface ElementPositionData {
  emaX: number
  emaY: number
  history: PositionHistory[]
  stableCount: number
}

export class ClickSmoother {
  private elementPositions = new Map<string, ElementPositionData>()
  private cleanupCounter = 0

  private ensureElementData(id: string, x: number, y: number): ElementPositionData {
    let data = this.elementPositions.get(id)
    if (!data) {
      data = { emaX: x, emaY: y, history: [], stableCount: 0 }
      this.elementPositions.set(id, data)
    }
    return data
  }

  getSmoothedPosition(
    elementId: string,
    rawX: number,
    rawY: number,
    bounds?: Bounds,
  ): { x: number; y: number; smoothed: boolean; reason?: string } {
    const data = this.ensureElementData(elementId, rawX, rawY)

    data.history.push({ x: rawX, y: rawY, timestamp: Date.now() })
    if (data.history.length > MAX_HISTORY_PER_ELEMENT) {
      data.history.shift()
    }

    if (data.history.length < 2) {
      data.emaX = rawX
      data.emaY = rawY
      return { x: rawX, y: rawY, smoothed: false }
    }

    const dist = Math.sqrt((rawX - data.emaX) ** 2 + (rawY - data.emaY) ** 2)

    if (dist > OUTLIER_THRESHOLD && bounds) {
      const cx = bounds.x + bounds.width / 2
      const cy = bounds.y + bounds.height / 2
      const centerDist = Math.sqrt((rawX - cx) ** 2 + (rawY - cy) ** 2)
      const emaCenterDist = Math.sqrt((data.emaX - cx) ** 2 + (data.emaY - cy) ** 2)

      if (centerDist > emaCenterDist * 2 && centerDist > POSITION_STABILITY_THRESHOLD) {
        logger.warn(`点击坐标离群抑制: (${rawX}, ${rawY}) vs EMA (${data.emaX.toFixed(0)}, ${data.emaY.toFixed(0)}), 使用 EMA`)
        return { x: Math.round(data.emaX), y: Math.round(data.emaY), smoothed: true, reason: 'outlier' }
      }
    }

    const newEmaX = SMOOTHING_ALPHA * rawX + (1 - SMOOTHING_ALPHA) * data.emaX
    const newEmaY = SMOOTHING_ALPHA * rawY + (1 - SMOOTHING_ALPHA) * data.emaY
    data.emaX = newEmaX
    data.emaY = newEmaY

    if (dist < POSITION_STABILITY_THRESHOLD) {
      data.stableCount++
    } else {
      data.stableCount = 0
    }

    const smoothedX = Math.round(data.stableCount >= 2 ? newEmaX : rawX)
    const smoothedY = Math.round(data.stableCount >= 2 ? newEmaY : rawY)
    const wasSmoothed = smoothedX !== rawX || smoothedY !== rawY

    this.cleanupCounter++
    if (this.cleanupCounter >= 10) {
      this.cleanup()
      this.cleanupCounter = 0
    }

    return { x: smoothedX, y: smoothedY, smoothed: wasSmoothed, reason: wasSmoothed ? 'ema' : undefined }
  }

  recordSuccessfulClick(elementId: string, x: number, y: number): void {
    const data = this.ensureElementData(elementId, x, y)
    data.emaX = x
    data.emaY = y
    data.stableCount = Math.min(data.stableCount + 2, 10)
  }

  getStability(elementId: string): number {
    const data = this.elementPositions.get(elementId)
    return data ? data.stableCount : 0
  }

  clear(): void {
    this.elementPositions.clear()
  }

  private cleanup(): void {
    if (this.elementPositions.size <= MAX_TRACKED_ELEMENTS) return
    const entries = Array.from(this.elementPositions.entries())
    entries.sort((a, b) => b[1].stableCount - a[1].stableCount)
    this.elementPositions = new Map(entries.slice(0, MAX_TRACKED_ELEMENTS))
  }

  removeElement(elementId: string): void {
    this.elementPositions.delete(elementId)
  }
}

export const clickSmoother = new ClickSmoother()
