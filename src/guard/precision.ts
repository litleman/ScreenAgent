import type { ScreenElement, WindowInfo, Bounds, ClickValidation, RiskLevel } from '../utils/types.js'
import { isClickWithinBounds } from '../engine/window.js'
import { logger } from '../utils/logger.js'

const ELEMENT_TYPE_SAFE_MARGINS: Record<string, number> = {
  button: 8,
  input: 4,
  link: 6,
  checkbox: 4,
  radio: 4,
  combo: 4,
  slider: 4,
  text: 3,
  image: 5,
  title: 3,
  scrollbar: 2,
}

const WINDOW_FRAME_SAFE_ZONE = 8

export function validateClick(
  targetX: number,
  targetY: number,
  element: ScreenElement,
  windows: WindowInfo[],
  focusedWindowId?: string | null,
): ClickValidation {
  const warnings: string[] = []
  let riskLevel: RiskLevel = 'none'

  const inElementBounds = isClickWithinBounds(
    targetX, targetY,
    element.bounds,
    getSafeMargin(element),
  )

  if (!inElementBounds) {
    warnings.push(`点击位置 (${targetX}, ${targetY}) 超出元素 "${element.label}" 边界框 ${JSON.stringify(element.bounds)}`)
    riskLevel = escalateRisk(riskLevel, 'high')
  }

  const windowBorderWarnings = checkWindowBorderProximity(
    targetX, targetY, element.bounds,
  )
  warnings.push(...windowBorderWarnings)
  if (windowBorderWarnings.length > 0) {
    riskLevel = escalateRisk(riskLevel, 'medium')
  }

  if (element.windowId) {
    const parentWindow = windows.find(w => w.id === element.windowId)
    if (parentWindow) {
      if (parentWindow.isMinimized) {
        warnings.push(`元素的父窗口 "${parentWindow.title}" 已最小化，操作可能被忽略`)
        riskLevel = escalateRisk(riskLevel, 'high')
      }

      const clickInWindow = isClickWithinBounds(
        targetX, targetY,
        parentWindow.bounds,
        -WINDOW_FRAME_SAFE_ZONE,
      )
      if (!clickInWindow) {
        warnings.push(`点击位置 (${targetX}, ${targetY}) 超出父窗口 "${parentWindow.title}" 边界`)
        riskLevel = escalateRisk(riskLevel, 'high')
      }

      const windowEdgeWarnings = checkWindowEdgeProximity(
        targetX, targetY, parentWindow.bounds,
      )
      warnings.push(...windowEdgeWarnings)
      if (windowEdgeWarnings.length > 0 && riskLevel === 'none') {
        riskLevel = escalateRisk(riskLevel, 'low')
      }
    } else {
      warnings.push(`元素引用的父窗口 (${element.windowId}) 已不存在`)
      riskLevel = escalateRisk(riskLevel, 'medium')
    }
  } else {
    warnings.push('元素没有关联窗口，无法验证窗口边界')
    riskLevel = escalateRisk(riskLevel, 'low')
  }

  if (focusedWindowId && element.windowId && focusedWindowId !== element.windowId) {
    const focusedWin = windows.find(w => w.id === focusedWindowId)
    if (focusedWin) {
      warnings.push(`当前焦点在 "${focusedWin.title}"，目标元素属于其他窗口，点击前可能需要先切换焦点`)
      riskLevel = escalateRisk(riskLevel, 'medium')
    }
  }

  return {
    safe: riskLevel !== 'high',
    riskLevel,
    warnings,
    suggestedX: riskLevel === 'high' && isClickWithinBounds(targetX, targetY, element.bounds, 0)
      ? element.center.x
      : undefined,
    suggestedY: riskLevel === 'high' && isClickWithinBounds(targetX, targetY, element.bounds, 0)
      ? element.center.y
      : undefined,
  }
}

function getSafeMargin(element: ScreenElement): number {
  return ELEMENT_TYPE_SAFE_MARGINS[element.type] ?? 5
}

function checkWindowBorderProximity(
  x: number, y: number, bounds: Bounds,
): string[] {
  const warnings: string[] = []
  const distLeft = Math.abs(x - bounds.x)
  const distRight = Math.abs(x - (bounds.x + bounds.width))
  const distTop = Math.abs(y - bounds.y)
  const distBottom = Math.abs(y - (bounds.y + bounds.height))

  if (distLeft < 3) warnings.push(`X 坐标过于靠近元素左边界 (${distLeft.toFixed(0)}px)`)
  if (distRight < 3) warnings.push(`X 坐标过于靠近元素右边界 (${distRight.toFixed(0)}px)`)
  if (distTop < 3) warnings.push(`Y 坐标过于靠近元素上边界 (${distTop.toFixed(0)}px)`)
  if (distBottom < 3) warnings.push(`Y 坐标过于靠近元素下边界 (${distBottom.toFixed(0)}px)`)

  return warnings
}

function checkWindowEdgeProximity(
  x: number, y: number, windowBounds: Bounds,
): string[] {
  const warnings: string[] = []
  const distTitleBar = y - windowBounds.y
  if (distTitleBar < 0) {
    warnings.push(`点击位置在窗口标题栏上方 (y=${y}, 窗口顶部=${windowBounds.y})`)
  }

  const distLeft = x - windowBounds.x
  const distRight = (windowBounds.x + windowBounds.width) - x

  if (distLeft < WINDOW_FRAME_SAFE_ZONE && distLeft >= 0) {
    warnings.push(`点击靠近窗口左边缘 (${distLeft.toFixed(0)}px)，有误触窗口边框风险`)
  }
  if (distRight < WINDOW_FRAME_SAFE_ZONE && distRight >= 0) {
    warnings.push(`点击靠近窗口右边缘 (${distRight.toFixed(0)}px)，有误触窗口边框风险`)
  }

  return warnings
}

function escalateRisk(current: RiskLevel, candidate: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['none', 'low', 'medium', 'high']
  return order.indexOf(candidate) > order.indexOf(current) ? candidate : current
}

export function validateActionSequence(
  actions: Array<{ type: string; targetX?: number; targetY?: number; label?: string }>,
  elements: ScreenElement[],
  windows: WindowInfo[],
): ClickValidation[] {
  return actions.map(a => {
    if (a.targetX !== undefined && a.targetY !== undefined) {
      const el = elements.find(
        e => e.label.toLowerCase() === (a.label ?? '').toLowerCase()
      )
      if (el) {
        return validateClick(a.targetX, a.targetY, el, windows)
      }
    }
    return { safe: true, riskLevel: 'none' as RiskLevel, warnings: [] }
  })
}

export interface WindowStateVerification {
  passed: boolean
  details: string[]
}

export function verifyWindowStability(
  beforeWindows: WindowInfo[],
  afterWindows: WindowInfo[],
): WindowStateVerification {
  const details: string[] = []
  let passed = true

  for (const after of afterWindows) {
    const before = beforeWindows.find(w => w.id === after.id)
    if (!before) {
      details.push(`新窗口: ${after.title}`)
      continue
    }

    if (after.isMinimized && !before.isMinimized) {
      details.push(`窗口 "${after.title}" 已最小化`)
    }
    if (after.isMaximized && !before.isMaximized) {
      details.push(`窗口 "${after.title}" 已最大化`)
    }
    if (!after.isMinimized && before.isMinimized) {
      details.push(`窗口 "${after.title}" 已还原`)
    }

    const areaChange = Math.abs(
      (after.bounds.width * after.bounds.height) -
      (before.bounds.width * before.bounds.height),
    )
    if (areaChange > 1000) {
      details.push(`窗口 "${after.title}" 大小变化: ${before.bounds.width}x${before.bounds.height} → ${after.bounds.width}x${after.bounds.height}`)
    }
  }

  for (const before of beforeWindows) {
    if (!afterWindows.find(w => w.id === before.id)) {
      details.push(`窗口 "${before.title}" 已关闭`)
    }
  }

  return { passed, details }
}
