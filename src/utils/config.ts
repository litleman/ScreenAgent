import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface ScreenAgentConfig {
  pythonPath: string
  visionScriptPath: string
  uiaScriptPath: string
  inputScriptPath: string
  screenshotDir: string
  cacheEnabled: boolean
  cacheTtl: number
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
    cacheTtl: numEnv('SCREEN_AGENT_CACHE_TTL', 500),
    logLevel: (process.env.SCREEN_AGENT_LOG_LEVEL as ScreenAgentConfig['logLevel']) || 'info',
    defaultTimeout: numEnv('SCREEN_AGENT_TIMEOUT', 60000),
    pollInterval: numEnv('SCREEN_AGENT_POLL_INTERVAL', 500),
  }
}

export const config = loadConfig()

function loadVersion(): string {
  try {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const pkgPath = path.resolve(dir, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const APP_VERSION = loadVersion()

const PYTHON_NOT_FOUND_MSG = `未检测到 Python 或 Python 依赖未安装

请确保:
  1. 已安装 Python 3.9+ (https://python.org)
  2. Python 已添加到系统 PATH
  3. 已安装依赖: pip install -r requirements.txt

安装完成后再重新启动 Screen Agent`

export function checkPythonAvailable(): { ok: true } | { ok: false; error: string } {
  try {
    const stdout = execSync('python --version', { encoding: 'utf-8', timeout: 5000 })
    return { ok: true }
  } catch {
    try {
      execSync('python3 --version', { encoding: 'utf-8', timeout: 5000 })
      return { ok: true }
    } catch {
      return { ok: false, error: PYTHON_NOT_FOUND_MSG }
    }
  }
}
