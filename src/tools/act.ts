import { z } from 'zod'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { runVisionSidecar } from '../engine/vision.js'
import { executeInput, type InputAction } from '../engine/input.js'
import { screenContext } from '../engine/context.js'
import { fuseElements } from '../engine/fusion.js'
import { findElementByLabel, canInteract, findWindowByElement } from '../guard/perception.js'
import { validateClick, verifyWindowStability } from '../guard/precision.js'
import { verifyClickOutcome, analyzeInteractionRisk } from '../guard/verify.js'
import { clickSmoother } from '../guard/smoother.js'
import { invokeElement } from '../engine/invoke.js'
import { isInvokeRecommended, determineMenuStrategy, logMenuStrategy } from '../utils/menu-strategy.js'
import { success, error } from '../utils/response.js'
import { logger } from '../utils/logger.js'
import type { ToolHandler, ScreenElement, WindowInfo, DialogInfo } from '../utils/types.js'

export const actSchema = {
  action: z.enum(['click', 'doubleClick', 'rightClick', 'type', 'keyPress', 'hover', 'scroll'])
    .describe('要执行的操作类型'),
  label: z.string().optional().describe('目标元素的标签文本（click/doubleClick/rightClick/hover 必填）'),
  text: z.string().optional().describe('要输入的文本（type 必填）'),
  key: z.string().optional().describe('要按下的键名（keyPress 必填，如 Enter/Tab/Escape）'),
  x: z.number().optional().describe('绝对坐标 X（不指定 label 时使用）'),
  y: z.number().optional().describe('绝对坐标 Y（不指定 label 时使用）'),
  verify: z.boolean().default(true).describe('操作后自动验证'),
  waitForStable: z.number().default(1000).describe('操作后等待稳定的毫秒数'),
  windowTitle: z.string().optional().describe('限定在指定窗口中查找元素'),
  precise: z.boolean().default(true).describe('启用精准模式（坐标校验+边界检测）'),
  maxRetries: z.number().default(2).describe('验证失败时最大重试次数'),
  retryDelay: z.number().default(500).describe('重试间隔毫秒数'),
  backend: z.enum(['auto', 'sendinput', 'pyautogui']).default('auto').describe('输入后端：sendinput(Win32硬件级)、pyautogui(跨平台)、auto(自动降级)'),
  movementStyle: z.enum(['bezier', 'direct', 'human']).default('bezier').describe('鼠标移动风格：bezier贝塞尔曲线、direct直线、human类人'),
  moveSpeed: z.enum(['slow', 'medium', 'fast', 'instant']).default('medium').describe('鼠标移动速度'),
  verifyClick: z.boolean().default(true).describe('点击后截图验证是否生效'),
  autoMenuStrategy: z.boolean().default(true).describe('菜单项自动切换 InvokePattern'),
  autoDismiss: z.boolean().default(true).describe('操作前自动检测并关闭阻挡弹窗'),
}

export const actHandler: ToolHandler = async (args) => {
  const action = args.action as string
  const label = args.label as string | undefined
  const text = args.text as string | undefined
  const key = args.key as string | undefined
  let targetX = args.x as number | undefined
  let targetY = args.y as number | undefined
  const shouldVerify = args.verify as boolean
  const waitForStable = args.waitForStable as number
  const windowTitle = args.windowTitle as string | undefined
  const precise = args.precise as boolean
  const maxRetries = args.maxRetries as number
  const retryDelay = args.retryDelay as number
  const backend = args.backend as string
  const movementStyle = args.movementStyle as string
  const moveSpeed = args.moveSpeed as string
  const verifyClick = args.verifyClick as boolean
  const autoMenuStrategy = args.autoMenuStrategy as boolean
  const autoDismiss = args.autoDismiss as boolean

  const startTime = performance.now()
  let targetElement: ScreenElement | null = null
  let parentWindow: WindowInfo | null = null
  const retries: Array<{ attempt: number; x: number; y: number; reason?: string }> = []

  if (!label && (targetX === undefined || targetY === undefined)) {
    return error('需要指定 label 或坐标 (x, y)')
  }

  if (label) {
    const scanResult = await locateElement(label, windowTitle)
    if (!scanResult.element) {
      return error(scanResult.error ?? `未找到元素 "${label}"`)
    }

    targetElement = scanResult.element
    parentWindow = scanResult.window
    targetX = targetElement.center.x
    targetY = targetElement.center.y

    const smoothed = clickSmoother.getSmoothedPosition(
      targetElement.id, targetX, targetY, targetElement.bounds,
    )
    if (smoothed.smoothed) {
      logger.info(`坐标平滑: (${targetX}, ${targetY}) → (${smoothed.x}, ${smoothed.y}) (${smoothed.reason})`)
      targetX = smoothed.x
      targetY = smoothed.y
    }

    const interactWarnings = canInteract(targetElement)
    if (interactWarnings.length > 0) {
      logger.warn(`元素 "${label}" 交互警告: ${interactWarnings.join(', ')}`)
    }

    const risk = analyzeInteractionRisk(targetElement, action)
    if (risk.risk === 'high' && !args.force) {
      return error(`高风险操作已阻止: ${risk.reason}。如需强制执行请添加 force=true 参数`)
    }
    if (risk.risk === 'medium') {
      logger.warn(`中等风险操作: ${risk.reason}`)
    }

    if (autoMenuStrategy && isInvokeRecommended(targetElement)) {
      const strategy = determineMenuStrategy(targetElement)
      logMenuStrategy(targetElement, strategy)
      const invokeResult = invokeElement(targetElement.label)

      if (invokeResult.success) {
        const duration = performance.now() - startTime
        return success({
          success: true,
          action,
          target: label,
          method: invokeResult.method ?? 'InvokePattern',
          duration: `${duration.toFixed(0)}ms`,
          elementBounds: targetElement.bounds,
          source: targetElement.source,
          confidence: targetElement.confidence,
        })
      }
      logger.warn(`InvokePattern 失败 (${invokeResult.error})，降级到鼠标点击`)
    }
  }

  if (autoDismiss) {
    const targetWindowId = targetElement?.windowId ?? parentWindow?.id ?? screenContext.state?.focusedWindowId
    if (targetWindowId) {
      const dismissed = await dismissBlockingDialogs(targetWindowId)
      if (dismissed > 0) {
        logger.info(`已自动关闭 ${dismissed} 个阻挡弹窗`)
      }
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryDelay * attempt
      logger.info(`重试 #${attempt}/${maxRetries}，等待 ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }

    const windows = screenContext.state?.windows ?? []

    if (attempt === 0 && precise && targetX !== undefined && targetY !== undefined && targetElement) {
      const validation = validateClick(
        targetX, targetY, targetElement, windows,
        screenContext.state?.focusedWindowId,
      )

      if (!validation.safe) {
        const fallbackX = validation.suggestedX ?? targetElement.center.x
        const fallbackY = validation.suggestedY ?? targetElement.center.y
        logger.warn(`坐标校验不通过 (risk=${validation.riskLevel})，使用元素中心点代替: (${fallbackX}, ${fallbackY})`)
        targetX = fallbackX
        targetY = fallbackY
        validation.warnings.forEach(w => logger.warn(`[精度] ${w}`))
      } else if (validation.riskLevel !== 'none') {
        validation.warnings.forEach(w => logger.debug(`[精度提示] ${w}`))
      }
    }

    if (attempt > 0 && targetElement) {
      const jitter = attempt * 2
      targetX = targetElement.center.x + Math.round((Math.random() - 0.5) * jitter)
      targetY = targetElement.center.y + Math.round((Math.random() - 0.5) * jitter)
      logger.info(`重试 #${attempt}: 微调点击坐标至 (${targetX}, ${targetY})`)
    }

    const beforeWindows = [...windows]
    const inputAction: InputAction = {
      action: action as InputAction['action'],
      x: targetX,
      y: targetY,
      text,
      key,
      safeBounds: targetElement?.bounds,
      backend: backend as InputAction['backend'],
      verifyClick,
      movementProfile: {
        style: movementStyle as 'bezier' | 'direct' | 'human',
        speed: moveSpeed as 'slow' | 'medium' | 'fast' | 'instant',
      },
    }

    logger.info(`执行 ${action}${label ? ` "${label}"` : ''} 于 (${targetX}, ${targetY})${attempt > 0 ? ` [重试 ${attempt}/${maxRetries}]` : ''} [${backend}/${movementStyle}/${moveSpeed}]`)

    const inputResult = executeInput(inputAction)

    if (!inputResult.success) {
      if (attempt < maxRetries) {
        logger.warn(`操作执行失败，将重试: ${inputResult.error}`)
        continue
      }
      return error(`操作 ${action} 执行失败: ${inputResult.error ?? '未知错误'}`, {
        target: label ?? { x: targetX, y: targetY },
        retries,
      })
    }

    await new Promise(resolve => setTimeout(resolve, waitForStable + attempt * 200))

    if (shouldVerify && label && targetElement) {
      const verification = await verifyClickOutcome(label)
      const windowChanges = parentWindow
        ? verifyWindowStability(beforeWindows, screenContext.state?.windows ?? [])
        : null

      const elementGone = !verification.actualLabel && verification.confidence > 0.5
      const hasWindowChange = windowChanges && windowChanges.details.length > 0
      const verifyPassed = verification.passed || elementGone || !!hasWindowChange

      if (attempt > 0) {
        retries.push({ attempt, x: targetX!, y: targetY!, reason: verification.mismatch })
      }

      if (verifyPassed || attempt >= maxRetries) {
        if (verifyPassed && targetElement) {
          clickSmoother.recordSuccessfulClick(targetElement.id, targetX!, targetY!)
        }

        const duration = performance.now() - startTime
        const resp: Record<string, unknown> = {
          success: verifyPassed,
          action,
          target: label ?? { x: targetX, y: targetY },
          duration: `${duration.toFixed(0)}ms`,
          adjusted: inputResult.adjusted ?? false,
          clickPosition: { x: targetX, y: targetY },
          attempts: attempt + 1,
          retries: retries.length > 0 ? retries : undefined,
          backend: inputResult.backend ?? 'unknown',
        }

        if (targetElement) {
          resp.elementBounds = targetElement.bounds
          resp.source = targetElement.source
          resp.confidence = targetElement.confidence
        }

        if (inputResult.calibrated) {
          resp.coordinateCalibration = inputResult.calibrated
        }

        if (inputResult.verification) {
          resp.clickVerification = inputResult.verification
        }

        if (parentWindow) {
          resp.windowInfo = {
            title: parentWindow.title,
            processName: parentWindow.processName,
            bounds: parentWindow.bounds,
          }
        }

        resp.verification = {
          passed: verifyPassed,
          level: verification.level,
          confidence: verification.confidence,
          details: verification.details.slice(0, 5),
        }

        if (windowChanges && windowChanges.details.length > 0) {
          resp.windowChanges = windowChanges.details
        }

        return success(resp)
      }

      logger.info(`验证未通过 (attempt=${attempt}/${maxRetries})，${attempt < maxRetries ? '准备重试' : '已达到最大重试次数'}`)
    } else {
      const duration = performance.now() - startTime
      return success({
        success: true,
        action,
        target: label ?? { x: targetX, y: targetY },
        duration: `${duration.toFixed(0)}ms`,
        adjusted: inputResult.adjusted ?? false,
        clickPosition: { x: targetX, y: targetY },
        verification: shouldVerify ? '跳过（无标签）' : '跳过',
      })
    }
  }

  return error(`操作 ${action} 在 ${maxRetries + 1} 次尝试后仍未通过验证`, {
    target: label ?? { x: targetX, y: targetY },
    retries,
  })
}

async function locateElement(
  label: string,
  windowTitle?: string,
): Promise<{
  element: ScreenElement | null
  window: WindowInfo | null
  error?: string
}> {
  const contextFound = screenContext.findElement(label, true, windowTitle)
  if (contextFound.element) {
    return { element: contextFound.element, window: contextFound.window }
  }

  const vision = runVisionSidecar(true)
  if (!vision.success) {
    return { element: null, window: null, error: `视觉扫描失败: ${vision.error}` }
  }

  const uia = scanUiaTree(true)
  const uiaElements = uia.success ? uia.elements : []
  const allWindows = vision.windows ?? uia.windows ?? []
  const { elements: allElements } = fuseElements(uiaElements, vision.elements, allWindows)

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
    }
  }

  const found = findElementByLabel(candidates, label)
  if (!found.element) {
    return { element: null, window: null, error: `未找到元素 "${label}"` }
  }

  const matched = findWindowByElement(found.element, allWindows).window
  const fullWindow = matched ? allWindows.find(w => w.id === matched.id) ?? null : null
  return { element: found.element, window: fullWindow }
}

const DISMISS_BUTTON_PRIORITY = [
  '关闭', 'Close', '×',
  '确定', 'OK', 'Confirm', '确认',
  '取消', 'Cancel',
  '否', 'No', 'Don\'t Save', '不保存',
  '应用', 'Apply',
]

async function dismissBlockingDialogs(windowId: string): Promise<number> {
  const uia = scanUiaTree(true)
  if (!uia.success || !uia.windows || !uia.dialogWindows) return 0

  const dialogs = (uia.dialogWindows as DialogInfo[]).filter(d => {
    if (d.blocksWindowId === windowId) return true
    const dialogWin = uia.windows!.find(w => w.id === d.id)
    const targetWin = uia.windows!.find(w => w.id === windowId)
    if (!dialogWin || !targetWin) return false
    const a = dialogWin.bounds, b = targetWin.bounds
    return a.x < b.x + b.width && a.x + a.width > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y
  })

  if (dialogs.length === 0) return 0

  const allElements = uia.elements ?? []
  let dismissed = 0

  for (const dialog of dialogs) {
    const els = allElements.filter(e => e.windowId === dialog.id)
    const buttons = els
      .filter(e => e.type === 'button' && e.isEnabled && e.isVisible)
      .sort((a, b) => {
        const ai = DISMISS_BUTTON_PRIORITY.findIndex(l => a.label.includes(l))
        const bi = DISMISS_BUTTON_PRIORITY.findIndex(l => b.label.includes(l))
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })

    if (buttons.length > 0) {
      const btn = buttons[0]
      const r = executeInput({ action: 'click', x: btn.center.x, y: btn.center.y, delay: 200 })
      if (r.success) { dismissed++; continue }
    }

    const r = executeInput({ action: 'keyPress', key: 'Escape', delay: 200 })
    if (r.success) dismissed++
  }

  return dismissed
}
