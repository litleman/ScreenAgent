import { execSync } from 'node:child_process'
import { config, checkPythonAvailable } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export interface InvokeResult {
  success: boolean
  method?: string
  error?: string
  duration?: number
}

export function invokeElement(
  label?: string,
  automationId?: string,
): InvokeResult {
  if (!label && !automationId) {
    return { success: false, error: '需要 label 或 automationId' }
  }

  const pyCheck = checkPythonAvailable()
  if (!pyCheck.ok) {
    return { success: false, error: pyCheck.error }
  }

  try {
    let args = `"${config.pythonPath}" "${config.uiaScriptPath}" --invoke`
    if (label) args += ` label=${label}`
    if (automationId) args += ` automationId=${automationId}`

    const stdout = execSync(args, {
      encoding: 'utf-8',
      timeout: config.defaultTimeout,
    })
    const parsed = JSON.parse(stdout) as Record<string, unknown>

    const result: InvokeResult = {
      success: Boolean(parsed.success),
      method: (parsed.method as string) ?? undefined,
      error: (parsed.error as string) ?? undefined,
      duration: (parsed.duration as number) ?? undefined,
    }

    if (result.success) {
      logger.info(`Invoke ${label || automationId}: ${result.method} (${result.duration}ms)`)
    } else {
      logger.warn(`Invoke ${label || automationId} 失败: ${result.error}`)
    }

    return result
  } catch (err) {
    logger.error(`Invoke ${label || automationId} 异常`, err)
    return { success: false, error: String(err) }
  }
}
