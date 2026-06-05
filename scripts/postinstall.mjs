#!/usr/bin/env node
// Screen Agent — npm postinstall 钩子
// 作用: 安装 Python 依赖 + 交互配置 MCP 客户端
// 用绝对路径运行，不依赖 CWD

import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const requirementsPath = path.join(projectRoot, 'requirements.txt')

console.log('')
console.log('='.repeat(58))
console.log('  Screen Agent — 安装后配置')
console.log('='.repeat(58))
console.log('')

// ── 1. 检查 Python ──
function checkPython() {
  try {
    const ver = execSync('python --version', { encoding: 'utf-8', timeout: 5000 })
    console.log(`  Python: ${ver.trim()}`)
    return true
  } catch {
    try {
      const ver = execSync('python3 --version', { encoding: 'utf-8', timeout: 5000 })
      console.log(`  Python: ${ver.trim()}`)
      return true
    } catch {
      return false
    }
  }
}

function checkPip() {
  try {
    execSync('pip --version', { encoding: 'utf-8', timeout: 5000 })
    return true
  } catch {
    try {
      execSync('pip3 --version', { encoding: 'utf-8', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}

function installPythonDeps() {
  console.log('  正在安装 Python 依赖...')
  try {
    execSync(
      `pip install -r "${requirementsPath}"`,
      { encoding: 'utf-8', timeout: 300000, stdio: 'inherit' },
    )
    console.log('  ✔ Python 依赖安装完成')
    return true
  } catch {
    try {
      execSync(
        `pip3 install -r "${requirementsPath}"`,
        { encoding: 'utf-8', timeout: 300000, stdio: 'inherit' },
      )
      console.log('  ✔ Python 依赖安装完成')
      return true
    } catch (err) {
      console.log('  ⚠ Python 依赖安装失败')
      console.log(`     ${err.stderr?.split('\n')[0] || err.message || '未知错误'}`)
      console.log('  安装完成后可手动运行: pip install -r requirements.txt')
      return false
    }
  }
}

// ── 2. 主流程 ──

const hasPython = checkPython()

if (!hasPython) {
  console.log('  ⚠ 未检测到 Python')
  console.log('  Screen Agent 需要 Python 3.9+ 才能运行')
  console.log('  请从 https://python.org 下载安装后重新运行 npm install -g screen-agent')
  console.log('')
} else {
  const hasPip = checkPip()
  if (!hasPip) {
    console.log('  ⚠ 未检测到 pip')
    console.log('  请确保 Python 已添加到 PATH（安装时勾选 "Add Python to PATH"）')
    console.log('')
  } else {
    installPythonDeps()
  }
}

// ── 3. easyocr 提示 ──
console.log('  easyocr 首次运行时将自动下载约 100MB 中英文识别模型')
console.log('')

// ── 4. 启动交互配置 ──
const configureScript = path.join(projectRoot, 'scripts', 'configure.mjs')
if (existsSync(configureScript)) {
  // 用子进程运行 configure，保持交互式 stdin
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [configureScript, '--install'], {
    stdio: 'inherit',
    cwd: projectRoot,
  })
  await new Promise((resolve) => child.on('exit', resolve))
}
