window.__ModuleLoader__.load({
	id: "shl-session-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var react_jsx_runtime = require("react/jsx-runtime");

		// 'settingsScope' 由 '@deepseek-ai/dsh-client-ui-settings'（已在
		// package.json dsh.client.inject 声明）暴露到 ctx.settingsScope.bind()；
		// 卡片注册位置选择：settings.plugin.item（与终端/Agent 循环同一外观）。
		const inject = ["slots", "connection", "remote", "settingsScope"];

		function apply(ctx) {
			const connection = ctx.connection;

			// 绑定 settings namespace 'shl-session-history' —— host 端 ShlService
			// 已在 ctx.inject(['settings']) 中注册该 namespace（见 src/index.js）。
			// 此处读到的 snapshot 是 schema 解析后的 { enabled, railStyle, autoHide }。
			// 容错：settingsScope 服务不可用（旧版/精简部署）时降级为纯 localStorage
			// 模式——滑轨核心功能不受影响，仅设置卡片不渲染。
			let settingsScope = null;
			try {
				settingsScope = ctx.settingsScope
					? ctx.settingsScope.bind({ namespace: "shl-session-history" })
					: null;
			} catch {
				settingsScope = null;
			}

			// ── 与主包 DOM 结构的耦合点：所有选择器集中于此 ──────────────
			// 主包升级改变 DOM 结构时，优先检查并更新这里的约定。
			const SELECTORS = {
				conversationScroll: "[data-conversation-scroll]", // 对话滚动容器（用于定位 rail 与跳转）
				userMessage: '[data-chat-flow-kind="user"]', // 用户消息节点，顺序与 host 的 turn 索引对齐
				dialog: '[role="dialog"]', // 模态弹窗
				settingsModal: '[class*="SettingsModal"]' // 设置弹窗
			};

			// ── CSS：ZCode 风格左侧迷你滑轨（每条记录=一条短横线，悬停弹出带背景的小窗显示摘要）──
			const style = document.createElement("style");
			style.dataset.shl = "true";
			style.textContent = `
			.shlrail_fixed {
				position: fixed;
				z-index: 30;
				left: 0;
				top: 0;
				display: flex;
				flex-direction: column;
				padding: 6px;
				box-sizing: border-box;
				overflow: visible;
				pointer-events: none;
				font-family: inherit;
			}
				.shlrail_scroll {
					pointer-events: auto;
					display: flex;
					flex-direction: column;
					gap: var(--shl-gap, 6px);
					max-height: calc(100vh - 52px);
					overflow-y: auto;
					overflow-x: visible;
					padding: 2px 6px 2px 0;
					scrollbar-width: none;
				}
				.shlrail_scroll::-webkit-scrollbar {
					display: none;
				}
				.shlrail_row {
					flex: none;
					display: flex;
					align-items: center;
					cursor: pointer;
					padding: 2px 0;
					position: relative;
					min-width: 36px;
				}
				.shlrail_row::before {
					content: "";
					position: absolute;
					left: 0;
					right: 0;
					top: -7px;
					bottom: -7px;
				}
				.shlrail_tick {
					flex: none;
					width: var(--shl-bar, 8px);
					height: 2px;
					border-radius: 1px;
					background: var(--dsw-alias-label-tertiary, #777);
					opacity: 0.65;
					transform-origin: left center;
					transition: transform 0.15s ease, width 0.15s ease, background 0.15s ease, opacity 0.15s ease;
				}
				.shlrail_tick.lvl0 {
					transform: scaleX(2.5714);
					background: var(--dsw-alias-brand-primary, #4f8cff);
					opacity: 1;
				}
				.shlrail_tick.lvl1 {
					transform: scaleX(1.7143);
					opacity: 0.85;
				}
				.shlrail_tick.lvl2 {
					transform: scaleX(1.4286);
					opacity: 0.65;
				}
				.shlrail_tick.lvl3 {
					transform: scaleX(1.1428);
					opacity: 0.45;
				}
				.shlrail_tick.lvl4 {
					transform: scaleX(1);
					opacity: 0.28;
				}
				/* ── 圆点模式：默认圆点靠左对齐；悬停（波浪级 lvl0-4）时变为胶囊并向右变长 ── */
				/* 不用 scaleX 拉伸圆（会变形），改为显式 width 形成干净胶囊、长度随级别增长 */
				/* 尺寸由 CSS 变量驱动：--shl-dot 圆点直径，--shl-cap 悬停胶囊长度（lvl0） */
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick {
					width: var(--shl-dot, 6px);
					height: var(--shl-dot, 6px);
					border-radius: 50%;
					margin: 0;
				}
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick.lvl0 {
					width: var(--shl-cap, 18px);
					border-radius: 3px;
					transform: none;
					background: var(--dsw-alias-brand-primary, #4f8cff);
					opacity: 1;
				}
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick.lvl1 {
					width: calc(var(--shl-cap, 18px) * 0.6667);
					border-radius: 3px;
					transform: none;
					opacity: 0.85;
				}
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick.lvl2 {
					width: calc(var(--shl-cap, 18px) * 0.5556);
					border-radius: 3px;
					transform: none;
					opacity: 0.65;
				}
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick.lvl3 {
					width: calc(var(--shl-cap, 18px) * 0.4444);
					border-radius: 3px;
					transform: none;
					opacity: 0.45;
				}
				.shlrail_fixed[data-shl-style="dot"] .shlrail_tick.lvl4 {
					width: var(--shl-dot, 6px);
					border-radius: 50%;
					transform: none;
					opacity: 0.28;
				}
				.shlrail_tooltip {
					position: fixed;
					z-index: 40;
					max-width: 280px;
					max-height: 140px;
					overflow: auto;
					padding: 8px 10px;
					border: 1px solid var(--dsw-alias-border-l2, #333);
					border-radius: 8px;
					background: var(--dsw-alias-bg-layer-1, rgba(28,28,28,0.96));
					box-shadow: 0 2px 8px rgba(0,0,0,0.18);
					color: var(--dsw-alias-label-primary, #eee);
					font-size: 12px;
					line-height: 1.5;
					white-space: pre-wrap;
					word-break: break-word;
					pointer-events: none;
				}
			`;
			document.head.appendChild(style);

			function waitMs(ms) {
				return new Promise((resolve) => setTimeout(resolve, ms));
			}

			// 用户消息节点是否包含目标摘要锚（文本匹配，免疫分页加载导致的索引偏移）
			function findUserByText(sc, anchor) {
				if (!anchor) return null;
				const users = sc.querySelectorAll(SELECTORS.userMessage);
				for (const u of users) if (u.textContent.includes(anchor)) return u;
				return null;
			}

			// 主包「加载更早消息」按钮：仅当 hasMore 时渲染；disabled 表示正在加载中。
			// 按钮无稳定 data 属性（class 为构建期混淆名），按文本匹配（t("chat.loadOlder")）。
			function findLoadOlderButton(sc) {
				const btns = sc.querySelectorAll("button");
				for (const b of btns) {
					const t = (b.textContent || "").toLowerCase();
					if (t.includes("older") || t.includes("更早") || t.includes("加载更多")) return b;
				}
				return null;
			}

			// 循环点击「加载更早」直到目标轮次出现在 DOM 中（最多 30 页）。
			// 返回命中的用户消息元素，未命中返回 null。
			async function ensureTurnLoaded(sc, anchor) {
				for (let attempt = 0; attempt < 30; attempt++) {
					const hit = anchor ? findUserByText(sc, anchor) : null;
					if (hit) return hit;
					const btn = findLoadOlderButton(sc);
					if (!btn) return null; // hasMore=false，历史已全部加载
					if (btn.disabled) {
						await waitMs(200); // 上一页仍在加载中
						continue;
					}
					btn.click();
					const deadline = Date.now() + 3000; // 单页最多等 3s
					while (Date.now() < deadline) {
						await waitMs(150);
						const now = anchor ? findUserByText(sc, anchor) : null;
						if (now) return now;
						if (!btn.disabled || !findLoadOlderButton(sc)) break; // 本次加载完成或已无更多
					}
				}
				return null;
			}

			function scrollToTurn(el) {
				el.scrollIntoView({ behavior: "smooth", block: "start" });
			}

			// ── 插件设置（纯 client 行为，存 localStorage，不经过 host） ─────
			// enabled：滑轨总开关；railStyle：横线 bar / 圆点 dot；autoHide：与内容太近/重叠时自动隐藏。
			// gap：间距(px)；dotSize：圆点直径(px)；capLen：悬停胶囊长度(px)；barLen：横线长度(px)。
			const SETTINGS_KEY = "shl.settings";
			const SETTINGS_EVENT = "shl-settings-change";
			const localSettings = { enabled: true, railStyle: "bar", autoHide: true, gap: 6, dotSize: 6, capLen: 18, barLen: 8 };
			const clampNum = (v, min, max, dflt) => {
				const n = Number(v);
				if (!isFinite(n)) return dflt;
				return Math.min(max, Math.max(min, Math.round(n)));
			};
			function readLocalSettings() {
				try {
					const raw = localStorage.getItem(SETTINGS_KEY);
					if (raw) {
						const v = JSON.parse(raw);
						localSettings.enabled = v.enabled !== false;
						localSettings.railStyle = v.railStyle === "dot" ? "dot" : "bar";
						localSettings.autoHide = v.autoHide !== false;
						localSettings.gap = clampNum(v.gap, 2, 24, 6);
						localSettings.dotSize = clampNum(v.dotSize, 4, 16, 6);
						localSettings.capLen = clampNum(v.capLen, 8, 48, 18);
						localSettings.barLen = clampNum(v.barLen, 4, 28, 8);
					}
				} catch {}
				return localSettings;
			}
			function writeLocalSettings(patch) {
				if (typeof patch.enabled === "boolean") localSettings.enabled = patch.enabled;
				if (patch.railStyle === "bar" || patch.railStyle === "dot") localSettings.railStyle = patch.railStyle;
				if (typeof patch.autoHide === "boolean") localSettings.autoHide = patch.autoHide;
				if (typeof patch.gap === "number") localSettings.gap = clampNum(patch.gap, 2, 24, 6);
				if (typeof patch.dotSize === "number") localSettings.dotSize = clampNum(patch.dotSize, 4, 16, 6);
				if (typeof patch.capLen === "number") localSettings.capLen = clampNum(patch.capLen, 8, 48, 18);
				if (typeof patch.barLen === "number") localSettings.barLen = clampNum(patch.barLen, 4, 28, 8);
				try {
					localStorage.setItem(SETTINGS_KEY, JSON.stringify(localSettings));
				} catch {}
				window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
			}

			function ShlHistoryRail({ sessionId }) {
				const itemsRef = react.useRef([]);
				const itemsJsonRef = react.useRef("");
				const activeRef = react.useRef(-1);
				const statusRef = react.useRef("");
				const selectedRef = react.useRef(false);
				const loadGenRef = react.useRef(0);
				const railNodeRef = react.useRef(null);
				const tooltipRef = react.useRef(null);
				const hoverRowRef = react.useRef(null);
				const hoverTickRef = react.useRef(null);
				const hoveredIndexRef = react.useRef(-1);
				// 插件设置（localStorage，纯 client）：enabled 开关 + railStyle 样式
				const settingsRef = react.useRef({ enabled: true, railStyle: "bar" });
				const loadSettingsRef = react.useRef(() => {});
				// 自动隐藏：与内容太近/重叠时隐藏（visibility，避免重排导致布局跳动）
				const overlapHiddenRef = react.useRef(false);
				const dialogHiddenRef = react.useRef(false);
				const checkOverlapRef = react.useRef(() => {});
				function applyVisibility() {
					const node = railNodeRef.current;
					if (!node) return;
					const hide = overlapHiddenRef.current || dialogHiddenRef.current;
					if (node.style.visibility !== (hide ? "hidden" : "")) {
						node.style.visibility = hide ? "hidden" : "";
					}
				}

				function applySettingsToNode() {
					const node = railNodeRef.current;
					if (!node) return;
					const s = settingsRef.current;
					const nextDisplay = s.enabled ? "" : "none";
					if (node.style.display !== nextDisplay) node.style.display = nextDisplay;
					if (node.dataset.shlStyle !== s.railStyle) node.dataset.shlStyle = s.railStyle;
					// 尺寸微调：写入 CSS 变量，驱动间距/圆点/胶囊/横线
					node.style.setProperty("--shl-gap", (s.gap ?? 6) + "px");
					node.style.setProperty("--shl-dot", (s.dotSize ?? 6) + "px");
					node.style.setProperty("--shl-cap", (s.capLen ?? 18) + "px");
					node.style.setProperty("--shl-bar", (s.barLen ?? 8) + "px");
				}

				async function jump(it) {
					selectedRef.current = true;
					activeRef.current = it.index;
					renderRail();
					const sc = document.querySelector(SELECTORS.conversationScroll);
					if (!sc) return;
					// 用摘要前 16 字作锚，文本匹配定位（免疫分页偏移）
					const anchor = (it.summary || "").slice(0, 16).trim();
					// 快路径：index 命中且文本吻合（文本校验防止分页偏移时跳到错的消息）
					const users = sc.querySelectorAll(SELECTORS.userMessage);
					const el = users[it.index];
					if (el && anchor && el.textContent.includes(anchor)) {
						scrollToTurn(el);
						return;
					}
					// 慢路径：目标轮次更早/未加载 → 自动点击主包「加载更早」直至命中
					try {
						const hit = await ensureTurnLoaded(sc, anchor);
						if (hit) {
							scrollToTurn(hit);
							return;
						}
					} catch {}
					// 全部历史加载完仍未命中 → fallback 顶部
					sc.scrollTo({ top: 0, behavior: "smooth" });
				}

				function positionRail() {
					const node = railNodeRef.current;
					const sc = document.querySelector(SELECTORS.conversationScroll);
					if (!node || !sc) return;
					const rect = sc.getBoundingClientRect();
					const h = node.offsetHeight || 0;
					const left = rect.left + 4;
					const top = rect.top + Math.max(8, (rect.height - h) / 2);
					if (node.style.left !== left + "px" || node.style.top !== top + "px") {
						node.style.left = left + "px";
						node.style.top = top + "px";
					}
					checkOverlap();
					checkOverlapRef.current = checkOverlap;
				}
				// 自动隐藏：检测 rail 右缘（含 OVERLAP_MARGIN 缓冲）是否压到对话消息
				// 内容；太近/重叠则隐藏，避免遮挡文字。rail 本身 pointer-events:none，
				// 故 elementFromPoint 可“看穿”取到下方真实内容；若该内容位于消息节点
				// 内，说明 rail 已贴到内容 → 隐藏。
				const OVERLAP_MARGIN = 8;
				function checkOverlap() {
					const node = railNodeRef.current;
					if (!node) return;
					if (!settingsRef.current.enabled) {
						if (overlapHiddenRef.current) { overlapHiddenRef.current = false; applyVisibility(); }
						return;
					}
					if (!settingsRef.current.autoHide) {
						if (overlapHiddenRef.current) { overlapHiddenRef.current = false; applyVisibility(); }
						return;
					}
					const r = node.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) {
						if (overlapHiddenRef.current) { overlapHiddenRef.current = false; applyVisibility(); }
						return;
					}
					// 采样：rail 右缘内侧 + 右缘外 8px 缓冲；垂直取上/中/下三处
					const xs = [r.right - 2, r.right + OVERLAP_MARGIN];
					const ys = [r.top + 8, r.top + r.height / 2, r.top + r.height - 8];
					let covers = false;
					for (const x of xs) {
						for (const y of ys) {
							const el = document.elementFromPoint(x, y);
							if (el && el.closest && el.closest('[data-chat-flow-kind]')) { covers = true; break; }
						}
						if (covers) break;
					}
					if (covers !== overlapHiddenRef.current) {
						overlapHiddenRef.current = covers;
						applyVisibility();
					}
				}

				function positionTooltip(rowEl, tickEl) {
					const tip = tooltipRef.current;
					if (!tip) return;
					const rect = tickEl.getBoundingClientRect();
					const tipRect = tip.getBoundingClientRect();
					let x = rect.right + 24;
					let y = rect.top - 4;
					if (x + tipRect.width > window.innerWidth - 8) x = rect.left - tipRect.width - 10;
					if (y < 8) y = 8;
					if (y + tipRect.height > window.innerHeight - 8) y = window.innerHeight - 8 - tipRect.height;
					tip.style.left = x + "px";
					tip.style.top = y + "px";
				}

				function showTooltip(rowEl, tickEl, text) {
					const tip = tooltipRef.current;
					if (!tip) return;
					hoverRowRef.current = rowEl;
					hoverTickRef.current = tickEl;
					tip.textContent = text || "";
					tip.style.display = "block";
					positionTooltip(rowEl, tickEl);
				}

				function hideTooltip() {
					hoverRowRef.current = null;
					hoverTickRef.current = null;
					const tip = tooltipRef.current;
					if (tip) tip.style.display = "none";
				}

				// 悬停时若对话/滑轨滚动，tooltip 跟随重定位
				function repositionHover() {
					const rowEl = hoverRowRef.current;
					const tickEl = hoverTickRef.current;
					if (rowEl && tickEl) positionTooltip(rowEl, tickEl);
				}

				function applyWave(hoveredIndex) {
					const node = railNodeRef.current;
					if (!node) return;
					const rows = node.querySelectorAll(".shlrail_row");
					for (let i = 0; i < rows.length; i++) {
						const tick = rows[i].querySelector(".shlrail_tick");
						if (!tick) return;
						const dist = hoveredIndex < 0 ? 99 : Math.abs(i - hoveredIndex);
						tick.className = "shlrail_tick" + (dist <= 4 ? " lvl" + dist : "");
					}
				}

				function renderRail() {
					const node = railNodeRef.current;
					if (!node) return;
					const items = itemsRef.current;
					const status = statusRef.current;
					let scroll = node.querySelector(".shlrail_scroll");
					if (!scroll) {
						scroll = document.createElement("div");
						scroll.className = "shlrail_scroll";
						node.appendChild(scroll);
					}
					if (items.length === 0) {
						// 空态：重建单条状态线，保证 tooltip 显示最新状态
						scroll.dataset.mode = "empty";
						scroll.innerHTML = "";
						const row = document.createElement("div");
						row.className = "shlrail_row";
						const tick = document.createElement("span");
						tick.className = "shlrail_tick";
						row.appendChild(tick);
						row.addEventListener("mouseenter", () => {
							showTooltip(row, tick, status || "暂无历史请求");
						});
						row.addEventListener("mouseleave", () => hideTooltip());
						scroll.appendChild(row);
					} else {
						// 列表态：从空态切换时清空；否则仅追加新增行，保留已有行（不打断悬停）
						if (scroll.dataset.mode !== "list") {
							scroll.innerHTML = "";
							scroll.dataset.mode = "list";
						}
						const rows = scroll.querySelectorAll(".shlrail_row");
						for (let i = rows.length; i < items.length; i++) {
							const it = items[i];
							const row = document.createElement("div");
							row.className = "shlrail_row";
							const tick = document.createElement("span");
							tick.className = "shlrail_tick";
							row.appendChild(tick);
							row.addEventListener("mouseenter", () => {
								hoveredIndexRef.current = i;
								applyWave(i);
								showTooltip(row, tick, it.summary || "");
							});
							row.addEventListener("mouseleave", () => {
								hoveredIndexRef.current = -1;
								applyWave(-1);
								hideTooltip();
							});
							row.addEventListener("click", () => {
								hideTooltip();
								jump(it);
							});
							scroll.appendChild(row);
						}
						while (scroll.querySelectorAll(".shlrail_row").length > items.length) {
							scroll.removeChild(scroll.lastElementChild);
						}
					}
					applyWave(hoveredIndexRef.current);
					positionRail();
				}

				react.useEffect(() => {
					const node = document.createElement("div");
					node.className = "shlrail_fixed";
					document.body.appendChild(node);
					railNodeRef.current = node;
					const tip = document.createElement("div");
					tip.className = "shlrail_tooltip";
					tip.style.display = "none";
					document.body.appendChild(tip);
					tooltipRef.current = tip;
					// 初始应用本地设置（开关 / 样式）
					const init = readLocalSettings();
					settingsRef.current = { enabled: init.enabled, railStyle: init.railStyle, autoHide: init.autoHide, gap: init.gap, dotSize: init.dotSize, capLen: init.capLen, barLen: init.barLen };
					node.dataset.shlStyle = init.railStyle;
					node.style.display = init.enabled ? "" : "none";
					renderRail();
					positionRail();
					window.addEventListener("resize", positionRail);
					// 悬停时对话/滑轨滚动 → tooltip 跟随重定位（capture 捕获所有滚动容器）
					// 同时滚动会改变 rail 压在内容上的位置，重算自动隐藏
					const onScroll = () => { repositionHover(); checkOverlap(); };
					window.addEventListener("scroll", onScroll, true);
					// 设置卡片修改后即时同步（ref 保证引用最新的 loadSettings）
					const onSettingsChange = () => loadSettingsRef.current();
					window.addEventListener(SETTINGS_EVENT, onSettingsChange);
					// 对话区左侧随侧栏折叠/展开重定位
					const ro = new ResizeObserver(() => positionRail());
					const sc = document.querySelector("[data-conversation-scroll]");
					if (sc) ro.observe(sc);
					// 周期校准：重定位 rail
					const calib = setInterval(() => {
						positionRail();
					}, 1000);
				// 弹窗检测：dialog挂载时隐藏rail，卸载时恢复
				// 使用 visibility:hidden 而非 display:none，避免触发重新布局计算；
				// 缓存上次状态，仅在变化时写入样式，避免每轮对话渲染都触发 style 赋值。
				let lastDialogState = false;
				function syncDialogVisibility() {
					const hasDialog = !!document.querySelector(SELECTORS.dialog) || !!document.querySelector(SELECTORS.settingsModal);
					if (hasDialog !== lastDialogState) {
						lastDialogState = hasDialog;
						dialogHiddenRef.current = hasDialog;
						applyVisibility();
					}
				}
				const dlgObs = new MutationObserver(syncDialogVisibility);
				dlgObs.observe(document.body, { childList: true, subtree: true });
				syncDialogVisibility();
					return () => {
						window.removeEventListener("resize", positionRail);
						window.removeEventListener("scroll", onScroll, true);
						window.removeEventListener(SETTINGS_EVENT, onSettingsChange);
						ro.disconnect();
						dlgObs.disconnect();
						clearInterval(calib);
						node.remove();
						tip.remove();
						railNodeRef.current = null;
						tooltipRef.current = null;
					};
				}, []);

				// 会话切换时立即清空旧数据，避免残留上一会话的 rail / tooltip
				react.useEffect(() => {
					selectedRef.current = false;
					activeRef.current = -1;
					itemsRef.current = [];
					itemsJsonRef.current = "";
					statusRef.current = "";
					loadGenRef.current++;
					renderRail();
				}, [sessionId]);

				const load = react.useCallback(async () => {
					if (!settingsRef.current.enabled) return; // 开关关闭时不拉取历史
					const gen = loadGenRef.current;
					let r;
					try {
						r = await connection.rpc.call("/api", "shl/getHistory", { args: { request: { sessionId } } });
					} catch (e) {
						if (gen !== loadGenRef.current) return;
						statusRef.current = "RPC错误: " + (e && e.message ? e.message : String(e));
						renderRail();
						return;
					}
					if (gen !== loadGenRef.current) return;
					if (!r || !r.ok) {
						statusRef.current = "host错误: " + (r && r.error ? JSON.stringify(r.error) : "ok=false");
						renderRail();
						return;
					}
					const v = r.value || {};
					const list = v.items || [];
					if (gen !== loadGenRef.current) return;
					const nextJson = JSON.stringify(list);
					if (nextJson === itemsJsonRef.current) return;
					itemsJsonRef.current = nextJson;
					itemsRef.current = list;
					if (!selectedRef.current) activeRef.current = list.length - 1;
					const d = v.debug;
					statusRef.current = "OK sid=" + (d && d.resolvedSessionId || "-") + " ev=" + (d && d.eventCount) + (d && d.err ? " ERR=" + d.err : "");
					renderRail();
				}, [sessionId]);

				// 读取本地设置（localStorage，纯 client 行为），变化时应用到 UI
				const loadSettings = react.useCallback(() => {
					const s = readLocalSettings();
					const next = { enabled: s.enabled, railStyle: s.railStyle, autoHide: s.autoHide, gap: s.gap, dotSize: s.dotSize, capLen: s.capLen, barLen: s.barLen };
					const prev = settingsRef.current;
					const coreChanged = next.enabled !== prev.enabled || next.railStyle !== prev.railStyle || next.autoHide !== prev.autoHide;
					const styleChanged = next.gap !== prev.gap || next.dotSize !== prev.dotSize || next.capLen !== prev.capLen || next.barLen !== prev.barLen;
					if (!coreChanged && !styleChanged) return;
					settingsRef.current = next;
					applySettingsToNode();
					checkOverlapRef.current && checkOverlapRef.current();
					if (coreChanged && next.enabled !== prev.enabled) {
						// 开关切换：清空旧数据；开启后立即重拉历史
						itemsRef.current = [];
						itemsJsonRef.current = "";
						statusRef.current = "";
						renderRail();
						load();
					} else {
						renderRail();
					}
				}, [load]);
				loadSettingsRef.current = loadSettings;

				react.useEffect(() => {
					load();
					loadSettings();
					const t = setInterval(() => {
						loadSettings();
						load();
					}, 2000);
					return () => clearInterval(t);
				}, [load, loadSettings]);

				return null;
			}

// ── 设置页「插件配置」tab 的设置卡片 ─────────────────────────
// 卡片采用与官方 PluginCard 同款 chrome：圆角边框 + 标题/描述 +
// 折叠箭头；点击头部折叠/展开。让卡片在视觉上与「网页搜索」
// 「插件市场」一致。读写走 ctx.settingsScope 绑定的 namespace
// 'shl-session-history'（host 端已在 src/index.js 注册）。
//
// chevron SVG 直接内联取自 @deepseek-ai/dsh-client-ui-primitives
// 的 IconChevronDownOutline14（仅 viewBox + path，无运行时依赖），
// 避免给 lib 加 externals。
const CHEVRON_PATH = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

function ShlSettingsCard(props) {
	const snapshot = props.useShlCard((s) => s);
	// settings namespace 还未 ready 时不渲染（与官方 PluginCard 一致：
	// 「一个未组合的部署不应留痕」）
	if (!snapshot || snapshot.status !== "ready") return null;
	const value = snapshot.value || {};
	const enabled = value.enabled !== false; // 缺省视为启用（schema default=true）
	const railStyle = value.railStyle === "dot" ? "dot" : "bar";
	const autoHide = value.autoHide !== false;
	const gap = typeof value.gap === "number" ? value.gap : 6;
	const dotSize = typeof value.dotSize === "number" ? value.dotSize : 6;
	const capLen = typeof value.capLen === "number" ? value.capLen : 18;
	const barLen = typeof value.barLen === "number" ? value.barLen : 8;
	const setAutoHide = props.setAutoHide;
	const setEnabled = props.setEnabled;
	const setRailStyle = props.setRailStyle;
	const setGap = props.setGap;
	const setDotSize = props.setDotSize;
	const setCapLen = props.setCapLen;
	const setBarLen = props.setBarLen;
	const [open, setOpen] = react.useState(false);

	// ── 更新入口状态机（对齐「插件市场」风格） ─────────────────────
	// idle → checking → (has-update | up-to-date | error) → updating → (updated | error)
	const [upd, setUpd] = react.useState({ status: "idle", current: null, latest: null, releaseUrl: null, dir: null, error: null });
	// 当前插件版本号（来自 host.getVersion()，不依赖网络），挂载时拉取，
	// 更新成功后刷一次。用于标题"会话滑轨 v1.0.0"与运行行展示。
	const [pluginVersion, setPluginVersion] = react.useState(null);
	const checkForUpdateRpc = props.checkForUpdate;
	const applyUpdateRpc = props.applyUpdate;
	const getVersionRpc = props.getVersion;
	const runCheck = react.useCallback(async () => {
		setUpd((s) => ({ ...s, status: "checking" }));
		try {
			const r = await checkForUpdateRpc();
			const v = r || {};
			setUpd({
				status: v.updateAvailable ? "has-update" : "up-to-date",
				current: v.current || null,
				latest: v.latest || null,
				releaseUrl: v.releaseUrl || null,
				dir: v.dir || null,
				error: v.error || null
			});
		} catch (e) {
			setUpd((s) => ({ ...s, status: "error", error: e && e.message ? e.message : String(e) }));
		}
	}, [checkForUpdateRpc]);
	const runUpdate = react.useCallback(async () => {
		if (typeof window !== "undefined" && window.confirm &&
			!window.confirm("将从 GitHub 拉取更新到插件源目录，可能覆盖本地改动（不可撤销）。是否继续？")) {
			return;
		}
		setUpd((s) => ({ ...s, status: "updating" }));
		try {
			const r = await applyUpdateRpc();
			const v = r || {};
			if (v.ok) {
				setUpd((s) => ({ ...s, status: "updated", current: v.after || s.current, before: v.before, error: null }));
				// 标题版本号同步刷新（pull 后 plugin 真源目录版本已变）
				if (typeof getVersionRpc === "function") {
					getVersionRpc().then((r2) => {
						const v2 = r2 && r2.value && r2.value.version ? r2.value.version : (r2 && r2.version);
						if (v2) setPluginVersion(String(v2));
					}).catch(() => {});
				}
			} else {
				setUpd((s) => ({ ...s, status: "error", error: v.error || "更新失败" }));
			}
		} catch (e) {
			setUpd((s) => ({ ...s, status: "error", error: e && e.message ? e.message : String(e) }));
		}
	}, [applyUpdateRpc]);
	// 首次挂载自动检查一次（同时拉取本地版本号用于标题展示）
	react.useEffect(() => {
		runCheck();
		if (typeof getVersionRpc === "function") {
			getVersionRpc().then((r) => {
				const v = r && r.value && r.value.version ? r.value.version : (r && r.version);
				if (v) setPluginVersion(String(v));
			}).catch(() => {});
		}
	}, [runCheck, getVersionRpc]);

	// 配色与官方 PluginCard 对齐（dsw-alias 设计令牌）
	const ds = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`;
	const chevron = (rotated) => react.createElement("svg", {
		key: "chevron",
		width: 14,
		height: 14,
		viewBox: "0 0 14 14",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		style: {
			color: ds("label-tertiary", "#888"),
			flex: "none",
			transform: rotated ? "rotate(180deg)" : "none",
			transition: "transform .16s"
		},
		children: react.createElement("path", { d: CHEVRON_PATH, fill: "currentColor" })
	});

	const styleBtn = (active, label, onClick) => react.createElement("button", {
		type: "button",
		key: label,
		onClick,
		style: {
			padding: "2px 10px",
			fontSize: "12px",
			borderRadius: "6px",
			cursor: "pointer",
			border: active
				? `1px solid ${ds("brand-primary", "#4f8cff")}`
				: `1px solid ${ds("border-l2", "#333")}`,
			background: active
				? ds("brand-primary", "#4f8cff")
				: ds("bg-layer-2", "rgba(30,30,30,0.8)"),
			color: active ? "#fff" : ds("label-secondary", "#aaa")
		}
	}, label);
	// iOS 风格开关：胶囊 + 白色拇指，开时变深色、拇指滑至右侧
	const Switch = (active, onClick) => react.createElement("button", {
		type: "button",
		key: "sw",
		role: "switch",
		"aria-checked": !!active,
		onClick,
		style: {
			position: "relative",
			width: "36px",
			height: "20px",
			padding: 0,
			border: 0,
			borderRadius: "10px",
			background: active
				? ds("label-primary", "#1f1f1f")
				: ds("bg-layer-2", "rgba(255,255,255,0.16)"),
			cursor: "pointer",
			transition: "background .18s ease",
			flexShrink: 0
		}
	}, react.createElement("span", {
		style: {
			position: "absolute",
			top: "2px",
			left: active ? "18px" : "2px",
			width: "16px",
			height: "16px",
			borderRadius: "50%",
			background: "#fff",
			boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
			transition: "left .18s cubic-bezier(.4,.0,.2,1)"
		}
	}));
	// 滑块：label + range + 数值(px)，用于尺寸微调（间距/圆点/胶囊/横线）
	const Slider = (label, value, min, max, step, onChange) => row(label, react.createElement("div", {
		key: "sl-" + label,
		style: { display: "flex", alignItems: "center", gap: "8px" }
	}, [
		react.createElement("input", {
			key: "r",
			type: "range",
			min: min, max: max, step: step,
			value: value,
			onChange: (e) => onChange(Number(e.target.value)),
			style: { width: "120px", accentColor: ds("brand-primary", "#4f8cff"), cursor: "pointer" }
		}),
		react.createElement("span", {
			key: "v",
			style: { color: ds("label-tertiary", "#999"), fontSize: "12px", minWidth: "34px", textAlign: "right" }
		}, value + "px")
	]));
	const row = (label, control) => react.createElement("div", {
		key: label,
		style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "8px 0" }
	}, [
		react.createElement("span", { key: "l", style: { color: ds("label-primary", "#eee"), fontSize: "13px" } }, label),
		control
	]);

	// 头部（始终渲染）：标题 + 描述 + chevron，整体是折叠按钮
	const header = react.createElement("button", {
		key: "header",
		type: "button",
		"aria-expanded": open,
		onClick: () => setOpen((o) => !o),
		style: {
			appearance: "none",
			width: "100%",
			font: "inherit",
			color: "inherit",
			textAlign: "left",
			cursor: "pointer",
			background: "transparent",
			border: 0,
			borderRadius: open ? "12px 12px 0 0" : "12px",
			alignItems: "center",
			gap: "12px",
			padding: "14px 16px",
			display: "flex"
		}
	}, [
		react.createElement("span", {
			key: "headText",
			style: { flexDirection: "column", flex: 1, gap: "4px", minWidth: 0, display: "flex" }
		}, [
			react.createElement("span", {
			key: "nameRow",
			style: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }
		}, [
			react.createElement("span", {
				key: "name",
				style: { color: ds("label-primary", "#eee"), fontSize: "15px", fontWeight: 600, lineHeight: 1.4 }
			}, "会话滑轨"),
			pluginVersion ? react.createElement("span", {
				key: "ver",
				style: { color: ds("label-tertiary", "#999"), fontSize: "13px", lineHeight: 1.4, flexShrink: 0 }
			}, "v" + pluginVersion) : null
		]),
			react.createElement("span", {
				key: "desc",
				style: { color: ds("label-tertiary", "#999"), fontSize: "13px", lineHeight: 1.5 }
			}, "在对话区左侧显示历史请求的迷你滑轨，可切换横线/圆点样式。")
		]),
		chevron(open)
	]);

	const bodyRows = [
		row("启用滑轨", Switch(enabled, () => setEnabled(!enabled))),
		row("自动隐藏", Switch(autoHide, () => setAutoHide(!autoHide))),
		row("滑轨样式", react.createElement("div", { key: "styles", style: { display: "flex", gap: "6px" } }, [
			styleBtn(railStyle === "bar", "横线", () => setRailStyle("bar")),
			styleBtn(railStyle === "dot", "圆点", () => setRailStyle("dot"))
		])),
		row("间距", Slider("间距", gap, 2, 24, 1, setGap))
	];
	if (railStyle === "dot") {
		// 圆点模式：圆点大小 + 悬停胶囊长度
		bodyRows.push(row("圆点大小", Slider("圆点大小", dotSize, 4, 16, 1, setDotSize)));
		bodyRows.push(row("胶囊长度", Slider("胶囊长度", capLen, 8, 48, 1, setCapLen)));
	} else {
		// 横线模式：仅横线长度
		bodyRows.push(row("横线长度", Slider("横线长度", barLen, 4, 28, 1, setBarLen)));
	}

	// ── 更新入口行（对齐「插件市场」v1.17.1 版式：当前版本 / 新版本提示 + 更新按钮） ──
	const updateRow = () => {
		const s = upd;
		let text = "";
		let control = null;
		const muted = (children, extra) => react.createElement("span", {
			key: "u-t",
			style: { color: extra || ds("label-tertiary", "#999"), fontSize: "12px" }
		}, children);
		if (s.status === "idle") {
			text = "当前版本 " + (s.current || "?");
			control = styleBtn(true, "检查更新", runCheck);
		} else if (s.status === "checking") {
			text = "检查中…";
		} else if (s.status === "up-to-date") {
			text = "已是最新 " + (s.current || "");
			control = styleBtn(false, "重新检查", runCheck);
		} else if (s.status === "has-update") {
			text = "有新版本 " + (s.latest || "");
			const children = [styleBtn(true, "更新", runUpdate)];
			if (s.releaseUrl) {
				children.push(react.createElement("a", {
					key: "rl",
					href: s.releaseUrl,
					target: "_blank",
					rel: "noreferrer",
					style: { color: ds("brand-primary", "#4f8cff"), fontSize: "12px" }
				}, "查看"));
			}
			control = react.createElement("div", { key: "u-ctl", style: { display: "flex", alignItems: "center", gap: "6px" } }, children);
		} else if (s.status === "updating") {
			text = "更新中…";
		} else if (s.status === "updated") {
			text = "已更新到 " + (s.current || "") + "，重启后生效";
			control = styleBtn(false, "重新检查", runCheck);
		} else if (s.status === "error") {
			text = "更新失败：" + (s.error || "未知错误");
			control = styleBtn(false, "重试", runCheck);
		}
		return row("更新", react.createElement("div", {
			key: "u-box",
			style: { display: "flex", alignItems: "center", gap: "8px", maxWidth: "320px", flexWrap: "wrap", justifyContent: "flex-end" }
		}, [muted(text, s.status === "error" ? ds("state-danger", "#ff5f5f") : null), control].filter(Boolean)));
	};
	bodyRows.push(updateRow());

	const body = open ? react.createElement("div", {
		key: "body",
		style: {
			borderTop: `1px solid ${ds("border-l2", "#3a3a3a")}`,
			margin: "0 16px",
			padding: "12px 0 4px"
		}
	}, bodyRows) : null;

	return react.createElement("li", {
		style: {
			border: `1px solid ${ds("border-l2", "#3a3a3a")}`,
			background: ds("bg-layer-3", "rgba(40,40,40,0.6)"),
			borderRadius: "12px",
			listStyle: "none",
			overflow: "hidden",
			transition: "border-color .16s, background .16s"
		}
	}, [header, body]);
}

			// 设置卡片：注册到「插件配置」tab 内的可配置卡片（settings.plugin.item）。
			// owner (ConfigurablePluginsTab) 只渲染 key 命中 host 已 serve 的
			// namespace 的卡片——所以 host 端必须在 ctx.settings.register 注册
			// 'shl-session-history' 才能出现。
			// 仅当 settingsScope 可用时注册；不可用时降级（不渲染卡片，rail 走 localStorage）。
			if (settingsScope) {
				ctx.slots.inject("settings.plugin.item", () =>
					ctx.slots.register({
						name: "settings.plugin.item",
						key: "shl-session-history",
						order: 50,
						label: () => "会话滑轨",
						inject: () => ({
							hooks: { shlCard: {
								getSnapshot: () => settingsScope.getSnapshot(),
								subscribe: (l) => settingsScope.subscribe(l)
							} },
							setEnabled: (v) => settingsScope.set("enabled", v),
							setRailStyle: (v) => settingsScope.set("railStyle", v),
							setAutoHide: (v) => settingsScope.set("autoHide", v),
						setGap: (v) => settingsScope.set("gap", v),
						setDotSize: (v) => settingsScope.set("dotSize", v),
						setCapLen: (v) => settingsScope.set("capLen", v),
						setBarLen: (v) => settingsScope.set("barLen", v),
						checkForUpdate: () => connection.rpc.call("/api", "shl/checkForUpdate", { args: {} }),
						applyUpdate: () => connection.rpc.call("/api", "shl/applyUpdate", { args: {} }),
						getVersion: () => connection.rpc.call("/api", "shl/getVersion", { args: {} })
					})
					}, ShlSettingsCard)
				);

				// ── scope → localStorage 同步：保持 rail 渲染层继续从 localStorage 读 ──
				// 让单源变双源，增加复杂度但保留旧引用——若直接改造 rail 读 snapshot
				// 引用的风险更高；一次提交只动卡片。
				let prevSynced = null;
				ctx.effect(() => {
					const off = settingsScope.subscribe(() => {
						const s = settingsScope.getSnapshot();
						if (s.status !== "ready") return;
						const v = s.value || {};
						const next = {
							enabled: v.enabled !== false,
							railStyle: v.railStyle === "dot" ? "dot" : "bar",
							autoHide: v.autoHide !== false,
							gap: clampNum(v.gap, 2, 24, 6),
							dotSize: clampNum(v.dotSize, 4, 16, 6),
							capLen: clampNum(v.capLen, 8, 48, 18),
							barLen: clampNum(v.barLen, 4, 28, 8)
						};
						if (prevSynced
							&& prevSynced.enabled === next.enabled
							&& prevSynced.railStyle === next.railStyle && prevSynced.autoHide === next.autoHide
							&& prevSynced.gap === next.gap && prevSynced.dotSize === next.dotSize
							&& prevSynced.capLen === next.capLen && prevSynced.barLen === next.barLen) return;
						prevSynced = next;
						try { writeLocalSettings(next); } catch {}
					});
					return off;
				}, "shl: sync settings scope → localStorage");
			}
			// 注销说明：slots.inject 经 ctx.effect 管理生命周期，插件卸载时框架
			// 会自动调用 register 返回的 disposer 注销注册，无需手动处理重复注册。
			ctx.slots.inject("conversation.session.header.utilities", () =>
				ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "shl-history-rail",
					order: 0
				}, ShlHistoryRail)
			);

			return () => {
				style.remove();
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});