import { z } from 'zod'
import { runVisionSidecar } from '../engine/vision.js'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { screenContext } from '../engine/context.js'
import { fuseElements } from '../engine/fusion.js'
import { logger } from '../utils/logger.js'
import { success, error } from '../utils/response.js'
import type { ToolHandler, WindowInfo } from '../utils/types.js'
import { mergeWindows } from '../utils/windows.js'

export const visionSchema = {
  force: z.boolean().default(false).describe('强制重新扫描（跳过缓存）'),
  findLabel: z.string().optional().describe('查找特定标签的元素'),
  includeScreenshot: z.boolean().default(false).describe('包含截图路径'),
  includeWindows: z.boolean().default(true).describe('包含窗口信息'),
}

export const visionHandler: ToolHandler = async (args) => {
  const force = args.force as boolean
  const findLabel = args.findLabel as string | undefined
  const includeScreenshot = args.includeScreenshot as boolean
  const includeWindows = args.includeWindows as boolean

  logger.info(`Vision tool (findLabel=${findLabel ?? 'all'}, force=${force})`)

  const windowResized = screenContext.hadWindowResizeSinceLastScan()
  const effectiveForce = force || windowResized
  if (windowResized) {
    logger.info('窗口变化检测到，强制重新扫描')
  }

  const vision = runVisionSidecar(effectiveForce)
  if (!vision.success) {
    return error('视觉扫描失败', { detail: vision.error })
  }

  const uia = scanUiaTree(effectiveForce)

  const uiaElements = uia.success ? uia.elements : []
  const ocrElements = vision.elements
  const allWindows: WindowInfo[] = mergeWindows(vision.windows, uia.windows)

  const { elements, stats } = fuseElements(uiaElements, ocrElements, allWindows)
  logger.info(`Fusion: ${stats.fused} merged, ${stats.uiaOnly} UIA-only, ${stats.ocrOnly} OCR-only (${stats.totalBefore}→${stats.totalAfter})`)

  screenContext.update(
    elements, allWindows,
    uia.focusedApp ?? null, null,
    vision.screenshotPath,
  )

  if (findLabel) {
    const found = elements.filter(
      e => e.label.toLowerCase().includes(findLabel.toLowerCase())
    )
    const withWindows = found.map(e => ({
      ...e,
      parentWindow: allWindows.find(w => w.id === e.windowId) ?? null,
    }))
    return success({
      success: true,
      count: found.length,
      elements: withWindows,
    })
  }

  const byType = elements.reduce<Record<string, number>>((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1
    return acc
  }, {})

  const response: Record<string, unknown> = {
    success: true,
    focus: { app: uia.focusedApp, window: uia.focusedWindow },
    elementCount: elements.length,
    elementsByType: byType,
    elements: elements.slice(0, 100).map(e => ({
      id: e.id,
      label: e.label,
      type: e.type,
      bounds: e.bounds,
      center: e.center,
      source: e.source,
      confidence: e.confidence,
      windowId: e.windowId,
    })),
  }

  if (includeScreenshot) {
    response.screenshotPath = vision.screenshotPath
  }

  if (includeWindows) {
    response.windowCount = allWindows.length
    response.windows = allWindows.map(w => ({
      id: w.id,
      title: w.title,
      processName: w.processName,
      bounds: w.bounds,
      isMinimized: w.isMinimized,
      isMaximized: w.isMaximized,
      isFocused: w.isFocused,
      elementCount: elements.filter(e => e.windowId === w.id).length,
    }))
  }

  return success(response)
}


