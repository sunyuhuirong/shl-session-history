# shl-session-history

在 DeepSeek Harness 对话区左侧添加迷你历史滑轨：悬停显示摘要，点击跳转历史请求位置。

## 目录

- [功能](#功能)
- [截图](#截图)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [常见问题](#常见问题)
- [架构](#架构)
- [版本历史](#版本历史)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 功能

- 左侧垂直居中的迷你滑轨，每条记录 = 一条短横线（或圆点）
- 样式可切换：横线 ↔ 圆点（设置页「插件配置」卡片中修改），改完实时生效并本地持久化
- 鼠标悬停：横线变长 + 以悬停处为轴心向两侧渐短渐淡（波浪渐变），弹出浮动窗口显示完整请求摘要
- 点击跳转：滚动到对话中对应的用户消息位置；目标轮次未加载时自动点击「加载更早」直至定位
- 高亮跟随悬停位置（非固定高亮当前消息）
- 2 秒自动刷新，仅数据变化时重建 DOM（不打断悬停交互）
- 仅显示真实用户请求（过滤系统注入消息）
- 自动隐藏：滑轨与对话内容太近/重叠时自动隐藏，避免遮挡文字
- 尺寸自助微调：间距 / 横线长度 / 圆点大小 / 悬停胶囊长度均可通过滑块调整
- 更新入口：设置卡片自动检查 GitHub Releases，有新版本可一键拉取

## 截图

| 截图 | 说明 |
|------|------|
| ![会话滑轨概览](docs/screenshots/01-overview.png) | 侧边栏会话列表中滑轨以横线形式显示各历史请求，悬停变长并弹出摘要。 |
| ![设置面板](docs/screenshots/02-settings-panel.png) | 插件配置卡片：开关 / 样式切换 / 间距与长度微调均在「设置 → 插件」页完成。 |
| ![圆点模式](docs/screenshots/03-rail-dot-mode.png) | 切换到圆点样式后，滑轨变为竖向圆点，大小随会话新旧渐淡；悬停时胶囊变长。 |

## 安装

在 DeepSeek Harness 桌面客户端中，打开「插件市场」选择「Browse folder / 安装本地文件夹」，
选择本仓库目录即可。

命令行方式：

```sh
dsh plugin --profile desktop add /path/to/shl-session-history
```

> **注意**：本插件是 bundle 插件，`@deepseek-ai/*` peer 依赖由主应用运行时提供，
> **无需 `npm install`**，请勿在插件目录手动重装依赖。

## 使用

安装完成后，设置页「插件 → 会话滑轨」卡片即出现。默认启用，滑轨会随会话内容同步出现。

- **开启/关闭**：拨动「启用滑轨」开关
- **切换样式**：点击「横线」或「圆点」按钮
- **调整尺寸**：拖动对应滑块，数值即时生效并持久化到本地
- **跳转历史**：点击滑轨任意条目，对话区滚动到对应请求位置

## 配置

所有配置项在设置页「插件配置 → 会话滑轨」卡片中完成：

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| 启用滑轨 | 开关 | 开 | 总开关，关闭后不渲染也不拉取历史 |
| 自动隐藏 | 开关 | 开 | 滑轨与内容重叠时自动隐藏 |
| 滑轨样式 | 单选 | 横线 | 横线 / 圆点两种样式 |
| 间距 | 滑块 | 6px | 相邻条目之间的垂直间距（2–24px） |
| 横线长度 | 滑块 | 8px | 横线模式下的条目长度（4–28px） |
| 圆点大小 | 滑块 | 6px | 圆点模式下的直径（4–16px） |
| 胶囊长度 | 滑块 | 18px | 圆点模式悬停时的最大长度（8–48px） |

## 常见问题

**Q: 切换会话后间距/圆点大小设置失效？**

A: v1.1.1 已修复。此前因内核重挂载机制导致新会话节点未继承尺寸变量，现已在挂载时立即写入。如仍复现，请确认已更新至 v1.1.1。

**Q: 滑轨不显示或显示为默认尺寸？**

A: 检查设置页「启用滑轨」是否开启；刷新页面（Cmd+R）让最新代码生效。

**Q: 如何升级插件？**

A: 设置页「会话滑轨」卡片底部有「检查更新」按钮，或运行：
```sh
dsh plugin --profile desktop update shl-session-history
```

## 架构

**Host 端**（`src/index.js`）：`ShlService extends TypertRemoteService`，注册三个远程方法
`getHistory` / `navigateToTurn` / `getCurrentSession`，数据源为 `sessionQuery.readSession()`，
同时注册 settings namespace `shl-session-history` 供设置卡片读取。

**Client 端**（`lib/client.js`）：`__ModuleLoader__.load` bundle 格式，通过 RPC 调用 Host，
纯 DOM 注入滑轨节点与悬浮窗，CSS 变量驱动尺寸（`--shl-gap` / `--shl-dot` / `--shl-cap` / `--shl-bar`）。
设置卡片通过 `ctx.settingsScope` 订阅 Host snapshot，变更时同步镜像到 localStorage。

## 文件结构

```
shl-session-history/
├── package.json           # bundle 元数据（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml       # 注册行：- insert: - id / name
├── README.md
├── src/
│   └── index.js           # Host 端：TypertRemoteService + 手动 Remote 标记
├── lib/
│   └── client.js          # Client 端：__ModuleLoader__.load bundle 格式
└── docs/
    └── screenshots/       # 功能截图
        ├── 01-overview.png
        ├── 02-settings-panel.png
        └── 03-rail-dot-mode.png
```

## 版本历史

- **v1.1.2** — 修复设置卡片深色模式适配：选中按钮「白底白字」不可读、开关拇指反差丢失；改用内核配对 token（`brand-primary` + `label-primary-foreground`）随主题自动反转；修正错误提示色 token 名（`state-error-primary`）
- **v1.1.1** — 修复切换会话后间距/圆点大小设置失效的 bug
- **v1.1.0** — 新增尺寸微调滑块、设置卡片版本号显示、一键更新入口
- **v1.0.0** — 初始版本，基础滑轨功能

## 参与贡献

欢迎提交 Issue 和 PR。开发前请先阅读 [AGENTS.md](../AGENTS.md) 了解本仓库规范。

## 许可证

[MIT](LICENSE)
