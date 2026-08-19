import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

const name = 'shl-session-history'

/**
 * 纯 JS 手动应用 `@Remote()` 装饰器（Node 24 默认不支持 decorator 语法）。
 * 构造一个与 TC39 装饰器 context 等价的假 context，收集 addInitializer 回调，
 * 再以真实原型上的实例为 `this` 执行回调，使 `mark()` 写入 markers WeakMap。
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

  extractAiContent(evt) {
    if (!evt || evt.type !== 'assistant/message') return null
    return this.extractTextFromBlocks(evt.data?.message?.content)
  }

  isUserEvent(evt) {
    if (!evt || evt.type !== 'user/message') return false
    return evt.data && evt.data.source && evt.data.source.kind === 'user'
  }

  isAiEvent(evt) {
    return evt.type === 'assistant/message'
  }

  formatTime(timestamp) {
    if (!timestamp) return ''
    try {
      const d = new Date(Number(timestamp))
      if (isNaN(d.getTime())) return ''
      const h = d.getHours().toString().padStart(2, '0')
      const m = d.getMinutes().toString().padStart(2, '0')
      return h + ':' + m
    } catch {
      return ''
    }
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

  // ── Remote 方法：获取会话历史请求列表 ────────────────────────────
  async getHistory(request) {
    const requestedSessionId = request && request.sessionId ? request.sessionId : null
    const resolved = await this.resolveSessionId()
    const sessionId = requestedSessionId || resolved
    const sessionQuery = this.sessionQuery
    const debug = {
      clientSessionId: request && request.sessionId ? request.sessionId : null,
      resolvedSessionId: sessionId,
      currentSessionId: this.currentSessionId,
      sessionQueryExists: !!sessionQuery,
      eventCount: -1,
      sampleTypes: [],
      err: null
    }
    if (!sessionId) return { items: [], sessionId: null, error: 'no session', debug }
    if (!sessionQuery) return { items: [], sessionId, error: 'sessionQuery unavailable', debug }
    try {
      const { events } = await sessionQuery.readSession(sessionId)
      debug.eventCount = Array.isArray(events) ? events.length : -1
      debug.sampleTypes = (events || []).slice(0, 6).map((e) => (e && e.type) || typeof e)
      const items = []
      if (Array.isArray(events)) {
        let turnIndex = 0
        let awaitingAiResponse = false
        for (let i = 0; i < events.length; i++) {
          const evt = events[i]
          if (this.isUserEvent(evt)) {
            const content = this.extractUserContent(evt)
            if (content) {
              items.push({
                index: turnIndex,
                summary: content.length > 80 ? content.slice(0, 80) + '...' : content,
                fullUser: content,
                fullAi: '',
                time: this.formatTime(evt.time),
                eventSeq: i,
                awaitingAi: true
              })
              turnIndex++
              awaitingAiResponse = true
            }
          } else if (awaitingAiResponse && items.length > 0 && this.isAiEvent(evt)) {
            const aiContent = this.extractAiContent(evt)
            if (aiContent) {
              const lastItem = items[items.length - 1]
              if (lastItem && lastItem.awaitingAi) {
                lastItem.fullAi = aiContent.length > 300 ? aiContent.slice(0, 300) + '...' : aiContent
                lastItem.awaitingAi = false
                awaitingAiResponse = false
              }
            }
          }
        }
      }
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
      let userCount = 0
      for (let i = 0; i < events.length; i++) {
        const evt = events[i]
        if (this.isUserEvent(evt)) {
          if (userCount === turnIndex) {
            return { ok: true, eventSeq: i, turnIndex }
          }
          userCount++
        }
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