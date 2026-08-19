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
				}
				.shlrail_row {
					flex: none;
					display: flex;
					align-items: center;
					cursor: pointer;
					padding: 2px 0;
					position: relative;
				}
				.shlrail_tick {
					flex: none;
					width: 14px;
					height: 2px;
					border-radius: 1px;
					background: var(--dsw-alias-label-tertiary, #777);
					opacity: 0.65;
					transition: width 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
				}
				.shlrail_tick.lvl0 {
					width: 36px;
					background: var(--dsw-alias-brand-primary, #4f8cff);
					opacity: 1;
					box-shadow: 0 0 5px var(--dsw-alias-brand-primary, #4f8cff);
				}
				.shlrail_tick.lvl1 {
					width: 16px;
					opacity: 0.85;
				}
				.shlrail_tick.lvl2 {
					width: 14px;
					opacity: 0.65;
				}
				.shlrail_tick.lvl3 {
					width: 12px;
					opacity: 0.45;
				}
				.shlrail_tick.lvl4 {
					width: 10px;
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
					box-shadow: 0 6px 24px rgba(0,0,0,0.35);
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
				const railNodeRef = react.useRef(null);
				const tooltipRef = react.useRef(null);

				function jump(it) {
					selectedRef.current = true;
					activeRef.current = it.index;
					renderRail();
					const sc = document.querySelector("[data-conversation-scroll]");
					if (!sc) return;
					const users = sc.querySelectorAll('[data-chat-flow-kind="user"]');
					const el = users[it.index];
					if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
					else sc.scrollTo({ top: 0, behavior: "smooth" });
				}

				function positionRail() {
					const node = railNodeRef.current;
					const sc = document.querySelector("[data-conversation-scroll]");
					if (!node || !sc) return;
					const rect = sc.getBoundingClientRect();
					const h = node.offsetHeight || 0;
					node.style.left = (rect.left + 4) + "px";
					node.style.top = (rect.top + Math.max(8, (rect.height - h) / 2)) + "px";
				}

				function positionTooltip(rowEl, tickEl) {
					const tip = tooltipRef.current;
					if (!tip) return;
					const rect = tickEl.getBoundingClientRect();
					const tipRect = tip.getBoundingClientRect();
					let x = rect.right + 36;
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
					tip.textContent = text || "";
					tip.style.display = "block";
					positionTooltip(rowEl, tickEl);
				}

				function hideTooltip() {
					const tip = tooltipRef.current;
					if (tip) tip.style.display = "none";
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
					node.innerHTML = "";
					const items = itemsRef.current;
					const status = statusRef.current;
					const scroll = document.createElement("div");
					scroll.className = "shlrail_scroll";
					if (items.length === 0) {
						const row = document.createElement("div");
						row.className = "shlrail_row";
						row.title = status || "暂无历史请求";
						const tick = document.createElement("span");
						tick.className = "shlrail_tick";
						row.appendChild(tick);
						scroll.appendChild(row);
					} else {
for (let i = 0; i < items.length; i++) {
						const it = items[i];
						const row = document.createElement("div");
						row.className = "shlrail_row";
						const tick = document.createElement("span");
						tick.className = "shlrail_tick";
						row.appendChild(tick);
						row.addEventListener("mouseenter", () => {
							applyWave(i);
							showTooltip(row, tick, it.fullUser || it.summary || "");
						});
						row.addEventListener("mouseleave", () => {
							applyWave(-1);
							hideTooltip();
						});
						row.addEventListener("click", () => {
							hideTooltip();
							jump(it);
						});
						scroll.appendChild(row);
					}
					}
					node.appendChild(scroll);
					applyWave(-1);
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
					return () => {
						window.removeEventListener("resize", positionRail);
						node.remove();
						tip.remove();
						railNodeRef.current = null;
						tooltipRef.current = null;
					};
				}, []);

				const load = react.useCallback(async () => {
					let r;
					try {
						r = await connection.rpc.call("/api", "shl/getHistory", { args: { request: { sessionId } } });
					} catch (e) {
						statusRef.current = "RPC错误: " + (e && e.message ? e.message : String(e));
						renderRail();
						return;
					}
					if (!r || !r.ok) {
						statusRef.current = "host错误: " + (r && r.error ? JSON.stringify(r.error) : "ok=false");
						renderRail();
						return;
					}
					const v = r.value || {};
					const list = v.items || [];
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