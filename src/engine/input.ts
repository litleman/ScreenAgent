import { execSync } from 'node:child_process'
import { config, checkPythonAvailable } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import type { Bounds, MovementProfile, ClickVerificationResult } from '../utils/types.js'
import { DEFAULT_MOVEMENT_PROFILE } from '../utils/types.js'

export interface InputAction {
  action: 'click' | 'doubleClick' | 'rightClick' | 'type' | 'keyPress' | 'hover' | 'scroll' | 'drag'
  x?: number
  y?: number
  text?: string
  key?: string
  scrollDelta?: number
  modifiers?: string[]
  delay?: number
  safeBounds?: Bounds
  movementProfile?: Partial<MovementProfile>
  backend?: 'auto' | 'sendinput' | 'pyautogui' | 'directinput'
  verifyClick?: boolean
}

export interface InputResult {
  success: boolean
  action: string
  x?: number
  y?: number
  error?: string
  withinSafeBounds?: boolean
  adjusted?: boolean
  backend?: string
  verification?: ClickVerificationResult
  calibrated?: { raw: { x: number; y: number }; calibrated: { x: number; y: number }; dpiScale: number; monitorIndex: number }
}

export interface InputStats {
  totalCalls: number
  totalFailures: number
  lastBackend: string
}

let inputStats: InputStats = { totalCalls: 0, totalFailures: 0, lastBackend: 'none' }

export function getInputStats(): InputStats {
  return { ...inputStats }
}

export function resetInputStats(): void {
  inputStats = { totalCalls: 0, totalFailures: 0, lastBackend: 'none' }
}

export function executeInput(action: InputAction): InputResult {
  inputStats.totalCalls++

  const pyCheck = checkPythonAvailable()
  if (!pyCheck.ok) {
    inputStats.totalFailures++
    return { success: false, action: action.action, error: pyCheck.error }
  }

  const act = action.action

  if (act === 'type' && !action.text) {
    return { success: false, action: act, error: 'type 操作需要 text 参数' }
  }
  if (act === 'keyPress' && !action.key) {
    return { success: false, action: act, error: 'keyPress 操作需要 key 参数' }
  }

  const isPositional = act === 'click' || act === 'doubleClick' || act === 'rightClick' || act === 'hover' || act === 'scroll'

  if (isPositional) {
    const posResult = validatePosition(action)
    if (!posResult.success) {
      inputStats.totalFailures++
      return { success: false, action: act, error: posResult.error }
    }
    const x = posResult.x!
    const y = posResult.y!

    const pr = callSidecar(buildInputPayload(action, x, y), act)
    if (!pr) return { success: false, action: act, error: 'Sidecar call failed' }

    if (!pr.pythonResult.success) inputStats.totalFailures++
    const result: InputResult = {
      success: pr.pythonResult.success ?? true,
      action: act, x, y,
      withinSafeBounds: posResult.withinSafeBounds,
      adjusted: posResult.adjusted,
      backend: pr.backend,
    }

    const v = pr.pythonResult.verification
    if (v) {
      result.verification = {
        verified: v.verified ?? false,
        method: v.method ?? 'none',
        confidence: v.confidence ?? 0,
        details: v.details ?? [],
      }
    }

    const c = pr.pythonResult.calibrated
    if (c) {
      result.calibrated = {
        raw: c.raw ?? { x, y },
        calibrated: c.calibrated ?? { x, y },
        dpiScale: c.dpi_scale ?? 1,
        monitorIndex: c.monitor_index ?? 0,
      }
    }
    return result
  }

  const pr = callSidecar(buildInputPayload(action), act)
  if (!pr) return { success: false, action: act, error: 'Sidecar call failed' }

  if (!pr.pythonResult.success) inputStats.totalFailures++
  return { success: pr.pythonResult.success, action: act, backend: pr.backend }
}

function buildInputPayload(action: InputAction, x?: number, y?: number): string {
  const payload: Record<string, unknown> = {
    action: action.action,
    delay: action.delay ?? 100,
  }

  if (x !== undefined) payload.x = x
  if (y !== undefined) payload.y = y
  if (action.text) payload.text = action.text
  if (action.key) payload.key = action.key
  if (action.scrollDelta !== undefined) payload.scrollDelta = action.scrollDelta
  if (action.modifiers && action.modifiers.length > 0) payload.modifiers = action.modifiers
  if (action.backend) payload.backend = action.backend
  if (action.verifyClick) payload.verifyClick = true

  const profile = action.movementProfile
  if (profile) {
    payload.movementProfile = {
      style: profile.style ?? DEFAULT_MOVEMENT_PROFILE.style,
      speed: profile.speed ?? DEFAULT_MOVEMENT_PROFILE.speed,
      overshootChance: profile.overshootChance ?? DEFAULT_MOVEMENT_PROFILE.overshootChance,
      jitterAmount: profile.jitterAmount ?? DEFAULT_MOVEMENT_PROFILE.jitterAmount,
      controlPointSpread: profile.controlPointSpread ?? DEFAULT_MOVEMENT_PROFILE.controlPointSpread,
    }
  }

  return JSON.stringify(payload)
}

function callSidecar(
  inputJson: string, act: string,
): { pythonResult: Record<string, any>; backend: string } | null {
  try {
    const stdout = execSync(
      `"${config.pythonPath}" "${config.inputScriptPath}" ${encodeURIComponent(inputJson)}`,
      { encoding: 'utf-8', timeout: config.defaultTimeout },
    )
    const pythonResult = JSON.parse(stdout)
    const backend = pythonResult.backend ?? 'unknown'
    inputStats.lastBackend = backend
    logger.debug(`Input ${act}: backend=${backend} success=${pythonResult.success}`)
    return { pythonResult, backend }
  } catch (err) {
    inputStats.totalFailures++
    logger.error(`Input ${act} failed`, err)
    return null
  }
}

export function validatePosition(action: InputAction): {
  success: boolean
  x?: number
  y?: number
  withinSafeBounds: boolean
  adjusted: boolean
  error?: string
} {
  const x = action.x
  const y = action.y
  const base = { withinSafeBounds: true, adjusted: false }

  if (x === undefined || y === undefined) {
    return { ...base, success: false, error: '位置操作需要坐标 (x, y)' }
  }

  if (isNaN(x) || isNaN(y)) {
    return { ...base, success: false, error: `坐标无效: (${x}, ${y})` }
  }

  if (x < 0 || y < 0) {
    return { ...base, success: false, error: `坐标为负值: (${x}, ${y})` }
  }

  if (x > 99999 || y > 99999) {
    return { ...base, success: false, error: `坐标超出合理范围: (${x}, ${y})` }
  }

  if (action.safeBounds) {
    const sb = action.safeBounds
    const inside = x >= sb.x && x <= sb.x + sb.width && y >= sb.y && y <= sb.y + sb.height
    if (!inside) {
      const safeX = Math.max(sb.x, Math.min(x, sb.x + sb.width))
      const safeY = Math.max(sb.y, Math.min(y, sb.y + sb.height))
      logger.warn(`坐标 (${x}, ${y}) 超出安全边界，修正为 (${safeX}, ${safeY})`)
      return { ...base, success: true, x: safeX, y: safeY, withinSafeBounds: false, adjusted: true }
    }
  }

  return { ...base, success: true, x, y }
}
