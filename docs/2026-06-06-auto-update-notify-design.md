# Auto-Update 自动更新提示功能设计

## 背景

screen-agent（npm 全局安装）发布新版本后，用户无感知。需要自动检测新版本并提示用户更新，失败时给出手动更新指引。

## 约束

- 零新增 npm 依赖
- 不阻塞 MCP 服务器启动
- 异常静默处理（网络失败、JSON 解析失败等不影响主流程）
- 输出编码统一为 GBK + 宋体

## 方案：带缓存的版本检查 + 日志 + Windows 通知

### 架构

```
启动时 main()
  └─ 异步 checkForUpdate()
       ├─ 读取缓存 (~/.screen-agent/update-check.json)
       │   └─ 24h 内已检查 → 跳过
       ├─ HTTP GET registry.npmjs.org/screen-agent/latest
       │   ├─ 失败 → 静默，下次重试
       │   └─ 成功 → 写缓存
       ├─ 比对版本号
       │   └─ 相同 → 无操作
       ├─ logger.info() 打印更新提示
       └─ notification_show() Windows 系统通知
```

### 组件

#### `src/utils/update-checker.ts`

| 导出 | 类型 | 说明 |
|------|------|------|
| `checkForUpdate()` | `Promise<void>` | 入口，异步非阻塞 |
| `UpdateCache` | 接口 | `{ latestVersion, checkedAt }` |

#### 缓存文件 `${HOME}/.screen-agent/update-check.json`

```json
{
  "latestVersion": "0.2.0",
  "checkedAt": 1749199486000
}
```

- `checkedAt` > now - 24h → 跳过检查
- 文件不存在 → 正常检查
- 文件损坏（JSON parse 失败）→ 当不存在处理

#### npm registry 请求

```
GET https://registry.npmjs.org/screen-agent/latest
Accept: application/json
Response: { "version": "0.2.0", ... }
```

使用 Node.js 内置 `https` 模块，超时 5 秒。

#### 版本比较

使用 Node.js 内置 `semver` 比较？不，项目无 semver 依赖。直接用字符串分割比较（`major.minor.patch` 三段数字比较），或简单 `!==`（因 registry 只返回 latest，永远是 >= 当前版本）。

采用 `!==` 简单比较即可——registry 的 latest 总是 >= 当前。

#### Windows 通知

使用 `child_process.execFile` 调用 `powershell.exe` 弹原生 Toast 通知，零新增依赖。

```powershell
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = "screen-agent 更新可用"
$notify.BalloonTipText = "新版本 X.Y.Z 已发布。npm update -g screen-agent 升级。"
$notify.Visible = $true
$notify.ShowBalloonTip(5000)
Start-Sleep 5
$notify.Dispose()
```

如果执行失败（无桌面会话、WinRM 等），静默忽略。

#### 日志输出

```
info: ╔════════════════════════════════════════╗
info: ║  screen-agent 更新可用!                ║
info: ║  当前版本: 0.1.3                       ║
info: ║  最新版本: 0.2.0                       ║
info: ║                                        ║
info: ║  自动更新:                             ║
info: ║  npm update -g screen-agent            ║
info: ║                                        ║
info: ║  手动更新:                             ║
info: ║  npm install -g screen-agent@latest    ║
info: ╚════════════════════════════════════════╝
```

### 集成

`src/index.ts`，`main()` 末尾（server.connect 之后）：

```ts
import { checkForUpdate } from './utils/update-checker.js'

async function main() {
  // ... 现有代码 ...
  await server.connect(transport)
  checkForUpdate()  // 异步，不 await
}
```

### 错误处理策略

| 异常 | 处理 |
|------|------|
| 网络超时/失败 | 静默 catch，不写缓存，下次启动重试 |
| JSON 解析错误 | 静默 catch，缓存文件损坏则删除重写 |
| 通知失败 | 静默 catch |
| 缓存目录创建失败 | 静默，跳过缓存，下次重新检查 |

### 不做的功能

- 不自动执行 `npm update`（安全考虑，用户确认后再升级）
- 不强制弹窗或拦截使用
- 不检查 pre-release 版本（只检查 latest）
- 不上传任何用户数据

## 验证

1. `npm run typecheck` 通过
2. `npm test` 108 条测试全部通过
3. 手动模拟：修改 `APP_VERSION` 为 `0.0.1`，启动时应有提示
4. 缓存验证：第二次启动不应重复请求 npm
5. 网络断开验证：启动不应报错
