import type { ScreenElement, ScreenState, VerifyResult, VerificationLevel, WindowInfo } from '../utils/types.js'
import { runVisionSidecar } from '../engine/vision.js'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { screenContext } from '../engine/context.js'
import { findElementByLabel } from './perception.js'
import { verifyWindowStability } from './precision.js'
import { logger } from '../utils/logger.js'

export interface ActionVerification {
  elementLevel: VerifyResult
  windowLevel: VerifyResult
  systemLevel: VerifyResult
  overall: VerifyResult
}

export async function verifyClickOutcome(
  expectedLabel: string,
): Promise<VerifyResult> {
  const beforeState = screenContext.state
  const fresh = runVisionSidecar(true)
  if (!fresh.success) {
    return {
      passed: false, level: 'system', confidence: 0,
      mismatch: '刷新屏幕状态失败',
      details: [fresh.error ?? '未知错误'],
    }
  }

  const uia = scanUiaTree()
  const allElements = [...fresh.elements, ...(uia.success ? uia.elements : [])]

  const windows = fresh.windows ?? uia.windows ?? screenContext.state?.windows ?? []
  const updatedState = screenContext.update(
    allElements, windows,
    uia.focusedApp, null,
    fresh.screenshotPath,
  )

  const found = findElementByLabel(updatedState.elements, expectedLabel)
  const windowChanges = screenContext.findWindowChangeSinceLastScan()

  const elementResult = await verifyElementLevel(
    found.element, expectedLabel, found.confidence,
  )
  const windowResult = verifyWindowLevel(windowChanges, expectedLabel)
  const systemResult = verifySystemLevel(
    beforeState, updatedState, expectedLabel,
  )

  const passed = elementResult.passed || windowResult.passed || systemResult.passed
  const details = [
    ...elementResult.details.map(d => `[元素] ${d}`),
    ...windowResult.details.map(d => `[窗口] ${d}`),
    ...systemResult.details.map(d => `[系统] ${d}`),
  ]
  const confidence = Math.max(
    elementResult.confidence,
    windowResult.confidence * 0.7,
    systemResult.confidence * 0.5,
  )

  return {
    passed,
    level: elementResult.level,
    confidence,
    actualLabel: found.element?.label,
    expectedLabel,
    mismatch: elementResult.mismatch ?? windowResult.mismatch ?? systemResult.mismatch,
    details,
  }
}

async function verifyElementLevel(
  element: ScreenElement | null,
  expectedLabel: string,
  confidence: number,
): Promise<VerifyResult> {
  if (!element) {
    return {
      passed: true,
      level: 'element',
      confidence: 0.9,
      mismatch: '元素已消失 — 操作可能已触发跳转或关闭',
      details: [`元素 "${expectedLabel}" 不在当前屏幕中`],
    }
  }

  if (element.isFocused) {
    return {
      passed: true,
      level: 'element',
      confidence: 1,
      details: [`元素 "${expectedLabel}" 状态: 已聚焦`],
    }
  }

  return {
    passed: true,
    level: 'element',
    confidence: Math.max(confidence, 0.6),
    actualLabel: element.label,
    expectedLabel,
    details: [`元素 "${expectedLabel}" 仍在屏幕中 (confidence=${(confidence * 100).toFixed(0)}%)`],
  }
}

function verifyWindowLevel(
  windowChanges: string[],
  expectedLabel: string,
): VerifyResult {
  if (windowChanges.length === 0) {
    return {
      passed: false,
      level: 'window',
      confidence: 0.3,
      details: ['窗口状态无变化，操作可能未生效'],
    }
  }

  const relevantChanges = windowChanges.filter(c => {
    const label = expectedLabel.toLowerCase()
    const cLower = c.toLowerCase()
    return cLower.includes(label) || label.includes(cLower)
  })

  if (relevantChanges.length > 0) {
    return {
      passed: true,
      level: 'window',
      confidence: 0.85,
      details: relevantChanges,
    }
  }

  return {
    passed: false,
    level: 'window',
    confidence: 0.5,
    details: windowChanges,
  }
}

function verifySystemLevel(
  beforeState: ScreenState | null,
  afterState: ScreenState,
  expectedLabel: string,
): VerifyResult {
  const details: string[] = []

  if (!beforeState) {
    return { passed: false, level: 'system', confidence: 0.1, details: ['无前一状态可对比'] }
  }

  if (beforeState.focusedApp !== afterState.focusedApp) {
    if (afterState.focusedApp) {
      details.push(`焦点应用变化: ${beforeState.focusedApp} → ${afterState.focusedApp}`)
    }
  }

  const elementCountDiff = afterState.elements.length - beforeState.elements.length
  if (Math.abs(elementCountDiff) > 0) {
    details.push(`界面元素数量变化: ${beforeState.elements.length} → ${afterState.elements.length} (${elementCountDiff > 0 ? '+' : ''}${elementCountDiff})`)
  }

  const windowCountDiff = afterState.windows.length - beforeState.windows.length
  if (windowCountDiff > 0) {
    details.push(`新出现了 ${windowCountDiff} 个窗口— 可能弹出了对话框`)
  }

  return {
    passed: details.length > 0,
    level: 'system',
    confidence: details.length > 0 ? 0.7 : 0.2,
    details: details.length > 0 ? details : ['系统级状态无明显变化'],
  }
}

export async function verifyTextEntered(
  elementLabel: string,
  expectedText: string,
): Promise<VerifyResult> {
  const fresh = runVisionSidecar(true)
  if (!fresh.success) {
    return {
      passed: false, level: 'system', confidence: 0,
      mismatch: '刷新屏幕状态失败',
      details: ['视觉扫描失败'],
    }
  }

  const uia = scanUiaTree()
  const allElements = [...fresh.elements, ...(uia.success ? uia.elements : [])]
  const found = findElementByLabel(allElements, elementLabel)

  if (!found.element) {
    const details = [
      `元素 "${elementLabel}" 已消失`,
      `可能输入操作触发了导航或关闭`,
    ]
    return {
      passed: true, level: 'element', confidence: 0.8,
      mismatch: '元素消失 — 操作可能成功',
      details,
    }
  }

  if (found.element.value !== undefined) {
    const actual = found.element.value
    const passed = actual.includes(expectedText)

    if (passed) {
      return {
        passed: true, level: 'element', confidence: 1,
        actualLabel: actual, expectedLabel: expectedText,
        details: [`输入验证通过: 期望 "${expectedText}"，实际 "${actual}"`],
      }
    }

    return {
      passed: false, level: 'element', confidence: 0.3,
      actualLabel: actual, expectedLabel: expectedText,
      mismatch: `输入内容不匹配: 期望 "${expectedText}"，实际 "${actual}"`,
      details: [`输入验证失败`],
    }
  }

  return {
    passed: true, level: 'element', confidence: 0.5,
    expectedLabel: expectedText,
    details: ['无法获取输入元素的 value 属性，无法精确验证'],
  }
}

export function analyzeInteractionRisk(
  element: ScreenElement,
  action: string,
): { risk: 'low' | 'medium' | 'high'; reason: string } {
  if (action === 'click' || action === 'doubleClick') {
    switch (element.type) {
      case 'button': {
        const dangerousLabels = ['删除', '移除', '关闭', '退出', '取消', 'reset', 'delete', 'remove', 'close', 'exit']
        const match = dangerousLabels.find(l => element.label.toLowerCase().includes(l))
        if (match) {
          return { risk: 'medium', reason: `高危操作: 点击 "${element.label}"（含 "${match}"）` }
        }
        return { risk: 'low', reason: '常规按钮操作' }
      }
      case 'title': {
        if (element.label.toLowerCase().includes('close') || element.label.includes('×') || element.label.includes('✕')) {
          return { risk: 'high', reason: `窗口关闭按钮: "${element.label}"` }
        }
        return { risk: 'medium', reason: `标题栏操作: "${element.label}"` }
      }
      case 'link':
        return { risk: 'medium', reason: '链接点击可能导致页面跳转' }
      case 'checkbox':
        return { risk: 'low', reason: '复选框切换' }
      default:
        return { risk: 'low', reason: `${element.type} 操作` }
    }
  }

  if (action === 'type') {
    if (element.type !== 'input') {
      return { risk: 'medium', reason: `向非输入框元素 (${element.type}) 输入文本` }
    }
    return { risk: 'low', reason: '文本输入' }
  }

  if (action === 'keyPress') {
    return { risk: 'low', reason: '按键操作' }
  }

  return { risk: 'low', reason: `${action} 操作` }
}
