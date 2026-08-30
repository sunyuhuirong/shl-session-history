import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { realpathSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const GITHUB_REPO = 'sunyuhuirong/shl-session-history'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** 解符号链接得到插件真实源目录（符号链接 → ~/Desktop/deepseek-harness/plugin-shl）。
 *  host 加载的是 src/index.js，其父目录即插件根。realpathSync 解析符号链接，
 *  使后续的 git pull 作用在真实源目录而非 profile 内 node_modules 的软链上。 */
function getPluginSourceDir() {
  try {
    return realpathSync(__dirname).replace(/[/\\]src$/, '')
  } catch {
    return __dirname.replace(/[/\\]src$/, '')
  }
}

function readVersion(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0（仅比数字段）。 */
function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

const name = 'shl-session-history'

/** Settings schema for the host-side namespace the plugin registers.
 *  Exported so a test, an authoring script, or a sibling plugin can validate
 *  user documents offline; the runtime layer is owned by the service below. */
export const ShlSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  railStyle: z.union(['bar', 'dot']).default('bar'),
  railPosition: z.union(['left', 'right']).default('left'),
  autoHide: z.boolean().default(true),
  // 尺寸微调（用户自助）：gap 间距；dotSize 圆点大小；capLen 悬停胶囊长度；barLen 横线长度
  gap: z.number().default(6),
  dotSize: z.number().default(6),
  capLen: z.number().default(18),
  barLen: z.number().default(8)
})

/**
 * 纯 JS 手动应用 `@Remote()` 装饰器（Node 24 默认不支持 decorator 语法）。
 * 构造一个与 TC39 装饰器 context 等价的假 context，收集 addInitializer 回调，
 * 再以真实原型上的实例为 `this` 执行回调，使 `mark()` 写入 markers WeakMap。
 *
 * ⚠️ 协议依赖约束：本实现依赖 @deepseek-ai/dsh-typert-protocol 内部约定
 * （`addMarkerInitializer` 通过标准 `context.addInitializer` 注册标记写入）。
 * 升级该包后必须做一次 RPC 冒烟验证（getHistory / navigateToTurn / getCurrentSession
 * 可被 client 远程调用），若协议包调整内部实现，本 hack 会静默失效（不报错）。
 * 当前对齐版本：^0.1.1-rc.2（见 package.json peerDependencies）。
 *
 * 设置架构：host 端经 ctx.inject(['settings']) 注册 settings namespace
 * 'shl-session-history'（schema 见 ShlSettingsSchema），供设置页「插件配置」
 * tab 渲染配置卡片；client 端以 scope 为单源并镜像到 localStorage，rail
 * 渲染层从本地存储读取。注册与绑定均有容错包裹：settings 服务缺失的环境
 * 静默降级为纯 localStorage 模式，不影响核心 RPC 与滑轨功能。
 */
function collectRemoteInitializer(methodName) {
  const initializers = []
  const decoratorContext = {
    kind: 'method',
    name: methodName,
    private: false,
    static: false,
    addInitializer(fn) {
      initializers.push(fn)
    }
  }
  Remote(methodName)(undefined, decoratorContext)
  return initializers
}

class ShlService extends TypertRemoteService {
  static inject = ['sessionQuery']

  constructor(ctx, config) {
    super(ctx, 'shl')
    this._historyCache = null
    // 注册 settings namespace，让 ConfigurablePluginsTab 把本插件认作可服务
    // 的 namespace，settings.plugin.item 卡片才会被渲染。
    // 容错：settings 服务不可用或注册失败时静默降级（仅 warn），
    // 不阻塞服务构造，核心 RPC 不受影响。
    try {
      ctx.inject(['settings'], (settingsCtx) => {
        try {
          settingsCtx.settings.register(
            settingsNamespace('shl-session-history'),
            ShlSettingsSchema,
            { base: { enabled: true, railStyle: 'bar', railPosition: 'left', autoHide: true, gap: 6, dotSize: 6, capLen: 18, barLen: 8 } }
          )
        } catch (err) {
          console.warn('[shl] settings namespace registration skipped:', err && err.message ? err.message : err)
        }
      })
    } catch (err) {
      console.warn('[shl] settings inject unavailable:', err && err.message ? err.message : err)
    }
    for (const init of ShlService.remoteInitializers) init.call(this)
  }

  get sessionQuery() {
    return this.ctx.get('sessionQuery')
  }

  // ── 内容提取工具函数 ────────────────────────────────────────────
  extractTextFromBlocks(blocks) {
    if (!Array.isArray(blocks)) return null
    const lines = []
    for (const block of blocks) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        lines.push(block.text)
      }
    }
    return lines.join('\n') || null
  }

  extractUserContent(evt) {
    if (!evt || evt.type !== 'user/message') return null
    return this.extractTextFromBlocks(evt.data?.content)
  }

  isUserEvent(evt) {
    if (!evt || evt.type !== 'user/message') return false
    return evt.data && evt.data.source && evt.data.source.kind === 'user'
  }

  // ── 当前会话 ────────────────────────────────────────────────────
  get currentSessionId() {
    const agents = this.ctx.get('agents')
    if (agents) {
      try {
        const list = agents.list()
        if (Array.isArray(list) && list.length > 0) return list[0].id
      } catch {}
    }
    const sessions = this.ctx.get('sessions')
    if (sessions) {
      try {
        const list = sessions.list()
        if (Array.isArray(list) && list.length > 0) return list[0].id
      } catch {}
    }
    return null
  }

  // 优先用 sessionQuery.listSessions() 枚举真实会话（返回 record.header.id）
  async resolveSessionId() {
    const sessionQuery = this.sessionQuery
    if (sessionQuery && typeof sessionQuery.listSessions === 'function') {
      try {
        const records = await sessionQuery.listSessions()
        if (Array.isArray(records) && records.length > 0) {
          let best = records[0]
          for (const r of records) {
            const t = (r.header && (r.header.lastActivityAt ?? r.header.updatedAt)) || 0
            const bt = (best.header && (best.header.lastActivityAt ?? best.header.updatedAt)) || 0
            if (t > bt) best = r
          }
          const id = best.header && best.header.id
          if (id) return id
        }
      } catch {}
    }
    return this.currentSessionId
  }

  // ── live 会话直读（性能关键路径）────────────────────────────────
  // 打开中的会话在 host 内存里有活对象（sessions 服务），events 是冻结的
  // 追加只读快照（seq 连续、按序追加）——直接扫它零克隆；而 sessionQuery
  // readSession 每次调用要做 3 次全量 structuredClone + 逐事件校验/deepFreeze
  // （非 live 还要解压全量 .jsonl.zstd），大会话单次可占主进程 ~2s，与 2s
  // 轮询叠加会饿死其它插件的 RPC（如 web-ui-all 侧边栏）。因此 getHistory /
  // navigateToTurn 一律优先走这里，仅会话未挂载时回落 readSession。
  _getLiveSession(sessionId) {
    try {
      const sessions = this.ctx.get('sessions')
      if (sessions && typeof sessions.get === 'function') {
        const s = sessions.get(sessionId)
        if (s && Array.isArray(s.events)) return s
      }
    } catch {}
    return null
  }

  // 扫描 events[from..] 中的真实用户消息并追加到 items。轮次口径与
  // navigateToTurn 一致：仅统计「真实用户 + 文本内容非空」的事件，index =
  // 已累计条数——全量扫与后缀扫产出完全对齐，跳转索引不受增量影响。
  _appendUserItems(events, from, items) {
    for (let i = from; i < events.length; i++) {
      const evt = events[i]
      if (!this.isUserEvent(evt)) continue
      const content = this.extractUserContent(evt)
      if (!content) continue
      items.push({
        index: items.length,
        summary: content.length > 200 ? content.slice(0, 200) + '...' : content,
        // 唯一定位键：事件 ID。内核客户端把用户消息节点渲染为
        // data-chat-anchor-key = "13:input-message" + data.id
        // （conversationContextKey 拼接），两端无损对上——跳转不再依赖
        // 文本匹配或索引计数，重复消息也能唯一定位。
        id: evt && evt.data && evt.data.id != null ? String(evt.data.id) : undefined
      })
    }
  }

  // ── Remote 方法：获取会话历史请求列表 ────────────────────────────
  async getHistory(request) {
    const requestedSessionId = request && request.sessionId ? request.sessionId : null
    const resolved = await this.resolveSessionId()
    const sessionId = requestedSessionId || resolved
    const sessionQuery = this.sessionQuery
    const debug = {
      clientSessionId: requestedSessionId,
      resolvedSessionId: sessionId,
      currentSessionId: this.currentSessionId,
      sessionQueryExists: !!sessionQuery,
      eventCount: -1,
      sampleTypes: [],
      cached: false,
      err: null
    }
    if (!sessionId) return { items: [], sessionId: null, error: 'no session', debug }
    if (!sessionQuery) return { items: [], sessionId, error: 'sessionQuery unavailable', debug }
    try {
      // ── 快路径：live 会话直读内存事件 + 后缀增量扫描（零克隆，亚毫秒级）──
      // events 为追加只读快照（seq 连续），缓存记录已扫描前缀长度 eventCount，
      // 新事件只补扫尾部；日志变短等异常（fork/重放）走全量重扫自愈。
      const live = this._getLiveSession(sessionId)
      if (live) {
        const events = live.events
        const cache = this._historyCache
        debug.eventCount = events.length
        debug.live = true
        debug.sampleTypes = events.slice(0, 6).map((e) => (e && e.type) || typeof e)
        if (cache && cache.sessionId === sessionId && cache.eventCount <= events.length) {
          if (cache.eventCount === events.length) {
            debug.cached = true
            return { items: cache.items, sessionId, debug }
          }
          this._appendUserItems(events, cache.eventCount, cache.items)
          cache.eventCount = events.length
          debug.cached = true
          return { items: cache.items, sessionId, debug }
        }
        const items = []
        this._appendUserItems(events, 0, items)
        this._historyCache = { sessionId, eventCount: events.length, items }
        return { items, sessionId, debug }
      }
      // ── 慢路径：会话未挂载（罕见），readSession 全量快照 ─────────────
      const { events } = await sessionQuery.readSession(sessionId)
      debug.eventCount = Array.isArray(events) ? events.length : -1
      debug.sampleTypes = (events || []).slice(0, 6).map((e) => (e && e.type) || typeof e)
      const items = []
      if (Array.isArray(events)) this._appendUserItems(events, 0, items)
      this._historyCache = { sessionId, eventCount: debug.eventCount, items }
      return { items, sessionId, debug }
    } catch (err) {
      debug.err = String(err)
      return { items: [], sessionId, error: String(err), debug }
    }
  }

  // ── Remote 方法：定位到指定轮次 ──────────────────────────────────
  async navigateToTurn(request) {
    const { sessionId, turnIndex } = request || {}
    const targetSession = sessionId || (await this.resolveSessionId())
    if (!targetSession) return { ok: false, error: 'no session' }
    const sessionQuery = this.sessionQuery
    if (!sessionQuery) return { ok: false, error: 'sessionQuery unavailable' }
    try {
      // 优先 live 直读（零克隆，大会话省 ~2s 主进程阻塞），未挂载才走 readSession
      const live = this._getLiveSession(targetSession)
      if (live) return this._locateTurn(live.events, turnIndex)
      const { events } = await sessionQuery.readSession(targetSession)
      return this._locateTurn(events, turnIndex)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  // 轮次口径必须与 getHistory 一致：仅统计「真实用户 + 文本内容非空」的事件，
  // 否则会话中存在无文本用户事件（如仅发图片/附件）时索引会错位。
  _locateTurn(events, turnIndex) {
    if (!Array.isArray(events)) return { ok: false, error: 'no events' }
    let userCount = 0
    for (let i = 0; i < events.length; i++) {
      const evt = events[i]
      if (!this.isUserEvent(evt)) continue
      if (!this.extractUserContent(evt)) continue
      if (userCount === turnIndex) {
        return { ok: true, eventSeq: i, turnIndex }
      }
      userCount++
    }
    return { ok: false, error: 'turn not found' }
  }

  // ── Remote 方法：获取当前会话 ────────────────────────────────────
  async getCurrentSession() {
    return { sessionId: await this.resolveSessionId() }
  }

  // ── Remote 方法：读取当前版本号 ──────────────────────────────────
  // 不联网——直接读 plugin 真实源目录的 package.json#version，供客户端
  // 在设置卡片标题中显示"会话滑轨 v1.0.0"，与「插件市场」卡片对齐样式。
  async getVersion() {
    return { version: readVersion(getPluginSourceDir()) }
  }

  // ── Remote 方法：检查更新 ────────────────────────────────────────
  // 拉取 GitHub Releases latest，与本地 package.json#version 比对。
  // 返回 { current, latest, releaseUrl, updateAvailable, error }。
  async checkForUpdate() {
    const current = readVersion(getPluginSourceDir())
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const res = await fetch(GITHUB_API, {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'shl-session-history'
        }
      })
      clearTimeout(timer)
      if (res.status === 404) {
        // 仓库尚未发布过 release → 视为已是最新（latest 与 current 相等）
        return { current, latest: current, releaseUrl: null, updateAvailable: false, error: null }
      }
      if (!res.ok) {
        return { current, latest: null, releaseUrl: null, updateAvailable: false, error: `GitHub API ${res.status}` }
      }
      const data = await res.json()
      const latest = String(data.tag_name || '').replace(/^v/i, '') || current
      const updateAvailable = compareVersion(latest, current) > 0
      return { current, latest, releaseUrl: data.html_url || null, updateAvailable, error: null }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      return { current, latest: null, releaseUrl: null, updateAvailable: false, error: msg }
    }
  }

  // ── Remote 方法：执行更新 ────────────────────────────────────────
  // 在插件真实源目录（解符号链接后）跑 git pull --ff-only；若 package.json
  // 在 pull 前后有变化则补跑 npm install。返回 { ok, dir, before, after, output, installOut, error }。
  // ⚠️ 不可逆：会改写源目录工作区（未跟踪文件保留，已修改文件可能被 fast-forward 覆盖）。
  async applyUpdate() {
    const dir = getPluginSourceDir()
    const before = readVersion(dir)
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 10000 })
    } catch {
      return {
        ok: false,
        dir,
        before,
        after: before,
        output: '',
        installOut: '',
        error: '源目录不是 git 仓库，无法自动更新（请手动 git clone 后重装）'
      }
    }
    try {
      const pull = await execFileAsync('git', ['pull', '--ff-only'], {
        cwd: dir,
        timeout: 60000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      })
      const after = readVersion(dir)
      // 是否需要 npm install：git pull 前后对比 HEAD 看 package.json 是否变更
      let installOut = ''
      let npmChanged = false
      try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD@{1}', 'HEAD'], {
          cwd: dir,
          timeout: 10000,
          encoding: 'utf8'
        })
        npmChanged = String(stdout).split('\n').includes('package.json')
      } catch {}
      if (npmChanged) {
        const r = await execFileAsync('npm', ['install'], {
          cwd: dir,
          timeout: 120000,
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024
        })
        installOut = r.stdout
      }
      return { ok: true, dir, before, after, output: pull.stdout, installOut, error: null }
    } catch (err) {
      const msg = err && err.stderr ? err.stderr : err && err.message ? err.message : String(err)
      return { ok: false, dir, before, after: before, output: '', installOut: '', error: msg }
    }
  }
}

ShlService.remoteInitializers = [
  ...collectRemoteInitializer('getHistory'),
  ...collectRemoteInitializer('navigateToTurn'),
  ...collectRemoteInitializer('getCurrentSession'),
  ...collectRemoteInitializer('getVersion'),
  ...collectRemoteInitializer('checkForUpdate'),
  ...collectRemoteInitializer('applyUpdate')
]

export default ShlService
export { name, ShlService }
