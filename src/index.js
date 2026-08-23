import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

const name = 'shl-session-history'

/** Settings schema for the host-side namespace the plugin registers.
 *  Exported so a test, an authoring script, or a sibling plugin can validate
 *  user documents offline; the runtime layer is owned by the service below. */
export const ShlSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  railStyle: z.union(['bar', 'dot']).default('bar'),
  autoHide: z.boolean().default(true)
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
 * 注意：host 端保持最小依赖（仅 dsh-typert-protocol）。设置（开关/样式）为纯
 * client 端行为，存于浏览器 localStorage，不经过 host，避免 host 引入额外依赖。
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
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.register(
        settingsNamespace('shl-session-history'),
        ShlSettingsSchema,
        { base: { enabled: true, railStyle: 'bar', autoHide: true } }
      )
    })
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

  // live 会话可 O(1) 取事件数（无需克隆/落盘），用于增量判断
  _getLiveEventCount(sessionId) {
    try {
      const sessions = this.ctx.get('sessions')
      if (sessions && typeof sessions.get === 'function') {
        const s = sessions.get(sessionId)
        if (s && Array.isArray(s.events)) return s.events.length
      }
    } catch {}
    return null
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
      // 增量：live 会话事件数未变化时直接复用缓存，跳过 readSession 与全量重扫
      const liveCount = this._getLiveEventCount(sessionId)
      if (
        this._historyCache &&
        this._historyCache.sessionId === sessionId &&
        liveCount !== null &&
        this._historyCache.eventCount === liveCount
      ) {
        debug.eventCount = liveCount
        debug.cached = true
        return { items: this._historyCache.items, sessionId, debug }
      }
      const { events } = await sessionQuery.readSession(sessionId)
      debug.eventCount = Array.isArray(events) ? events.length : -1
      debug.sampleTypes = (events || []).slice(0, 6).map((e) => (e && e.type) || typeof e)
      const items = []
      if (Array.isArray(events)) {
        let turnIndex = 0
        for (let i = 0; i < events.length; i++) {
          const evt = events[i]
          if (this.isUserEvent(evt)) {
            const content = this.extractUserContent(evt)
            if (content) {
              items.push({
                index: turnIndex,
                summary: content.length > 200 ? content.slice(0, 200) + '...' : content
              })
              turnIndex++
            }
          }
        }
      }
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
      const { events } = await sessionQuery.readSession(targetSession)
      if (!Array.isArray(events)) return { ok: false, error: 'no events' }
      // 轮次口径必须与 getHistory 一致：仅统计「真实用户 + 文本内容非空」的事件，
      // 否则会话中存在无文本用户事件（如仅发图片/附件）时索引会错位。
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
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  // ── Remote 方法：获取当前会话 ────────────────────────────────────
  async getCurrentSession() {
    return { sessionId: await this.resolveSessionId() }
  }
}

ShlService.remoteInitializers = [
  ...collectRemoteInitializer('getHistory'),
  ...collectRemoteInitializer('navigateToTurn'),
  ...collectRemoteInitializer('getCurrentSession')
]

export default ShlService
export { name, ShlService }
