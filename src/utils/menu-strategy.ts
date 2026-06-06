import type { ScreenElement } from './types.js'
import { screenContext } from '../engine/context.js'
import { logger } from './logger.js'

export type MenuStrategy = 'invoke' | 'keyboard' | 'mouse'

const MENU_KEYWORDS = [
  '文件', '编辑', '查看', '格式', '帮助', '工具', '窗口', '设置',
  'File', 'Edit', 'View', 'Format', 'Help', 'Tools', 'Window', 'Settings',
  '新建', '打开', '保存', '另存为', '打印', '退出',
  'New', 'Open', 'Save', 'Save As', 'Print', 'Exit',
  '复制', '粘贴', '剪切', '删除', '撤销', '重做',
  'Copy', 'Paste', 'Cut', 'Delete', 'Undo', 'Redo',
]

export function isMenuItemElement(el: ScreenElement): boolean {
  if (el.type === 'menu') return true
  if (!el.label) return false
  const lower = el.label.toLowerCase()
  return MENU_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))
}

export function hasMenuContext(): boolean {
  const state = screenContext.state
  if (!state) return false
  return state.elements.some(
    e => e.type === 'menu' && e.isVisible,
  )
}

export function determineMenuStrategy(
  el: ScreenElement,
  preferKeyboard = false,
): MenuStrategy {
  if (preferKeyboard) return 'keyboard'

  if (el.type === 'menu') return 'invoke'

  if (!el.isVisible && isMenuItemElement(el)) return 'invoke'

  if (hasMenuContext() && isMenuItemElement(el)) return 'invoke'

  return 'mouse'
}

export function isInvokeRecommended(el: ScreenElement): boolean {
  const strategy = determineMenuStrategy(el)
  return strategy !== 'mouse'
}

export function logMenuStrategy(el: ScreenElement, strategy: MenuStrategy): void {
  logger.info(`菜单策略 [${strategy}] 用于 "${el.label}" (type=${el.type}, visible=${el.isVisible})`)
}
