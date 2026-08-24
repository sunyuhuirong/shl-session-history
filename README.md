# Session History Locator (shl)

在 DeepSeek Harness 桌面客户端添加**会话历史请求迷你滑轨**，参考 ZCode 的交互模式：对话区左侧垂直居中的短横线，每条横线代表一条用户请求；鼠标悬停时横线变长并以浮动小窗显示该条请求的摘要，点击跳转到对应对话位置。以 **bundle npm 包**形式安装到桌面插件管理器。

## 功能

- ✅ 左侧垂直居中的迷你滑轨，每条记录 = 一条短横线
- ✅ 样式可切换：横线 ↔ 圆点（设置页「插件配置」卡片中修改），圆点模式悬停时变长，实时生效并本地持久化
- ✅ 插件开关：设置页可随时开启/关闭滑轨，关闭时不再渲染与拉取历史
- ✅ 鼠标悬停：横线变长 + 以悬停处为轴心向两侧渐短渐淡（波浪渐变），并弹出带背景的浮动窗口显示完整请求摘要
- ✅ 点击跳转：滚动到对话中对应的用户消息位置；目标轮次尚未加载时自动点击主包「加载更早」直至定位
- ✅ 高亮跟随悬停位置（非固定高亮当前消息）
- ✅ 2 秒自动刷新，仅数据变化时重建 DOM（不打断悬停交互）
- ✅ 仅显示真实用户请求（按事件 `source.kind === 'user'` 过滤系统注入消息）
- ✅ 自动隐藏（可在设置「自动隐藏」开关控制）：开启时，滑轨与对话内容太近/重叠即自动隐藏（避免遮挡文字），窗口变宽或内容移开后自动恢复；基于 `elementFromPoint` 检测（滑轨 `pointer-events:none` 可"看穿"取到下方真实内容）
- ✅ 尺寸自助微调（设置卡片滑块）：**间距**始终可调；横线模式额外可调**横线长度**，圆点模式额外可调**圆点大小**与**悬停胶囊长度**。改完实时生效并本地持久化（CSS 变量驱动：--shl-gap / --shl-dot / --shl-cap / --shl-bar）
- ✅ 更新入口（设置卡片「更新」行）：打开设置即自动检查 GitHub Releases，有新版本提示「更新」并可一键拉取（`git pull`）；更新源为 [sunyuhuirong/shl-session-history](https://github.com/sunyuhuirong/shl-session-history)。不做更新通道/卸载（保持单卡片、最小改动）

## 文件结构

```
plugin-shl/
├── package.json        # bundle 元数据（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml    # 注册行：- insert: - id / name
├── src/
│   └── index.js        # Host 端：TypertRemoteService + 手动 Remote 标记
├── lib/
│   └── client.js       # Client 端：__ModuleLoader__.load bundle 格式
└── README.md
```

## 安装方式（桌面插件管理器）

在插件管理器中选择「Browse folder / 安装本地文件夹」选择本目录即可。

或命令行安装：

```sh
dsh plugin --profile desktop add /path/to/plugin-shl
```

## 依赖说明（重要）

本插件是 **bundle 插件**，`@deepseek-ai/*` peer 依赖由 DeepSeek Harness 主应用运行时提供，**通过插件管理器安装时无需 `npm install`**，请勿在插件目录手动重装依赖（会破坏与主应用 runtime 的版本对齐）。

- 不提供 `package-lock.json`：registry 上 `@deepseek-ai` 各 rc 版本间的 peer 依赖组合互相冲突（实测标准 `npm install` 报 ERESOLVE，无法独立解析整棵依赖树）。
- 独立开发时可尝试 `npm install --legacy-peer-deps`，但解析出的版本组合可能与主应用 runtime 不一致，运行时以主应用实际提供的版本为准。
- 升级主应用后，建议重新加载本插件并做一次 RPC 冒烟验证（三个远程方法可被 client 调用，见 `src/index.js` 头部注释）。

## 架构

- **Host 端** (`src/index.js`)：`ShlService extends TypertRemoteService`，通过 `super(ctx, 'shl')` 注册服务；用纯 JS 手动调用 `Remote('method')` 等价于 `@Remote()` 装饰器（Node 24 默认不支持 decorator 语法），标记 `getHistory` / `navigateToTurn` / `getCurrentSession` 三个远程方法。数据源：`sessionQuery.readSession(sessionId)` 读取完整事件（含 `data`），按事件 `source.kind === 'user'` 过滤出真实用户请求。同时注入 `settings` 服务，注册 settings namespace `shl-session-history`（schema: `{ enabled: bool = true, railStyle: 'bar'|'dot' = 'bar' }`），让设置页「插件配置」tab 把本插件认作可配置的已 serve namespace。
- **Client 端** (`lib/client.js`)：`window.__ModuleLoader__.load({ id, factory })` bundle 格式，导出 `{ apply, inject }`；通过 `ctx.connection.rpc.call('/api', 'shl/<method>', { args: { request: {...} } })` 调用 host；纯 DOM + `document.createElement('style')` 注入样式与悬浮窗口（append 到 `document.body`，`position: fixed` 按滚动容器矩形计算定位）。设置（开关 / 样式）走 `ctx.settingsScope.bind({ namespace: 'shl-session-history' })` ——卡片注册到 `settings.plugin.item` slot（与终端/Agent 循环/网页搜索同处「插件配置」tab 内以可折叠卡片呈现），`ShlSettingsCard` 读 snapshot、`props.setEnabled` / `props.setRailStyle` 写回到 host settings。Host 的 settings/updated 事件通过订阅 → 同步镜像到 `localStorage`，保持 rail 渲染层从本地存储读取的兼容路径。

## RPC 接口（Host → Remote）

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `getHistory` | `{ sessionId? }` | `{ items, sessionId, debug?, error? }` | 获取会话历史请求列表 |
| `navigateToTurn` | `{ sessionId, turnIndex }` | `{ ok, eventSeq?, error? }` | 定位到指定轮次 |
| `getCurrentSession` | 无 | `{ sessionId }` | 获取当前活跃会话 |

Client 端远程调用返回包装：`{ ok: true, value }` 或 `{ ok: false, error }`。

## 主题适配

所有样式使用 DSH 主题 token，自动适配亮色/暗色模式（带 fallback 值）：

- `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2`
- `--dsw-alias-border-l2`
- `--dsw-alias-brand-primary`
- `--dsw-alias-label-primary` / `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary`