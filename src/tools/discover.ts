import { z } from 'zod'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { runVisionSidecar } from '../engine/vision.js'
import { screenContext } from '../engine/context.js'
import { fuseElements } from '../engine/fusion.js'
import { logger } from '../utils/logger.js'
import { success } from '../utils/response.js'
import type { ScreenElement, ToolHandler, WindowInfo } from '../utils/types.js'

export const discoverSchema = {
  force: z.boolean().default(false).describe('强制重新扫描（跳过缓存）'),
  includeOcr: z.boolean().default(true).describe('同时运行 OCR 检测文本元素'),
  includeUia: z.boolean().default(true).describe('同时运行 UIA 可访问性扫描'),
  includeWindows: z.boolean().default(true).describe('同时扫描窗口信息'),
}

export const discoverHandler: ToolHandler = async (args) => {
  const force = args.force as boolean
  const includeOcr = args.includeOcr as boolean
  const includeUia = args.includeUia as boolean
  const includeWindows = args.includeWindows as boolean

  logger.info(`Discovering screen (ocr=${includeOcr}, uia=${includeUia}, windows=${includeWindows}, force=${force})`)

  const windowResized = screenContext.hadWindowResizeSinceLastScan()
  const effectiveForce = force || windowResized
  if (windowResized) {
    logger.info('窗口变化检测到，强制重新扫描')
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

  const elementByType = elements.reduce<Record<string, number>>((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1
    return acc
  }, {})

  const windowsInfo = includeWindows
    ? allWindows.map(w => ({
        ...w,
        elementCount: elements.filter(e => e.windowId === w.id).length,
      }))
    : undefined

  return success({
    success: true,
    focus: { app: focusedApp, window: focusedWindow },
    elementCount: elements.length,
    elementsByType: elementByType,
    windowCount: allWindows.length,
    windows: windowsInfo,
    elements: elements.slice(0, 200),
  })
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
