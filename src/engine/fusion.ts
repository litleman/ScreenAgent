import type { ScreenElement, WindowInfo } from '../utils/types.js'
import { logger } from '../utils/logger.js'

const FUSION_THRESHOLD = 0.6
const TEXT_MATCH_IOU_FLOOR = 0.05
const OCR_LABEL_PREFERENCE_MIN_CONF = 0.6

const W_IOU = 0.4
const W_TEXT = 0.3
const W_TYPE = 0.2
const W_SIZE = 0.1

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

    let bestMatch: { id: string; score: number } | null = null

    for (const uia of uiaElements) {
      const score = multiFactorSimilarity(enriched, uia)
      if (score >= FUSION_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: uia.id, score }
      }
    }

    if (!bestMatch) {
      for (const uia of uiaElements) {
        const textScore = matchByText(enriched, uia)
        if (textScore > 0 && (!bestMatch || textScore > bestMatch.score)) {
          bestMatch = { id: uia.id, score: textScore }
        }
      }
    }

    if (bestMatch) {
      matchedOcr.add(i)
      fusionCount++
      const existing = fused.get(bestMatch.id)
      if (existing) {
        const merged = mergeElements(existing, enriched, bestMatch.score)
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

function multiFactorSimilarity(ocr: ScreenElement, uia: ScreenElement): number {
  const iouScore = computeIoU(
    ocr.bounds.x, ocr.bounds.y, ocr.bounds.width, ocr.bounds.height,
    uia.bounds.x, uia.bounds.y, uia.bounds.width, uia.bounds.height,
  )
  if (iouScore <= 0) return 0

  const textScore = levenshteinSimilarity(ocr.label, uia.label)
  const typeScore = ocr.type === uia.type ? 1 : (
    (ocr.type === 'text' || uia.type === 'text') ? 0.3 : 0
  )
  const sizeScore = computeSizeRatio(
    ocr.bounds.width, ocr.bounds.height,
    uia.bounds.width, uia.bounds.height,
  )

  return W_IOU * iouScore + W_TEXT * textScore + W_TYPE * typeScore + W_SIZE * sizeScore
}

function computeSizeRatio(w1: number, h1: number, w2: number, h2: number): number {
  if (w1 <= 0 || h1 <= 0 || w2 <= 0 || h2 <= 0) return 0
  const a1 = w1 * h1
  const a2 = w2 * h2
  const ratio = a1 < a2 ? a1 / a2 : a2 / a1
  return ratio
}

function levenshteinSimilarity(a: string, b: string): number {
  const al = a.toLowerCase().trim()
  const bl = b.toLowerCase().trim()
  if (al === bl) return 1
  if (!al || !bl) return 0
  if (al.includes(bl) || bl.includes(al)) return 0.8 + Math.min(al.length, bl.length) / Math.max(al.length, bl.length) * 0.2

  const n = al.length
  const m = bl.length
  const maxLen = Math.max(n, m)
  if (maxLen === 0) return 1

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (al[i - 1] === bl[j - 1] ? 0 : 1),
      )
    }
  }
  return 1 - dp[n][m] / maxLen
}

function mergeElements(
  uia: ScreenElement,
  ocr: ScreenElement,
  fusionScore: number,
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

  if (fusionScore > 0.75) {
    const avgX = (uia.bounds.x + ocr.bounds.x) / 2
    const avgY = (uia.bounds.y + ocr.bounds.y) / 2
    const avgW = (uia.bounds.width + ocr.bounds.width) / 2
    const avgH = (uia.bounds.height + ocr.bounds.height) / 2
    enriched.bounds = { x: Math.round(avgX), y: Math.round(avgY), width: Math.round(avgW), height: Math.round(avgH) }
    enriched.center = { x: Math.round(avgX + avgW / 2), y: Math.round(avgY + avgH / 2) }
  }

  if ((uia.type === 'text' || uia.type === 'text_block') && ocr.type !== 'text' && ocr.type !== 'text_block') {
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

function matchByText(ocr: ScreenElement, uia: ScreenElement): number {
  const iou = computeIoU(
    ocr.bounds.x, ocr.bounds.y, ocr.bounds.width, ocr.bounds.height,
    uia.bounds.x, uia.bounds.y, uia.bounds.width, uia.bounds.height,
  )
  if (iou < TEXT_MATCH_IOU_FLOOR) return 0

  const lev = levenshteinSimilarity(ocr.label, uia.label)
  if (lev >= 0.35) return 0.5 + lev * 0.3

  if (uia.type === 'text' || uia.type === 'text_block') {
    if (ocr.type !== 'text' && ocr.type !== 'text_block') {
      const shortLev = levenshteinSimilarity(ocr.label.slice(0, 20), uia.label.slice(0, 20))
      if (shortLev >= 0.2) return 0.4 + shortLev * 0.2
    }
  }

  return 0
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
