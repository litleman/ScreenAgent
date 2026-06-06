import { z } from 'zod'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { runVisionSidecar } from '../engine/vision.js'
import { screenContext } from '../engine/context.js'
import { fuseElements } from '../engine/fusion.js'
import { scoreElements } from '../utils/scoring.js'
import { computeStateHash } from '../utils/hash.js'
import { logger } from '../utils/logger.js'
import { success } from '../utils/response.js'
import type { ScreenElement, ToolHandler, WindowInfo } from '../utils/types.js'

export const discoverSchema = {
  force: z.boolean().default(false).describe('强制重新扫描（跳过缓存）'),
  forceFresh: z.boolean().default(false).describe('强制获取最新数据（清除 UIA 缓存后重新扫描）'),
  includeOcr: z.boolean().default(true).describe('同时运行 OCR 检测文本元素'),
  includeUia: z.boolean().default(true).describe('同时运行 UIA 可访问性扫描'),
  includeWindows: z.boolean().default(true).describe('同时扫描窗口信息'),
  minimal: z.boolean().default(false).describe('仅返回 Top-20 高关联元素'),
  compact: z.boolean().default(false).describe('使用紧凑 JSON 格式（字段缩写）'),
}

const lastStateHash = { value: '' }

export const discoverHandler: ToolHandler = async (args) => {
  const force = args.force as boolean
  const forceFresh = args.forceFresh as boolean
  const includeOcr = args.includeOcr as boolean
  const includeUia = args.includeUia as boolean
  const includeWindows = args.includeWindows as boolean
  const minimal = args.minimal as boolean
  const compact = args.compact as boolean

  logger.info(`Discovering screen (ocr=${includeOcr}, uia=${includeUia}, windows=${includeWindows}, force=${force}, forceFresh=${forceFresh})`)

  const windowResized = screenContext.hadWindowResizeSinceLastScan()
  const effectiveForce = force || forceFresh || windowResized
  if (effectiveForce) {
    logger.info(`Forcing fresh scan (force=${force}, forceFresh=${forceFresh}, windowResized=${windowResized})`)
  }

  let uiaElements: ScreenElement[] = []
  let ocrElements: ScreenElement[] = []
  let focusedApp: string | null = null
  let focusedWindow: string | null = null
  let allWindows: WindowInfo[] = []

  if (includeUia) {
    const uia = scanUiaTree(effectiveForce)
    if (uia.success) {
      focusedApp = uia.focusedApp
      focusedWindow = uia.focusedWindow
      if (includeWindows && uia.windows) {
        allWindows = mergeWindows(allWindows, uia.windows)
      }
      uiaElements = uia.elements
      logger.info(`UIA: ${uia.elements.length} elements, app=${uia.focusedApp}`)
    }
  }

  if (includeOcr) {
    const vision = runVisionSidecar(effectiveForce)
    if (vision.success) {
      if (includeWindows && vision.windows) {
        allWindows = mergeWindows(allWindows, vision.windows)
      }
      ocrElements = vision.elements
      logger.info(`OCR: ${vision.elements.length} elements`)
    }
  }

  const { elements, stats } = fuseElements(uiaElements, ocrElements, allWindows)
  logger.info(`Fusion: ${stats.fused} merged, ${stats.uiaOnly} UIA-only, ${stats.ocrOnly} OCR-only (${stats.totalBefore}→${stats.totalAfter})`)

  screenContext.update(
    elements, allWindows,
    focusedApp, focusedWindow,
    null,
  )

  const stateHash = computeStateHash(allWindows, elements.length)
  if (!force && !forceFresh && stateHash === lastStateHash.value) {
    logger.info('State unchanged since last scan, returning minimal response')
    return success({
      success: true,
      focus: { app: focusedApp, window: focusedWindow },
      unchanged: true,
      elementCount: elements.length,
      windowCount: allWindows.length,
    }, false, compact)
  }
  lastStateHash.value = stateHash

  const scored = minimal ? scoreElements(elements, allWindows) : undefined
  const finalElements = minimal && scored ? scored.slice(0, 20) : elements

  const elementByType = finalElements.reduce<Record<string, number>>((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1
    return acc
  }, {})

  const windowsInfo = includeWindows
    ? allWindows.map(w => ({
        ...w,
        elementCount: finalElements.filter(e => e.windowId === w.id).length,
      }))
    : undefined

  return success({
    success: true,
    focus: { app: focusedApp, window: focusedWindow },
    elementCount: elements.length,
    elementsByType: elementByType,
    windowCount: allWindows.length,
    windows: windowsInfo,
    elements: finalElements.slice(0, finalElements === elements ? 200 : 20),
  }, false, compact)
}

function mergeWindows(
  existing: WindowInfo[],
  incoming: WindowInfo[],
): WindowInfo[] {
  const map = new Map(existing.map(w => [w.id, w]))
  for (const w of incoming) {
    if (!map.has(w.id)) map.set(w.id, w)
  }
  return Array.from(map.values())
}
