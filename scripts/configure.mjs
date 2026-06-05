#!/usr/bin/env node

// Screen Agent — MCP 配置助手
// 模式:
//   --install  从 npm postinstall 调用，交互选择+自动写入
//   --all      打印全部客户端配置（非交互，供 setup 命令用）
//   无参数     交互选择+输出配置（npm run configure）

import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distIndex = path.resolve(projectRoot, 'dist', 'index.js')
const argsPath = distIndex.replace(/\\/g, '/')
const isTTY = process.stdin.isTTY

// ── 客户端定义 ──

function mcpEntry() {
  return {
    command: 'node',
    args: [argsPath],
    env: {
      SCREEN_AGENT_PYTHON: 'python',
      SCREEN_AGENT_LOG_LEVEL: 'info',
    },
  }
}

const clients = [
  {
    id: 'claude',
    name: 'Claude Desktop',
    desc: 'AI 桌面客户端',
    configFile: () => {
      const appdata = process.env.APPDATA
      return appdata ? path.join(appdata, 'Claude', 'claude_desktop_config.json') : null
    },
    writeConfig: (cfgPath) => {
      let existing = {}
      try {
        if (existsSync(cfgPath)) {
          existing = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        }
      } catch { /* ignore parse errors */ }
      if (!existing.mcpServers) existing.mcpServers = {}
      existing.mcpServers['screen-agent'] = mcpEntry()
      const dir = path.dirname(cfgPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(cfgPath, JSON.stringify(existing, null, 2), 'utf-8')
      return existing
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    desc: '命令行 AI 编码助手',
    configFile: () => {
      const userProfile = process.env.USERPROFILE
      return userProfile ? path.join(userProfile, '.config', 'opencode', 'opencode.json') : null
    },
    writeConfig: (cfgPath) => {
      let existing = {}
      try {
        if (existsSync(cfgPath)) {
          existing = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        }
      } catch { /* ignore */ }
      if (!existing.mcpServers) existing.mcpServers = {}
      existing.mcpServers['screen-agent'] = mcpEntry()
      const dir = path.dirname(cfgPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(cfgPath, JSON.stringify(existing, null, 2), 'utf-8')
      return existing
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    desc: 'AI 代码编辑器',
    configFile: () => {
      const userProfile = process.env.USERPROFILE
      return userProfile ? path.join(userProfile, '.cursor', 'mcp.json') : null
    },
    writeConfig: (cfgPath) => {
      let existing = {}
      try {
        if (existsSync(cfgPath)) {
          existing = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        }
      } catch { /* ignore */ }
      if (!existing.mcpServers) existing.mcpServers = {}
      existing.mcpServers['screen-agent'] = mcpEntry()
      const dir = path.dirname(cfgPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(cfgPath, JSON.stringify(existing, null, 2), 'utf-8')
      return existing
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    desc: 'AI IDE',
    configFile: () => {
      const userProfile = process.env.USERPROFILE
      return userProfile ? path.join(userProfile, '.codeium', 'mcp_config.json') : null
    },
    writeConfig: (cfgPath) => {
      let existing = {}
      try {
        if (existsSync(cfgPath)) {
          existing = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        }
      } catch { /* ignore */ }
      if (!existing.mcpServers) existing.mcpServers = {}
      existing.mcpServers['screen-agent'] = mcpEntry()
      const dir = path.dirname(cfgPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(cfgPath, JSON.stringify(existing, null, 2), 'utf-8')
      return existing
    },
  },
]

function printConfig(client, showPath) {
  const cfgFile = client.configFile()
  console.log('')
  console.log(`  [${client.id}] ${client.name}`)
  console.log(`  ${client.desc}`)
  if (showPath && cfgFile) {
    console.log(`  配置文件: ${cfgFile}`)
  }
  console.log('')
  console.log(JSON.stringify({ mcpServers: { 'screen-agent': mcpEntry() } }, null, 2))
  console.log('')
}

function printAll() {
  console.log('')
  console.log('='.repeat(58))
  console.log('  Screen Agent — MCP 配置（全部客户端）')
  console.log('='.repeat(58))
  console.log('')
  if (!existsSync(distIndex)) {
    console.log('  ⚠ dist/index.js 不存在，请先运行: npm run build')
    console.log('')
    return
  }
  for (const client of clients) {
    printConfig(client, true)
  }
}

// ── 交互选择 ──

function askQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()) })
  })
}

async function interactiveInstall() {
  console.log('')
  console.log('='.repeat(58))
  console.log('  Screen Agent — 安装配置')
  console.log('='.repeat(58))
  console.log('')
  console.log('  选择你要集成的 AI 客户端：')
  console.log('')

  clients.forEach((c, i) => {
    const cfgFile = c.configFile()
    console.log(`  [${i + 1}] ${c.name}`)
    console.log(`      ${c.desc}`)
    if (cfgFile) console.log(`      写入: ${cfgFile}`)
    console.log('')
  })
  console.log('  [s] 跳过配置，稍后手动运行 npm run configure')
  console.log('  [a] 显示全部配置 JSON（不写入）')
  console.log('')

  let answer
  if (isTTY) {
    answer = await askQuestion('  请输入编号 (1-4 / s / a): ')
  } else {
    console.log('  ⚠ 非交互终端，跳过自动配置')
    console.log('  安装完成后运行: npx screen-agent-configure')
    console.log('')
    return
  }

  if (answer.toLowerCase() === 's') {
    console.log('')
    console.log('  已跳过。稍后可运行: npm run configure')
    console.log('')
    return
  }

  if (answer.toLowerCase() === 'a') {
    printAll()
    return
  }

  const idx = parseInt(answer, 10) - 1
  if (idx < 0 || idx >= clients.length) {
    console.log('')
    console.log('  ⚠ 无效编号')
    console.log('')
    return
  }

  const client = clients[idx]
  const cfgFile = client.configFile()
  if (!cfgFile) {
    console.log(`  ⚠ 无法确定 ${client.name} 的配置文件路径`)
    console.log('')
    return
  }

  try {
    const merged = client.writeConfig(cfgFile)
    console.log('')
    console.log(`  ✔ 已写入配置到:`)
    console.log(`    ${cfgFile}`)
    console.log('')
    console.log(`  重启 ${client.name} 即可使用 screen-agent`)
    console.log('')
  } catch (err) {
    console.log(`  ⚠ 写入失败: ${err.message}`)
    console.log('  请手动运行 npm run configure 查看配置')
    console.log('')
  }
}

async function interactivePrint() {
  console.log('')
  console.log('='.repeat(58))
  console.log('  Screen Agent — MCP 配置生成器')
  console.log('='.repeat(58))
  console.log('')
  console.log('  选择你的 AI 客户端：')
  console.log('')

  clients.forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.name} — ${c.desc}`)
  })
  console.log('  [a] 全部显示')
  console.log('')

  let answer
  if (isTTY) {
    answer = await askQuestion('  请输入编号 (1-4 / a): ')
  } else {
    console.log('  ⚠ 非交互终端，显示全部配置：')
    console.log('')
    printAll()
    return
  }

  if (answer.toLowerCase() === 'a') {
    printAll()
    return
  }

  const idx = parseInt(answer, 10) - 1
  if (idx < 0 || idx >= clients.length) {
    console.log('  ⚠ 无效编号')
    console.log('')
    return
  }

  printConfig(clients[idx], true)
  console.log(`  → 将上述 JSON 添加到对应配置文件的 mcpServers 字段`)
  console.log('')
}

// ── 入口 ──

const isInstall = process.argv.includes('--install')
const isAll = process.argv.includes('--all')

if (isAll) {
  printAll()
} else if (isInstall) {
  interactiveInstall()
} else {
  interactivePrint()
}
