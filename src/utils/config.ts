import { fileURLToPath } from 'node:url'

export interface ScreenAgentConfig {
  pythonPath: string
  visionScriptPath: string
  uiaScriptPath: string
  inputScriptPath: string
  screenshotDir: string
  cacheEnabled: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  defaultTimeout: number
  pollInterval: number
}

function resolvePath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url))
}

function numEnv(key: string, defaultVal: number): number {
  const val = process.env[key]
  if (val === undefined || val === '') return defaultVal
  return Number(val)
}

function loadConfig(): ScreenAgentConfig {
  return {
    pythonPath: process.env.SCREEN_AGENT_PYTHON || 'python',
    visionScriptPath:
      process.env.SCREEN_AGENT_VISION_SCRIPT ||
      resolvePath('../../vision/omniparser.py'),
    uiaScriptPath:
      process.env.SCREEN_AGENT_UIA_SCRIPT ||
      resolvePath('../../vision/uia_bridge.py'),
    inputScriptPath:
      process.env.SCREEN_AGENT_INPUT_SCRIPT ||
      resolvePath('../../vision/input_engine.py'),
    screenshotDir:
      process.env.SCREEN_AGENT_SCREENSHOT_DIR ||
      resolvePath('../../screenshots'),
    cacheEnabled: process.env.SCREEN_AGENT_CACHE !== 'false',
    logLevel: (process.env.SCREEN_AGENT_LOG_LEVEL as ScreenAgentConfig['logLevel']) || 'info',
    defaultTimeout: numEnv('SCREEN_AGENT_TIMEOUT', 15000),
    pollInterval: numEnv('SCREEN_AGENT_POLL_INTERVAL', 500),
  }
}

export const config = loadConfig()
