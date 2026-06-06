import type { WindowInfo } from './types.js'

export function computeStateHash(
  windows: WindowInfo[],
  elementCount: number,
): string {
  const parts = windows.map(w =>
    `${w.id}|${w.title}|${w.bounds.x},${w.bounds.y},${w.bounds.width},${w.bounds.height}|${w.isFocused}|${w.isMinimized}`,
  )
  parts.sort()
  parts.push(`count:${elementCount}`)
  return simpleHash(parts.join('||'))
}

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}
