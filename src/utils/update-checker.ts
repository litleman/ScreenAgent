import { exec } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import https from 'https'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { APP_VERSION } from './config.js'
import { logger } from './logger.js'

export interface UpdateCache {
  latestVersion: string
  checkedAt: number
}

const CACHE_TTL = 24 * 60 * 60 * 1000

function getCachePath(): string {
  return join(homedir(), '.screen-agent', 'update-check.json')
}

export function readCache(): UpdateCache | null {
  try {
    const raw = readFileSync(getCachePath(), 'utf-8')
    return JSON.parse(raw) as UpdateCache
  } catch {
    return null
  }
}

export function writeCache(data: UpdateCache): void {
  try {
    const dir = dirname(getCachePath())
    mkdirSync(dir, { recursive: true })
    writeFileSync(getCachePath(), JSON.stringify(data), 'utf-8')
  } catch {
    /* silent */
  }
}

export function isCacheValid(cache: UpdateCache | null): boolean {
  if (!cache || typeof cache.latestVersion !== 'string' || typeof cache.checkedAt !== 'number') return false
  return Date.now() - cache.checkedAt < CACHE_TTL
}

export async function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://registry.npmjs.org/screen-agent/latest',
      { timeout: 5000, headers: { Accept: 'application/json' } },
      (res) => {
        let data = ''
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => {
          try {
            resolve((JSON.parse(data) as { version: string }).version)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

export function showWindowsNotification(latestVersion: string): void {
  // 纵深防御：仅允许标准 semver 版本号
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(latestVersion)) return

  const ps = [
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$n = New-Object System.Windows.Forms.NotifyIcon`,
    `$n.Icon = [System.Drawing.SystemIcons]::Information`,
    `$n.BalloonTipTitle = "screen-agent 更新可用"`,
    `$n.BalloonTipText = "新版本 ${latestVersion} 已发布。npm update -g screen-agent 升级。"`,
    `$n.Visible = $true`,
    `$n.ShowBalloonTip(5000)`,
    `Start-Sleep 5`,
    `$n.Dispose()`,
  ].join('; ')
  exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, () => { /* silent */ })
}

export async function checkForUpdate(): Promise<void> {
  const cache = readCache()
  if (isCacheValid(cache)) return

  const latest = await fetchLatestVersion()
  if (!latest) return

  writeCache({ latestVersion: latest, checkedAt: Date.now() })

  if (APP_VERSION === latest) return

  const pad = (s: string) => s.padEnd(20)
  const msg = [
    `╔════════════════════════════════════════╗`,
    `║  screen-agent 更新可用!                ║`,
    `║  当前版本: ${pad(APP_VERSION)}║`,
    `║  最新版本: ${pad(latest)}║`,
    `║                                        ║`,
    `║  自动更新:                             ║`,
    `║  npm update -g screen-agent            ║`,
    `║                                        ║`,
    `║  手动更新:                             ║`,
    `║  npm install -g screen-agent@latest    ║`,
    `╚════════════════════════════════════════╝`,
  ].join('\n')

  logger.info(`\n${msg}`)
  if (process.platform === 'win32') {
    showWindowsNotification(latest)
  }
}
