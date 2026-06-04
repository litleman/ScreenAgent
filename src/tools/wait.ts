import { z } from 'zod'
import { runVisionSidecar } from '../engine/vision.js'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { screenContext } from '../engine/context.js'
import { findElementByLabel } from '../guard/perception.js'
import { verifyWindowStability } from '../guard/precision.js'
import { config } from '../utils/config.js'
import { pollUntil } from '../utils/poll.js'
import { success, error } from '../utils/response.js'
import { logger } from '../utils/logger.js'
import type { ToolHandler, ScreenElement, WindowInfo } from '../utils/types.js'

export const waitForElementSchema = {
  label: z.string().describe('要等待的元素标签'),
  timeout: z.number().default(config.defaultTimeout).describe('超时毫秒数'),
  interval: z.number().default(config.pollInterval).describe('轮询间隔毫秒数'),
  windowTitle: z.string().optional().describe('限定在指定窗口中查找'),
}

export const waitForStableSchema = {
  timeout: z.number().default(10000).describe('超时毫秒数'),
  interval: z.number().default(config.pollInterval).describe('轮询间隔毫秒数'),
  maxStablePolls: z.number().default(3).describe('连续稳定次数'),
  requireWindowStable: z.boolean().default(false).describe('同时要求窗口状态稳定'),
}

async function scanForElement(
  label: string,
  windowTitle?: string,
): Promise<ScreenElement | null> {
  const vision = runVisionSidecar(true)
  const uia = scanUiaTree()
  const allElements = [...vision.elements, ...(uia.success ? uia.elements : [])]
  const allWindows = vision.windows ?? uia.windows ?? []

  screenContext.update(
    allElements, allWindows,
    uia.focusedApp, null,
    vision.screenshotPath,
  )

  let candidates = allElements
  if (windowTitle) {
    const win = allWindows.find(
      w => w.title.toLowerCase().includes(windowTitle.toLowerCase())
    )
    if (win) {
      candidates = allElements.filter(e => e.windowId === win.id)
      logger.debug(`限定在窗口 "${win.title}" 中查找元素`)
    }
  }

  const found = findElementByLabel(candidates, label)
  return found.element
}

export const waitForElementHandler: ToolHandler = async (args) => {
  const label = args.label as string
  const timeout = args.timeout as number
  const interval = args.interval as number
  const windowTitle = args.windowTitle as string | undefined

  logger.info(`等待元素 "${label}"${windowTitle ? ` (窗口: ${windowTitle})` : ''} (timeout=${timeout}ms)`)

  const { found, value, elapsed } = await pollUntil(
    () => scanForElement(label, windowTitle),
    timeout,
    interval,
  )

  if (found) {
    const win = value?.windowId
      ? screenContext.state?.windows.find(w => w.id === value.windowId)
      : null

    logger.info(`元素 "${label}" 已出现 (${elapsed}ms)`)
    return success({
      success: true,
      found: true,
      element: value,
      parentWindow: win ? { title: win.title, bounds: win.bounds } : null,
      elapsed: `${elapsed}ms`,
    })
  }

  return error(`超时(${timeout}ms) — 未找到 "${label}"`, { elapsed: `${elapsed}ms` })
}

export const waitForStableHandler: ToolHandler = async (args) => {
  const timeout = args.timeout as number
  const interval = args.interval as number
  const maxStablePolls = args.maxStablePolls as number
  const requireWindowStable = args.requireWindowStable as boolean

  const start = Date.now()
  let stableCount = 0
  let previousHash = ''
  let previousWindows: WindowInfo[] = []

  logger.info(`等待屏幕稳定 (timeout=${timeout}ms, maxStablePolls=${maxStablePolls})`)

  while (Date.now() - start < timeout) {
    const vision = runVisionSidecar(true)
    const currentHash = JSON.stringify(
      vision.elements.map(e => `${e.label}:${e.bounds.x},${e.bounds.y}`)
    )

    let hashStable = currentHash === previousHash
    let windowsStable = true

    if (requireWindowStable && previousWindows.length > 0 && vision.windows) {
      const stability = verifyWindowStability(previousWindows, vision.windows)
      windowsStable = stability.details.length === 0
    }

    if (hashStable && windowsStable) {
      stableCount++
      if (stableCount >= maxStablePolls) {
        const windows = vision.windows ?? []
        screenContext.update(
          vision.elements, windows,
          null, null, vision.screenshotPath,
        )

        logger.info(`屏幕已稳定 (${Date.now() - start}ms, ${stableCount} polls)`)
        return success({
          success: true,
          stable: true,
          elapsed: `${Date.now() - start}ms`,
          elementCount: vision.elements.length,
          windowCount: windows.length,
        })
      }
    } else {
      stableCount = 0
    }

    previousHash = currentHash
    if (vision.windows) previousWindows = vision.windows
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  return error(`超时(${timeout}ms) — 屏幕未稳定`, { elapsed: `${Date.now() - start}ms` })
}
