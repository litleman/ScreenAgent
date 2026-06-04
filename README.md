# Screen Agent

**桌面 GUI 视觉代理引擎** — 让 AI 看懂并操作任何 Windows 软件。

通过 MCP (Model Context Protocol) 协议与 Claude Desktop / Cursor 等 AI 客户端集成，实现"看屏幕、找元素、点按钮、敲键盘"的全链路桌面自动化。

## 系统架构

```
┌──────────────────────────────────────────────────┐
│                 AI 客户端                          │
│  (Claude Desktop / Cursor / 其他 MCP 客户端)       │
└───────────────┬──────────────────────────────────┘
                │ MCP (stdio)
┌───────────────▼──────────────────────────────────┐
│              Screen Agent (dist/index.js)          │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────┐           │
│  │ Fusion  │  │  Guard   │  │ Input  │           │
│  │ 引擎    │  │  守卫    │  │ 调度   │           │
│  └────┬────┘  └────┬─────┘  └───┬────┘           │
│       │            │            │                 │
│  ┌────▼────┐  ┌────▼─────┐  ┌───▼─────────┐     │
│  │ UIA     │  │ OCR      │  │ Input Engine │     │
│  │ Bridge  │  │ (easyocr)│  │ SendInput+   │     │
│  │(pywinauto│  │+OpenCV) │  │ pyautogui    │     │
│  └─────────┘  └──────────┘  └─────────────┘     │
│                                                   │
│  Python Sidecar (子进程通信)                       │
└──────────────────────────────────────────────────┘
```

## 功能特性

| 特性 | 说明 |
|------|------|
| **双通道视觉** | UIA (Windows 可访问性树) + OCR (easyocr 中英文识别) 深度融合 |
| **智能融合** | IoU 去重、窗口级对齐、标签择优、坐标平均 |
| **精准控制** | Win32 SendInput 硬件级输入模拟，自动降级到 pyautogui |
| **人类化鼠标** | 贝塞尔曲线路径 + sin 速度轮廓 + 超调/抖动，模拟真人操作 |
| **点击验证** | 截图 diff + 色彩变化双通道验证，确认操作生效 |
| **坐标校准** | 多显示器 + 高 DPI 自动适配 |
| **自适应重试** | 操作失败自动重试，每次随机微调坐标，直到成功或达到上限 |
| **坐标平滑** | 多帧 EMA 平滑 + 离群抑制，消除视觉检测抖动 |
| **窗口感知** | 自动关联元素到窗口，窗口变化后强制重新扫描 |

## 安装

### 前置条件

| 环境 | 版本要求 |
|------|---------|
| Node.js | >= 18 |
| Python | >= 3.9 |
| 操作系统 | Windows 10/11 (必需，依赖 Win32 API + UIA) |

### 一键安装

```
scripts\setup.bat
```

### 手动安装

```bash
# 1. Python 依赖（必需）
pip install pywinauto>=6.8.0 Pillow>=10.0.0 numpy>=1.24.0 opencv-python>=4.8.0 easyocr>=1.7.0

# 2. Python 可选（自动降级后端）
pip install pyautogui>=0.9.53

# 3. Node.js 依赖
npm install

# 4. 编译 TypeScript
npm run build

# 5. 健康检查
python scripts/check.py
```

### 首次启动 easyocr

easyocr 首次运行时会自动下载中英文识别模型（约 100MB），请确保网络畅通。

## 配置

在项目根目录创建 `.env` 文件（可参考 `.env.example`）：

```ini
SCREEN_AGENT_PYTHON=python            # Python 可执行文件路径
SCREEN_AGENT_LOG_LEVEL=info           # debug | info | warn | error
SCREEN_AGENT_TIMEOUT=15000            # Python sidecar 超时 (ms)
SCREEN_AGENT_POLL_INTERVAL=500        # 轮询间隔 (ms)
SCREEN_AGENT_CACHE=true               # 启用视觉缓存
SCREEN_AGENT_SCREENSHOT_DIR=./screenshots
```

## MCP 客户端配置

### Claude Desktop

编辑 `claude_desktop_config.json`（位于 `%APPDATA%\Claude\`）：

```json
{
  "mcpServers": {
    "screen-agent": {
      "description": "桌面 GUI 视觉代理 — 看懂并操作任何 Windows 软件",
      "command": "node",
      "args": ["D:/path/to/screen-agent/dist/index.js"],
      "env": {
        "SCREEN_AGENT_PYTHON": "python",
        "SCREEN_AGENT_LOG_LEVEL": "info",
        "SCREEN_AGENT_TIMEOUT": "15000",
        "SCREEN_AGENT_CACHE": "true"
      }
    }
  }
}
```

> `args` 中的路径请替换为你的实际项目路径。
> 如果 Python 不在 PATH 中，将 `SCREEN_AGENT_PYTHON` 改为完整路径如 `C:/Users/xxx/.pyenv/pyenv-win/versions/3.12.0/python.exe`。

### Cursor / 其他 MCP 客户端

同样配置一个 MCP server，命令为 `node`，参数为 `dist/index.js` 的完整路径。

## 使用

启动后，AI 客户端自动获得以下工具：

### screen_discover
扫描当前屏幕所有可交互元素（UIA + OCR 融合）。
```
可用元素: 52 个
  ├── 按钮: 8
  ├── 输入框: 5
  ├── 文本: 23
  ├── 菜单: 4
  └── 其他: 12
```

### screen_vision
视觉分析当前屏幕，获取 OCR 文本、元素位置和焦点状态。

### screen_act
执行操控操作。支持参数：
- `action`: click / doubleClick / rightClick / type / keyPress / hover / scroll
- `backend`: auto / sendinput / pyautogui（默认 auto，自动选择最优后端）
- `movementStyle`: bezier / direct / human（默认 bezier）
- `moveSpeed`: slow / medium / fast / instant（默认 medium）
- `verifyClick`: 是否验证点击生效（默认 true）
- `maxRetries`: 失败重试次数（默认 2）

### screen_wait_for_element
等待指定 UI 元素出现，超时后可配置。

### screen_wait_for_stable
等待屏幕停止变化（加载动画/旋转图标结束）。

## 开发

### 命令

```bash
npm run dev          # 开发模式（tsx 热加载）
npm run build        # 编译到 dist/
npm test             # 运行测试 (vitest)
npm run typecheck    # TypeScript 类型检查
npm run check        # 完整检查（类型检查 + 测试 + 环境）
```

### 目录结构

```
screen-agent/
├── src/                    # TypeScript MCP Server
│   ├── engine/             # 核心引擎
│   │   ├── vision.ts       # 视觉扫描调度
│   │   ├── fusion.ts       # UIA+OCR 融合引擎
│   │   ├── input.ts        # 输入执行引擎
│   │   ├── window.ts       # 窗口跟踪引擎
│   │   └── context.ts      # 中央状态管理器
│   ├── guard/              # 精度守卫
│   │   ├── precision.ts    # 坐标验证 / 边界检测
│   │   ├── verify.ts       # 三级验证体系
│   │   ├── perception.ts   # 窗口感知元素查找
│   │   └── smoother.ts     # 点击坐标平滑
│   ├── tools/              # MCP 工具定义
│   │   ├── act.ts          # 操控入口
│   │   ├── discover.ts     # 扫描入口
│   │   ├── vision.ts       # 视觉入口
│   │   └── wait.ts         # 等待工具
│   └── utils/              # 工具函数
├── vision/                 # Python Sidecar
│   ├── omniparser.py       # OCR + 边缘精修
│   ├── uia_bridge.py       # UIA 树扫描
│   └── input_engine.py     # SendInput + 贝塞尔路径
├── scripts/                # 安装/检查脚本
├── dist/                   # TypeScript 编译产物
└── screenshots/            # 截图缓存
```

### 测试

8 个测试文件，102 个测试用例，覆盖：
- 上下文状态管理 (20)
- 窗口跟踪 (20)
- 输入验证 (11)
- 融合引擎 (8)
- 精度守卫 (17)
- 坐标平滑 (10)
- 感知查找 (12)
- 工具函数 (4)

## 技术要求

- **Windows 10/11 必需**：依赖 Win32 `SendInput` API 和 `UIA` (Windows Automation API)
- Python 子进程通过 stdio JSON 与 TypeScript MCP server 通信
- easyocr 首次运行需下载约 100MB 中英文模型
- 在无 pyautogui 时 SendInput 不可用时可能功能受限

## 许可

MIT
