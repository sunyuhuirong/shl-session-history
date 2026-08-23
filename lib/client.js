window.__ModuleLoader__.load({
	id: "shl-session-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var react_jsx_runtime = require("react/jsx-runtime");

		const inject = ["connection", "slots"];

		function apply(ctx) {
			const connection = ctx.connection;

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
					gap: 6px;
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
					width: 8px;
					height: 2px;
					border-radius: 1px;
					background: var(--dsw-alias-label-tertiary, #777);
					opacity: 0.65;
					transform-origin: left center;
					transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
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

				function jump(it) {
					selectedRef.current = true;
					activeRef.current = it.index;
					renderRail();
					const sc = document.querySelector(SELECTORS.conversationScroll);
					if (!sc) return;
					const users = sc.querySelectorAll(SELECTORS.userMessage);
					// it.index 由 host 按「有文本的用户事件」计数，与 DOM 用户消息顺序对齐；
					// 若 DOM 懒加载/折叠导致顺序错位，元素找不到时 fallback 到顶部。
					const el = users[it.index];
					if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
					else sc.scrollTo({ top: 0, behavior: "smooth" });
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
					renderRail();
					positionRail();
					window.addEventListener("resize", positionRail);
					// 悬停时对话/滑轨滚动 → tooltip 跟随重定位（capture 捕获所有滚动容器）
					window.addEventListener("scroll", repositionHover, true);
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
						node.style.visibility = hasDialog ? "hidden" : "";
					}
				}
				const dlgObs = new MutationObserver(syncDialogVisibility);
				dlgObs.observe(document.body, { childList: true, subtree: true });
				syncDialogVisibility();
					return () => {
						window.removeEventListener("resize", positionRail);
						window.removeEventListener("scroll", repositionHover, true);
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

				react.useEffect(() => {
					load();
					const t = setInterval(load, 2000);
					return () => clearInterval(t);
				}, [load]);

				return null;
			}

			// 注销说明：slots.inject 通过 ctx.effect 管理生命周期，插件卸载时框架
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