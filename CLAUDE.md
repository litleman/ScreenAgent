# Screen Agent — 开发指南

## 目录结构
- `src/` — TypeScript MCP server
- `vision/` — Python 视觉 + 输入 sidecar
- `dist/` — 编译产物

## 开发命令
- `npm run dev` — tsx 直接运行（调试用）
- `npm run build` — tsc 编译
- `npm test` — 跑测试
- `npm run typecheck` — 类型检查
- `npm run check` — 完整检查（类型 + 测试）

## Python 环境
- 必须安装: pywinauto, Pillow, numpy, opencv-python, easyocr
- 可选: pyautogui
- `pip install -r requirements.txt`

## MCP 配置
安装后运行 `npm run configure`，交互选择客户端（Claude Desktop / OpenCode / Cursor / Windsurf），自动生成对应配置。

```json
{
  "mcpServers": {
    "screen-agent": {
      "command": "node",
      "args": ["D:/path/to/screen-agent/dist/index.js"],
      "env": { "SCREEN_AGENT_PYTHON": "python" }
    }
  }
}
```

## 工具列表
- `screen_discover` — 扫描所有交互元素（OCR+UIA 融合）
- `screen_vision` — 视觉分析
- `screen_act` — 执行点击/输入/按键
- `screen_wait_for_element` — 等待元素出现
- `screen_wait_for_stable` — 等待屏幕稳定

## 关键文件
- `src/engine/fusion.ts` — UIA+OCR 融合引擎
- `src/engine/input.ts` — 输入调度
- `src/guard/smoother.ts` — 点击坐标平滑
- `vision/input_engine.py` — SendInput + 贝塞尔路径 + 点击验证
- `vision/omniparser.py` — OCR + 边缘精修
- `vision/uia_bridge.py` — UIA 树扫描
