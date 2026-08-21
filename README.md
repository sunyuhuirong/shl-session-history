# Session History Locator (shl)

在 DeepSeek Harness 桌面客户端添加**会话历史请求迷你滑轨**，参考 ZCode 的交互模式：对话区左侧垂直居中的短横线，每条横线代表一条用户请求；鼠标悬停时横线变长并以浮动小窗显示该条请求的摘要，点击跳转到对应对话位置。以 **bundle npm 包**形式安装到桌面插件管理器。

## 功能

- ✅ 左侧垂直居中的迷你滑轨，每条记录 = 一条短横线
- ✅ 鼠标悬停：横线变长 + 以悬停处为轴心向两侧渐短渐淡（波浪渐变），并弹出带背景的浮动窗口显示完整请求摘要
- ✅ 点击跳转：滚动到对话中对应的用户消息位置
- ✅ 高亮跟随悬停位置（非固定高亮当前消息）
- ✅ 2 秒自动刷新，仅数据变化时重建 DOM（不打断悬停交互）
- ✅ 仅显示真实用户请求（按事件 `source.kind === 'user'` 过滤系统注入消息）

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

- **Host 端** (`src/index.js`)：`ShlService extends TypertRemoteService`，通过 `super(ctx, 'shl')` 注册服务；用纯 JS 手动调用 `Remote('method')` 等价于 `@Remote()` 装饰器（Node 24 默认不支持 decorator 语法），标记 `getHistory` / `navigateToTurn` / `getCurrentSession` 三个远程方法。数据源：`sessionQuery.readSession(sessionId)` 读取完整事件（含 `data`），按事件 `source.kind === 'user'` 过滤出真实用户请求。
- **Client 端** (`lib/client.js`)：`window.__ModuleLoader__.load({ id, factory })` bundle 格式，导出 `{ apply, inject }`；通过 `ctx.connection.rpc.call('/api', 'shl/<method>', { args: { request: {...} } })` 调用 host；纯 DOM + `document.createElement('style')` 注入样式与悬浮窗口（append 到 `document.body`，`position: fixed` 按滚动容器矩形计算定位）。

## RPC 接口（Host → Remote）

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `getHistory` | `{ sessionId? }` | `{ items, sessionId, debug?, error? }` | 获取会话历史请求列表 |
| `navigateToTurn` | `{ sessionId, turnIndex }` | `{ ok, eventSeq?, error? }` | 定位到指定轮次 |

Client 端远程调用返回包装：`{ ok: true, value }` 或 `{ ok: false, error }`。

## 主题适配

所有样式使用 DSH 主题 token，自动适配亮色/暗色模式（带 fallback 值）：

- `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-2`
- `--dsw-alias-border-l2`
- `--dsw-alias-brand-primary`
- `--dsw-alias-label-primary` / `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary`