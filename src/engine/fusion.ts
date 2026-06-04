import type { ScreenElement, WindowInfo } from '../utils/types.js'
import { logger } from '../utils/logger.js'

const FUSION_IOU_THRESHOLD = 0.5
const OCR_LABEL_PREFERENCE_MIN_CONF = 0.6

export interface FusionResult {
  elements: ScreenElement[]
  stats: {
    uiaOnly: number
    ocrOnly: number
    fused: number
    totalBefore: number
    totalAfter: number
  }
}

function enrichWithWindow(el: ScreenElement, windows: WindowInfo[]): ScreenElement {
  const win = findClosestWindow(el, windows)
  return win ? { ...el, windowId: win.id } : el
}

export function fuseElements(
  uiaElements: ScreenElement[],
  ocrElements: ScreenElement[],
  windows: WindowInfo[],
): FusionResult {
  const startCount = uiaElements.length + ocrElements.length
  const fused = new Map<string, ScreenElement>()
  const matchedOcr = new Set<number>()
  const typeUpgrades: string[] = []
  let fusionCount = 0

  for (const uia of uiaElements) {
    uia.confidence = uia.confidence ?? 0.85
    fused.set(uia.id, enrichWithWindow(uia, windows))
  }

  for (let i = 0; i < ocrElements.length; i++) {
    const ocr = ocrElements[i]
    ocr.confidence = ocr.confidence ?? 0.5
    const enriched = enrichWithWindow(ocr, windows)

    let bestMatch: { id: string; iou: number } | null = null

    for (const uia of uiaElements) {
      const iou = computeIoU(
        enriched.bounds.x, enriched.bounds.y,
        enriched.bounds.width, enriched.bounds.height,
        uia.bounds.x, uia.bounds.y,
        uia.bounds.width, uia.bounds.height,
      )
      if (iou > FUSION_IOU_THRESHOLD && (!bestMatch || iou > bestMatch.iou)) {
        bestMatch = { id: uia.id, iou }
      }
    }

    if (bestMatch) {
      matchedOcr.add(i)
      fusionCount++
      const existing = fused.get(bestMatch.id)
      if (existing) {
        const merged = mergeElements(existing, enriched, bestMatch.iou)
        if (merged.type !== existing.type) {
          typeUpgrades.push(`${existing.label}: ${existing.type} → ${merged.type}`)
        }
        fused.set(bestMatch.id, merged)
      }
    }
  }

  for (let i = 0; i < ocrElements.length; i++) {
    if (!matchedOcr.has(i)) {
      fused.set(ocrElements[i].id, enrichWithWindow(ocrElements[i], windows))
    }
  }

  if (typeUpgrades.length > 0) {
    logger.debug(`融合类型升级: ${typeUpgrades.join('; ')}`)
  }

  return {
    elements: Array.from(fused.values()),
    stats: {
      uiaOnly: uiaElements.length - fusionCount,
      ocrOnly: ocrElements.length - matchedOcr.size,
      fused: fusionCount,
      totalBefore: startCount,
      totalAfter: fused.size,
    },
  }
}

function mergeElements(
  uia: ScreenElement,
  ocr: ScreenElement,
  iou: number,
): ScreenElement {
  const useOcrLabel = ocr.label.length > uia.label.length && (ocr.confidence ?? 0) >= OCR_LABEL_PREFERENCE_MIN_CONF
  const label = useOcrLabel ? ocr.label : uia.label
  const uiaConf = uia.confidence ?? 0.85
  const ocrConf = ocr.confidence ?? 0.5
  const confidence = Math.max(uiaConf, ocrConf)
  const enriched: ScreenElement = {
    ...uia,
    label,
    confidence,
    value: uia.value ?? ocr.value,
    description: uia.description ?? ocr.description,
    isFocused: uia.isFocused || ocr.isFocused,
    isEnabled: uia.isEnabled && ocr.isEnabled,
    isVisible: uia.isVisible || ocr.isVisible,
  }

  if (iou > 0.75) {
    const avgX = (uia.bounds.x + ocr.bounds.x) / 2
    const avgY = (uia.bounds.y + ocr.bounds.y) / 2
    const avgW = (uia.bounds.width + ocr.bounds.width) / 2
    const avgH = (uia.bounds.height + ocr.bounds.height) / 2
    enriched.bounds = { x: Math.round(avgX), y: Math.round(avgY), width: Math.round(avgW), height: Math.round(avgH) }
    enriched.center = { x: Math.round(avgX + avgW / 2), y: Math.round(avgY + avgH / 2) }
  }

  if (uia.type === 'text' && ocr.type !== 'text') {
    enriched.type = ocr.type
  }

  return enriched
}

function computeIoU(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const xOverlap = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
  const yOverlap = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by))
  const intersection = xOverlap * yOverlap
  const union = aw * ah + bw * bh - intersection
  return union <= 0 ? 0 : intersection / union
}

function findClosestWindow(
  element: ScreenElement,
  windows: WindowInfo[],
): WindowInfo | null {
  if (element.windowId) {
    const byId = windows.find(w => w.id === element.windowId)
    if (byId) return byId
  }

  const cx = element.center.x
  const cy = element.center.y
  let best: { win: WindowInfo; overlap: number; dist: number } | null = null

  for (const win of windows) {
    if (win.isMinimized) continue
    const wb = win.bounds

    const xOverlap = Math.max(0, Math.min(element.bounds.x + element.bounds.width, wb.x + wb.width) - Math.max(element.bounds.x, wb.x))
    const yOverlap = Math.max(0, Math.min(element.bounds.y + element.bounds.height, wb.y + wb.height) - Math.max(element.bounds.y, wb.y))
    const overlap = xOverlap * yOverlap

    const elArea = element.bounds.width * element.bounds.height
    const overlapRatio = elArea > 0 ? overlap / elArea : 0

    const winCx = wb.x + wb.width / 2
    const winCy = wb.y + wb.height / 2
    const dist = Math.sqrt((cx - winCx) ** 2 + (cy - winCy) ** 2)

    const inside = cx >= wb.x && cx <= wb.x + wb.width && cy >= wb.y && cy <= wb.y + wb.height
    if (inside) return win

    if (!best || overlapRatio > best.overlap || (overlapRatio === best.overlap && dist < best.dist)) {
      best = { win, overlap: overlapRatio, dist }
    }
  }

  return best && best.overlap > 0 ? best.win : null
}

export function dedupeByBounds(elements: ScreenElement[]): ScreenElement[] {
  const kept: ScreenElement[] = []
  for (const el of elements) {
    const isDuplicate = kept.some(k => computeIoU(
      el.bounds.x, el.bounds.y, el.bounds.width, el.bounds.height,
      k.bounds.x, k.bounds.y, k.bounds.width, k.bounds.height,
    ) > 0.8)
    if (!isDuplicate) kept.push(el)
  }
  return kept
}
