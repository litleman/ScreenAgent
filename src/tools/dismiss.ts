import { z } from 'zod'
import { scanUiaTree } from '../engine/uia-bridge.js'
import { runVisionSidecar } from '../engine/vision.js'
import { fuseElements } from '../engine/fusion.js'
import { executeInput } from '../engine/input.js'
import { success, error } from '../utils/response.js'
import { logger } from '../utils/logger.js'
import type { ToolHandler, ScreenElement, DialogInfo } from '../utils/types.js'

const DISMISS_BUTTON_LABELS = [
  'Close', '关闭', '×',
  '确定', 'OK', 'Confirm', '确认',
  '取消', 'Cancel',
  '否', 'No', 'Don\'t Save', '不保存',
  '应用', 'Apply',
  'Save', '保存',
  'Discard', '放弃',
]

export const dismissSchema = {
  dialogId: z.string().optional().describe('指定要关闭的弹窗 ID（不指定则关闭所有）'),
  method: z.enum(['auto', 'click', 'keyboard']).default('auto').describe('关闭方式'),
}

export const dismissHandler: ToolHandler = async (args) => {
  const targetId = args.dialogId as string | undefined
  const method = (args.method as string) ?? 'auto'

  // Scan current state
  const uia = scanUiaTree(true)
  if (!uia.success) {
    return error('UIA 扫描失败: ' + (uia.error ?? '未知错误'))
  }

  const dialogs: DialogInfo[] = uia.dialogWindows ?? []
  const allElements: ScreenElement[] = uia.elements ?? []

  // Also run OCR for button detection inside dialogs
  const vision = runVisionSidecar(true)
  let fusedElements = allElements
  if (vision.success) {
    const result = fuseElements(allElements, vision.elements ?? [], uia.windows ?? [])
    fusedElements = result.elements
  }

  if (dialogs.length === 0) {
    return success({ success: true, dismissed: 0, message: '没有检测到弹窗' })
  }

  const targetDialogs = targetId
    ? dialogs.filter(d => d.id === targetId)
    : dialogs

  if (targetDialogs.length === 0) {
    return error('未找到指定的弹窗: ' + targetId)
  }

  const dismissed: string[] = []
  const failures: string[] = []

  for (const dialog of targetDialogs) {
    const windowEls = fusedElements.filter(e => e.windowId === dialog.id)

    if (method === 'keyboard') {
      // Try Escape first, then Enter
      for (const key of ['Escape', 'Enter']) {
        try {
          const inputResult = executeInput({
            action: 'keyPress',
            key,
            delay: 300,
          })
          if (inputResult.success) {
            dismissed.push(dialog.id + '(key:' + key + ')')
            break
          }
        } catch {
          continue
        }
      }
      continue
    }

    // Try clicking dismiss buttons in priority order
    const buttons = windowEls
      .filter(e => e.type === 'button' && e.isEnabled && e.isVisible)
      .sort((a, b) => {
        const aIdx = DISMISS_BUTTON_LABELS.findIndex(l => a.label.includes(l))
        const bIdx = DISMISS_BUTTON_LABELS.findIndex(l => b.label.includes(l))
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
      })

    if (buttons.length > 0) {
      const btn = buttons[0]
      try {
        const inputResult = executeInput({
          action: 'click',
          x: btn.center.x,
          y: btn.center.y,
          delay: 300,
          verifyClick: true,
        })
        if (inputResult.success) {
          dismissed.push(dialog.id + '(' + btn.label + ')')
          continue
        }
      } catch {
        // fall through
      }
    }

      failures.push(dialog.id)
  }

  return success({
    success: failures.length === 0,
    dismissed: dismissed.length,
    total: targetDialogs.length,
    dismissedDialogs: dismissed,
    failedDialogs: failures.length > 0 ? failures : undefined,
    message: dismissed.length > 0
      ? '已关闭 ' + dismissed.length + '/' + targetDialogs.length + ' 个弹窗'
      : '未能关闭任何弹窗',
  })
}
