import { describe, it, expect } from 'vitest'
import { findElementByLabel, canInteract } from '../perception.js'
import type { ScreenElement } from '../../utils/types.js'

function makeEl(label: string, overrides: Partial<ScreenElement> = {}): ScreenElement {
  return {
    id: `test_${label}`,
    label,
    type: 'button',
    bounds: { x: 0, y: 0, width: 100, height: 30 },
    center: { x: 50, y: 15 },
    isEnabled: true,
    isVisible: true,
    isFocused: false,
    source: 'ocr',
    confidence: 0.9,
    ...overrides,
  }
}

const elements: ScreenElement[] = [
  makeEl('提交'),
  makeEl('取消'),
  makeEl('确定'),
  makeEl('保存'),
  makeEl('搜索', { type: 'input' }),
  makeEl('Delete', { type: 'link' }),
  makeEl('user@example.com', { type: 'input' }),
]

describe('findElementByLabel', () => {

  it('精确匹配返回 confidence=1', () => {
    const result = findElementByLabel(elements, '提交')
    expect(result.passed).toBe(true)
    expect(result.confidence).toBe(1)
    expect(result.element?.label).toBe('提交')
  })

  it('精确匹配忽略大小写', () => {
    const result = findElementByLabel(elements, 'delete')
    expect(result.passed).toBe(true)
    expect(result.element?.label).toBe('Delete')
  })

  it('模糊匹配相近文本', () => {
    const result = findElementByLabel(elements, '确定按钮')
    expect(result.passed).toBe(true)
    expect(result.element?.label).toBe('确定')
  })

  it('fuzzy=false 时不进行模糊匹配', () => {
    const result = findElementByLabel(elements, '确定按钮', false)
    expect(result.passed).toBe(false)
    expect(result.element).toBeNull()
  })

  it('无匹配时返回 failed', () => {
    const result = findElementByLabel(elements, '不存在的元素')
    expect(result.passed).toBe(false)
    expect(result.element).toBeNull()
    expect(result.warnings[0]).toContain('不存在的元素')
  })

  it('空列表返回 failed', () => {
    const result = findElementByLabel([], 'anything')
    expect(result.passed).toBe(false)
  })

  it('低分模糊匹配不通过 (score ≤ 0.5)', () => {
    const result = findElementByLabel(elements, 'abcdefghijk')
    expect(result.passed).toBe(false)
  })

  it('包含关系有较高匹配分', () => {
    const result = findElementByLabel(elements, 'user@example')
    expect(result.passed).toBe(true)
    expect(result.element?.label).toBe('user@example.com')
  })
})

describe('canInteract', () => {

  it('可交互元素返回空警告', () => {
    const el = makeEl('button')
    expect(canInteract(el)).toEqual([])
  })

  it('禁用元素有警告', () => {
    const el = makeEl('disabled', { isEnabled: false })
    const warnings = canInteract(el)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('已禁用')
  })

  it('不可见元素有警告', () => {
    const el = makeEl('hidden', { isVisible: false })
    const warnings = canInteract(el)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('不可见')
  })

  it('禁用且不可见有两条警告', () => {
    const el = makeEl('dead', { isEnabled: false, isVisible: false })
    expect(canInteract(el).length).toBe(2)
  })
})
