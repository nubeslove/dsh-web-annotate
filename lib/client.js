window.__ModuleLoader__.load({
	id: "dsh-web-annotate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		"use strict";

		var React = require("react");
		var h = React.createElement;

		var ID = "dsh-web-annotate";
		var KIND = "web-annotate";
		var ADDRESS_PREFIX = "dsh-resource://annotate/";
		var API = "/api/web-annotate";
		var STYLE_ID = "dsh-web-annotate-style";
		var inject = ["slots", "sidebarRightTabs", "sidebarRight"];

		var pluginCtx = null;

		// ------------------------------------------------------------ 地址

		function decodeAddress(address) {
			if (typeof address !== "string") return "";
			if (address.indexOf(ADDRESS_PREFIX) !== 0) return "";
			try {
				return decodeURIComponent(address.slice(ADDRESS_PREFIX.length));
			} catch (e) {
				return "";
			}
		}

		function encodeAddress(url) {
			return ADDRESS_PREFIX + encodeURIComponent(url);
		}

		function normalizeInput(raw) {
			var text = String(raw || "").trim();
			if (!text) return "";
			if (/^https?:\/\//i.test(text)) return text;
			if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text)) return "http://" + text;
			return "https://" + text;
		}

		function hostOf(url) {
			try {
				return new URL(url).host || url;
			} catch (e) {
				return String(url || "");
			}
		}

		/** 批注按页面地址分键存在 localStorage，关掉 tab 再打开还在。 */
		function notesStorageKey(url) {
			return "dsh-web-annotate:notes:" + String(url || "");
		}

		// ------------------------------------------------------------ 通信

		function post(path, body) {
			return fetch(API + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {})
			}).then(function (res) {
				return res.json().catch(function () {
					return { ok: false, error: "HTTP " + res.status };
				});
			});
		}

		// ------------------------------------------------------------ 样式

		var CSS = [
			".wa-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsh-bg-base,#16181d)}",
			".wa-bar{display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid rgba(127,127,127,.22);flex:0 0 auto;background:var(--dsh-bg-elevated,#1f2229)}",
			".wa-input{flex:1 1 auto;min-width:0;height:28px;padding:0 10px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12px;font-family:var(--dsh-font-mono,ui-monospace,Consolas,monospace);outline:none}",
			".wa-input:focus{border-color:rgba(56,160,255,.65)}",
			".wa-btn{height:28px;min-width:28px;padding:0 8px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsh-text-secondary,#9aa4b2);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}",
			".wa-btn:hover{background:rgba(127,127,127,.16);color:var(--dsh-text-primary,#e6e8eb)}",
			".wa-btn[data-primary=\"1\"]{background:#2f7de1;color:#fff;border-color:#2f7de1}",
			".wa-btn[data-active=\"1\"]{background:rgba(56,160,255,.2);border-color:rgba(56,160,255,.55);color:#8cc8ff}",
			".wa-btn:disabled{opacity:.45;cursor:not-allowed}",
			".wa-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;background:#0d0f13}",
			".wa-frame{display:block;width:100%;height:100%;object-fit:contain;user-select:none}",
			".wa-hit{position:absolute;inset:0;outline:none}",
			".wa-marquee{position:absolute;border:1.5px dashed #4aa3ff;background:rgba(74,163,255,.12);border-radius:2px;pointer-events:none}",
			".wa-hit[data-picking=\"1\"]{cursor:crosshair}",
			".wa-outline{position:absolute;border:2px solid #4aa3ff;border-radius:3px;background:rgba(74,163,255,.12);pointer-events:none;transition:all .06s linear}",
			".wa-tip{position:absolute;max-width:280px;padding:7px 9px;border-radius:8px;background:rgba(16,18,22,.96);border:1px solid rgba(127,127,127,.32);color:#e6e8eb;font-size:11px;line-height:1.55;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.45)}",
			".wa-tip b{color:#8cc8ff;font-weight:600}",
			".wa-tip .wa-k{opacity:.55}",
			".wa-composer{position:absolute;display:flex;gap:6px;padding:6px;border-radius:10px;background:var(--dsh-bg-elevated,#1f2229);border:1px solid rgba(127,127,127,.32);box-shadow:0 12px 32px rgba(0,0,0,.5);max-width:420px}",
			".wa-composer input{flex:1 1 auto;height:28px;padding:0 9px;border-radius:7px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:12px;outline:none}",
			".wa-composer input:focus{border-color:rgba(56,160,255,.65)}",
			".wa-foot{flex:0 0 auto;max-height:38%;overflow:auto;border-top:1px solid rgba(127,127,127,.22);background:var(--dsh-bg-elevated,#1f2229)}",
			".wa-note{display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(127,127,127,.14);font-size:11.5px;line-height:1.55}",
			".wa-note-sel{flex:0 0 auto;max-width:42%;color:#8cc8ff;font-family:var(--dsh-font-mono,ui-monospace,Consolas,monospace);opacity:.9;word-break:break-all}",
			".wa-note-body{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word}",
			".wa-note-del{flex:0 0 auto;background:transparent;border:0;color:inherit;opacity:.45;cursor:pointer;font-size:12px;padding:0 2px}",
			".wa-note-del:hover{opacity:1;color:#f08080}",
			".wa-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;height:100%;padding:24px;text-align:center;color:var(--dsh-text-secondary,#9aa4b2)}",
			".wa-empty-title{font-size:13px;font-weight:600;color:var(--dsh-text-primary,#e6e8eb)}",
			".wa-empty-hint{font-size:11.5px;line-height:1.7;max-width:380px;opacity:.82}",
			".wa-empty-row{display:flex;gap:6px;width:100%;max-width:420px}",
			".wa-note-box{padding:6px 10px;font-size:11px;background:rgba(240,180,60,.12);color:#e8c07a;flex:0 0 auto}",
			".wa-note-box[data-kind=\"error\"]{background:rgba(240,128,128,.14);color:#f0a0a0}",
			// 输入框左侧的手动入口按钮
			".wa-open-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;margin-right:6px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsh-text-secondary,#9aa4b2);font-size:12px;line-height:1;cursor:pointer;transition:background .12s,color .12s;white-space:nowrap}",
			".wa-open-btn:hover{background:rgba(127,127,127,.16);color:var(--dsh-text-primary,#e6e8eb)}",
			".wa-open-ico{font-size:12px;opacity:.85}"
		].join("\n");

		function ensureStyle() {
			if (document.getElementById(STYLE_ID)) return;
			var el = document.createElement("style");
			el.id = STYLE_ID;
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		// ------------------------------------------------------------ 输入框桥

		// sidebar.right.pane.tab 的正文拿不到 inputActions（它只发给输入框区域的插槽）。
		// 这里在 conversation.input.left 挂一个组件：一方面把 inputActions 交出来供回填，
		// 另一方面给用户一个随时可点的手动入口，不用等模型主动打开。
		var bridge = { inputActions: null };

		/** 在侧栏打开网页批注面板（空态，等用户输地址）。 */
		function openPanel() {
			var sidebarRight = pluginCtx && pluginCtx.sidebarRight;
			if (!sidebarRight) return;
			try {
				if (typeof sidebarRight.openTab === "function") {
					sidebarRight.openTab(KIND, {});
					return;
				}
				if (typeof sidebarRight.openResource === "function") {
					sidebarRight.openResource(encodeAddress("http://localhost:5173"));
				}
			} catch (e) {
				// 侧栏不可用时静默失败，不影响输入框
			}
		}

		function InputBridge(props) {
			var inputActions = props && props.inputActions;
			React.useEffect(function () {
				if (!inputActions) return undefined;
				bridge.inputActions = inputActions;
				return function () {
					if (bridge.inputActions === inputActions) bridge.inputActions = null;
				};
			}, [inputActions]);

			return h("button", {
				type: "button",
				className: "wa-open-btn",
				title: "打开网页批注面板，可手动输入地址",
				onClick: openPanel
			},
				h("span", { className: "wa-open-ico", "aria-hidden": "true" }, "◱"),
				h("span", null, "网页")
			);
		}

		// ------------------------------------------------------------ 正文

		function AnnotateBody(props) {
			var useTabInfo = props && props.useTabInfo;
			var info = typeof useTabInfo === "function" ? useTabInfo() : null;
			var tab = (info && info.tab) || {};
			var targetUrl = decodeAddress(tab.contentId);

			var s0 = React.useState("");
			var sessionId = s0[0];
			var setSessionId = s0[1];

			var s1 = React.useState("");
			var frameSrc = s1[0];
			var setFrameSrc = s1[1];

			var s2 = React.useState(null);
			var meta = s2[0];
			var setMeta = s2[1];

			var s3 = React.useState(false);
			var picking = s3[0];
			var setPicking = s3[1];

			var s4 = React.useState(null);
			var hover = s4[0];
			var setHover = s4[1];

			var s5 = React.useState(null);
			var editing = s5[0];
			var setEditing = s5[1];

			var s6 = React.useState("");
			var noteText = s6[0];
			var setNoteText = s6[1];

			var s7 = React.useState([]);
			var notes = s7[0];
			var setNotes = s7[1];

			var s8 = React.useState("");
			var banner = s8[0];
			var setBanner = s8[1];

			var s9 = React.useState(targetUrl);
			var draftUrl = s9[0];
			var setDraftUrl = s9[1];

			var s10 = React.useState(false);
			var loading = s10[0];
			var setLoading = s10[1];

			var s11 = React.useState(null);
			var dragRect = s11[0];
			var setDragRect = s11[1];

			var s12 = React.useState(false);
			var notesLoaded = s12[0];
			var setNotesLoaded = s12[1];

			var s13 = React.useState("");
			var textDraft = s13[0];
			var setTextDraft = s13[1];

			var s14 = React.useState(false);
			var textOpen = s14[0];
			var setTextOpen = s14[1];

			var stageRef = React.useRef(null);
			var lastPickAt = React.useRef(0);
			var pendingPick = React.useRef(null);
			var noteInputRef = React.useRef(null);

			React.useEffect(function () {
				ensureStyle();
			}, []);

			// ---- 建立会话 ----
			React.useEffect(function () {
				if (!targetUrl) return;
				var cancelled = false;
				setLoading(true);
				setBanner("正在启动浏览器…");

				post("/session", { url: targetUrl }).then(function (payload) {
					if (cancelled) return;
					if (!payload || !payload.ok) {
						setLoading(false);
						setBanner((payload && payload.error) || "启动失败");
						return;
					}
					setSessionId(payload.data.sessionId);
					setMeta(payload.data.viewport);
					setBanner("");
					setLoading(false);
				}).catch(function (err) {
					if (cancelled) return;
					setLoading(false);
					setBanner(String((err && err.message) || err));
				});

				return function () {
					cancelled = true;
				};
			}, [targetUrl]);

			// ---- 订阅帧 ----
			React.useEffect(function () {
				if (!sessionId) return;
				var source = new EventSource(API + "/frames?session=" + encodeURIComponent(sessionId));
				source.onmessage = function (event) {
					try {
						var payload = JSON.parse(event.data);
						if (payload.type !== "frame") return;
						setFrameSrc("data:image/jpeg;base64," + payload.data);
						if (payload.metadata) setMeta(payload.metadata);
					} catch (e) {
						// 忽略坏帧
					}
				};
				source.onerror = function () {
					setBanner("画面流断开，正在重连…");
				};
				return function () {
					source.close();
				};
			}, [sessionId]);

			// ---- 关闭会话 ----
			React.useEffect(function () {
				if (!sessionId) return;
				return function () {
					fetch(API + "/session/" + encodeURIComponent(sessionId), { method: "DELETE" }).catch(function () {});
				};
			}, [sessionId]);

			React.useEffect(function () {
				if (editing && noteInputRef.current) {
					noteInputRef.current.focus();
				}
			}, [editing]);

			// Ctrl+Shift+. 切换批注拾取模式
			React.useEffect(function () {
				function onKey(event) {
					var isDot = event.key === "." || event.code === "Period";
					if (!isDot || !event.ctrlKey || !event.shiftKey) return;
					event.preventDefault();
					event.stopPropagation();
					setPicking(function (v) { return !v; });
					setEditing(null);
					setHover(null);
				}
				document.addEventListener("keydown", onKey, true);
				return function () {
					document.removeEventListener("keydown", onKey, true);
				};
			}, []);

			// ---- 批注持久化 ----
			React.useEffect(function () {
				setNotesLoaded(false);
				if (!targetUrl) return;
				var restored = [];
				try {
					var raw = window.localStorage.getItem(notesStorageKey(targetUrl));
					if (raw) {
						var parsed = JSON.parse(raw);
						if (Array.isArray(parsed)) restored = parsed;
					}
				} catch (e) {
					restored = [];
				}
				setNotes(restored);
				setNotesLoaded(true);
			}, [targetUrl]);

			React.useEffect(function () {
				if (!targetUrl || !notesLoaded) return;
				try {
					if (notes.length) {
						window.localStorage.setItem(notesStorageKey(targetUrl), JSON.stringify(notes));
					} else {
						window.localStorage.removeItem(notesStorageKey(targetUrl));
					}
				} catch (e) {
					// 隐私模式或配额满时静默放弃，批注仍然可用
				}
			}, [targetUrl, notes, notesLoaded]);

			// ---- 坐标换算 ----
			function stageBox() {
				return stageRef.current ? stageRef.current.getBoundingClientRect() : null;
			}

			function toPageCoords(clientX, clientY) {
				var box = stageBox();
				if (!box || !meta) return null;
				var vw = meta.deviceWidth || meta.width || 1000;
				var vh = meta.deviceHeight || meta.height || 700;
				var sx = vw / box.width;
				var sy = vh / box.height;
				// object-fit: contain 会留黑边，先按 contain 计算实际画面区域
				var scale = Math.min(box.width / vw, box.height / vh);
				var drawW = vw * scale;
				var drawH = vh * scale;
				var offsetX = box.left + (box.width - drawW) / 2;
				var offsetY = box.top + (box.height - drawH) / 2;
				var x = (clientX - offsetX) / scale;
				var y = (clientY - offsetY) / scale;
				if (x < 0 || y < 0 || x > vw || y > vh) return null;
				return { x: Math.round(x), y: Math.round(y), scale: scale, offsetX: offsetX, offsetY: offsetY };
			}

			function rectToDisplay(rect) {
				var box = stageBox();
				if (!box || !meta || !rect) return null;
				var vw = meta.deviceWidth || 1000;
				var vh = meta.deviceHeight || 700;
				var scale = Math.min(box.width / vw, box.height / vh);
				var drawW = vw * scale;
				var drawH = vh * scale;
				var offsetX = (box.width - drawW) / 2;
				var offsetY = (box.height - drawH) / 2;
				var scrollX = meta.scrollOffsetX || 0;
				var scrollY = meta.scrollOffsetY || 0;
				return {
					left: offsetX + (rect.x - scrollX) * scale,
					top: offsetY + (rect.y - scrollY) * scale,
					width: rect.width * scale,
					height: rect.height * scale
				};
			}

			// ---- 拾取 ----
			function pickAt(clientX, clientY) {
				var point = toPageCoords(clientX, clientY);
				if (!point || !sessionId) {
					setHover(null);
					return;
				}
				var now = Date.now();
				if (now - lastPickAt.current < 90) return;
				lastPickAt.current = now;
				pendingPick.current = point;
				post("/pick", { session: sessionId, x: point.x, y: point.y }).then(function (payload) {
					if (!payload || !payload.ok) {
						setHover(null);
						return;
					}
					setHover(payload.data);
				}).catch(function () {
					setHover(null);
				});
			}

			// ---- 指针与键盘 ----

			var dragStartRef = React.useRef(null);

			function onMouseDown(event) {
				if (!picking || !sessionId) return;
				dragStartRef.current = { x: event.clientX, y: event.clientY, moved: false };
			}

			function onMouseMove(event) {
				if (!sessionId) return;

				if (picking && dragStartRef.current) {
					var dx = event.clientX - dragStartRef.current.x;
					var dy = event.clientY - dragStartRef.current.y;
					if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragStartRef.current.moved = true;
					if (dragStartRef.current.moved) {
						setDragRect({ x: dragStartRef.current.x, y: dragStartRef.current.y, w: dx, h: dy });
					}
					return;
				}

				if (picking) pickAt(event.clientX, event.clientY);
			}

			function onMouseUp(event) {
				if (!sessionId) return;
				var start = dragStartRef.current;
				dragStartRef.current = null;
				setDragRect(null);

				var point = toPageCoords(event.clientX, event.clientY);
				if (!point) return;

				if (!picking) {
					post("/input", { session: sessionId, type: "click", x: point.x, y: point.y }).catch(function () {});
					return;
				}

				if (start && start.moved) {
					finishRegion(start, { x: event.clientX, y: event.clientY });
					return;
				}

				// 单击：锁定元素并打开批注输入，不触发页面行为
				post("/pick", { session: sessionId, x: point.x, y: point.y, hover: false }).then(function (payload) {
					if (!payload || !payload.ok || !payload.data) return;
					setHover(payload.data);
					setEditing({
						element: payload.data,
						anchor: { left: event.clientX, top: event.clientY }
					});
					setNoteText("");
				});
			}

			/** 拖出一个矩形：记录区域坐标，并用中心点取一个参考元素。 */
			function finishRegion(start, end) {
				var a = toPageCoords(start.x, start.y);
				var b = toPageCoords(end.x, end.y);
				if (!a || !b) return;
				var region = {
					x: Math.min(a.x, b.x),
					y: Math.min(a.y, b.y),
					width: Math.abs(a.x - b.x),
					height: Math.abs(a.y - b.y)
				};
				if (region.width < 6 || region.height < 6) return;

				post("/pick", {
					session: sessionId,
					x: Math.round(region.x + region.width / 2),
					y: Math.round(region.y + region.height / 2),
					hover: false
				}).then(function (payload) {
					var el = payload && payload.ok ? payload.data : null;
					setEditing({ element: el, region: region, anchor: { left: end.x, top: end.y } });
					setNoteText("");
				});
			}

			function onWheel(event) {
				if (!sessionId) return;
				// 拾取模式下不滚动，避免目标跑掉
				if (picking) return;
				event.preventDefault();
				post("/input", { session: sessionId, type: "wheel", deltaY: event.deltaY }).catch(function () {});
			}

			var PASS_KEYS = ["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];

			function onStageKeyDown(event) {
				if (!sessionId || picking) return;
				if (PASS_KEYS.indexOf(event.key) === -1) return;
				event.preventDefault();
				post("/input", { session: sessionId, type: "key", key: event.key }).catch(function () {});
			}

			// ---- 批注 ----
			function submitNote() {
				var text = noteText.trim();
				if (!text || !editing) return;
				var el = editing.element;
				var region = editing.region;
				var label = region ? "区域 " + region.width + "×" + region.height : (el ? el.selector : "未知元素");
				var tag = region ? "region" : (el ? el.tag : "");
				var rect = region
					? { width: region.width, height: region.height }
					: (el ? el.rect : { width: 0, height: 0 });
				var hint = region && el ? el.selector : "";
				setNotes(function (list) {
					return list.concat([{
						id: String(Date.now()) + "-" + list.length,
						selector: label,
						hint: hint,
						tag: tag,
						rect: rect,
						text: text
					}]);
				});
				setEditing(null);
				setNoteText("");
			}

			function removeNote(id) {
				setNotes(function (list) {
					return list.filter(function (n) { return n.id !== id; });
				});
			}

			function builtDigest() {
				if (!notes.length) return "";
				var lines = ["## 网页批注", "", "页面：" + (targetUrl || ""), ""];
				notes.forEach(function (n, i) {
					var head = (i + 1) + ". `" + n.selector + "`";
					if (n.tag === "region") {
						head += "（框选区域" + (n.hint ? "，覆盖 " + n.hint : "") + "）";
					} else {
						head += "（" + n.tag + "，" + n.rect.width + "×" + n.rect.height + "）";
					}
					lines.push(head);
					lines.push("   " + n.text);
					lines.push("");
				});
				return lines.join("\n").trim();
			}

			function applyDigest() {
				var text = builtDigest();
				if (!text) {
					setBanner("还没有批注");
					return;
				}
				var actions = bridge.inputActions;
				if (actions && typeof actions.setDraft === "function") {
					try {
						actions.setDraft(text);
						setBanner("批注已填入输入框（" + notes.length + " 条）");
						return;
					} catch (err) {
						setBanner("回填失败，已改为复制：" + String((err && err.message) || err));
					}
				} else {
					setBanner("没找到输入框，已改为复制");
				}
				copyDigest();
			}

			function saveToFile() {
				var text = builtDigest();
				if (!text) {
					setBanner("还没有批注");
					return;
				}
				post("/export", { content: text }).then(function (payload) {
					if (payload && payload.ok) {
						setBanner("已保存到 " + payload.data.path);
					} else {
						setBanner((payload && payload.error) || "保存失败");
					}
				}).catch(function (err) {
					setBanner(String((err && err.message) || err));
				});
			}

			/** 把一段文本输入到页面当前焦点元素；insertText 不受键盘布局限制。 */
			function sendText() {
				if (!sessionId) return;
				var text = textDraft;
				if (!text) return;
				post("/input", { session: sessionId, type: "text", text: text }).then(function (payload) {
					if (payload && payload.ok) {
						setTextDraft("");
						setTextOpen(false);
						setBanner("已输入到页面");
					} else {
						setBanner((payload && payload.error) || "输入失败");
					}
				}).catch(function (err) {
					setBanner(String((err && err.message) || err));
				});
			}

			function copyDigest() {
				var text = builtDigest();
				if (!text) {
					setBanner("还没有批注");
					return;
				}
				var done = function (ok) {
					setBanner(ok ? "批注已复制到剪贴板" : "复制失败");
				};
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
					return;
				}
				var area = document.createElement("textarea");
				area.value = text;
				area.style.position = "fixed";
				area.style.left = "-9999px";
				document.body.appendChild(area);
				area.select();
				var ok = false;
				try {
					ok = document.execCommand("copy");
				} catch (e) {
					ok = false;
				}
				area.remove();
				done(ok);
			}

			function openUrl(raw) {
				var url = normalizeInput(raw);
				if (!url) {
					setBanner("先输入一个地址");
					return;
				}
				var sidebarRight = pluginCtx && pluginCtx.sidebarRight;
				if (!sidebarRight || typeof sidebarRight.openResource !== "function") {
					setBanner("侧栏导航服务不可用");
					return;
				}
				try {
					sidebarRight.openResource(encodeAddress(url));
				} catch (err) {
					setBanner("打开失败：" + String((err && err.message) || err));
				}
			}

			// ---- 渲染 ----
			var bar = h("div", { className: "wa-bar" },
				h("input", {
					className: "wa-input",
					value: draftUrl,
					placeholder: "localhost:5173 或 https://example.com",
					spellCheck: false,
					onChange: function (e) { setDraftUrl(e.target.value); },
					onKeyDown: function (e) {
						if (e.key === "Enter") {
							e.preventDefault();
							openUrl(draftUrl);
						}
					}
				}),
				h("button", { type: "button", className: "wa-btn", "data-primary": "1", onClick: function () { openUrl(draftUrl); } }, "打开"),
				h("button", {
					type: "button",
					className: "wa-btn",
					"data-active": picking ? "1" : "0",
					title: "指向网页元素以添加批注",
					disabled: !sessionId,
					onClick: function () {
						setPicking(function (v) { return !v; });
						setEditing(null);
						setHover(null);
					}
				}, "◱ 批注"),
				h("button", {
					type: "button",
					className: "wa-btn",
					title: "重新加载页面",
					disabled: !sessionId,
					onClick: function () {
						if (!sessionId) return;
						post("/reload", { session: sessionId }).catch(function () {});
					}
				}, "↻"),
				h("button", {
					type: "button",
					className: "wa-btn",
					title: "把批注汇总回填到输入框",
					disabled: !notes.length,
					onClick: applyDigest
				}, "↩ " + (notes.length ? notes.length : "")),
				h("button", {
					type: "button",
					className: "wa-btn",
					title: "复制批注汇总",
					disabled: !notes.length,
					onClick: copyDigest
				}, "⧉"),
				h("button", {
					type: "button",
					className: "wa-btn",
					"data-active": textOpen ? "1" : "0",
					title: "向页面输入文本（支持中文）",
					disabled: !sessionId,
					onClick: function () {
						setTextOpen(function (v) { return !v; });
					}
				}, "⌨"),
				h("button", {
					type: "button",
					className: "wa-btn",
					title: "把批注保存成 Markdown 文件",
					disabled: !notes.length,
					onClick: saveToFile
				}, "⤓")
			);

			if (!targetUrl) {
				return h("div", { className: "wa-root" },
					bar,
					banner ? h("div", { className: "wa-note-box", "data-kind": "error" }, banner) : null,
					h("div", { className: "wa-empty" },
						h("div", { className: "wa-empty-title" }, "网页批注"),
						h("div", { className: "wa-empty-hint" },
							"在侧栏里跑一个真实浏览器页面。开启「批注」后，指向任意元素即可看到它的标签、尺寸、颜色与字体，点一下就地下评论。",
							h("br", null),
							"批注汇总可一键复制成结构化指令，贴进输入框让我去改。"
						),
						h("div", { className: "wa-empty-row" },
							h("input", {
								className: "wa-input",
								value: draftUrl,
								placeholder: "localhost:5173",
								spellCheck: false,
								onChange: function (e) { setDraftUrl(e.target.value); },
								onKeyDown: function (e) {
									if (e.key === "Enter") {
										e.preventDefault();
										openUrl(draftUrl);
									}
								}
							}),
							h("button", { type: "button", className: "wa-btn", "data-primary": "1", onClick: function () { openUrl(draftUrl); } }, "开始")
						)
					)
				);
			}

			var outline = picking && hover && meta ? (function () {
				var box = rectToDisplay(hover.rect);
				if (!box) return null;
				return h("div", {
					className: "wa-outline",
					style: { left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" }
				});
			})() : null;

			var tip = picking && hover && meta ? (function () {
				var box = rectToDisplay(hover.rect);
				if (!box) return null;
				var top = Math.max(4, box.top - 76);
				return h("div", {
					className: "wa-tip",
					style: { left: Math.max(4, box.left) + "px", top: top + "px" }
				},
					h("div", null, h("b", null, hover.tag), hover.id ? h("span", null, " #" + hover.id) : null),
					h("div", null, h("span", { className: "wa-k" }, "尺寸 "), hover.rect.width + "×" + hover.rect.height),
					h("div", null, h("span", { className: "wa-k" }, "颜色 "), hover.style.background),
					h("div", null, h("span", { className: "wa-k" }, "字体 "), hover.style.font),
					hover.framePath && hover.framePath.length
						? h("div", null, h("span", { className: "wa-k" }, "所在 "), hover.framePath.join(" › "))
						: null
				);
			})() : null;

			var composer = editing ? (function () {
				var box = stageBox();
				var left = 8;
				var top = 8;
				if (box && editing.anchor) {
					left = Math.min(Math.max(8, editing.anchor.left - box.left), Math.max(8, box.width - 428));
					top = Math.min(Math.max(8, editing.anchor.top - box.top + 14), Math.max(8, box.height - 60));
				}
				return h("div", { className: "wa-composer", style: { left: left + "px", top: top + "px" } },
					h("input", {
						ref: noteInputRef,
						value: noteText,
						placeholder: "添加评论…",
						spellCheck: false,
						onChange: function (e) { setNoteText(e.target.value); },
						onKeyDown: function (e) {
							if (e.key === "Enter") {
								e.preventDefault();
								submitNote();
							}
							if (e.key === "Escape") {
								e.preventDefault();
								setEditing(null);
								setNoteText("");
							}
						}
					}),
					h("button", { type: "button", className: "wa-btn", "data-primary": "1", onClick: submitNote }, "添加"),
					h("button", {
						type: "button",
						className: "wa-btn",
						onClick: function () {
							setEditing(null);
							setNoteText("");
						}
					}, "取消")
				);
			})() : null;

			// 页面文本输入面板：insertText 支持中文与任意字符，不受键盘布局限制
			var textPanel = textOpen ? h("div", { className: "wa-composer", style: { left: "8px", top: "8px" } },
				h("input", {
					value: textDraft,
					placeholder: "输入要发到页面的文本…",
					spellCheck: false,
					onChange: function (e) { setTextDraft(e.target.value); },
					onKeyDown: function (e) {
						if (e.key === "Enter") {
							e.preventDefault();
							sendText();
						}
						if (e.key === "Escape") {
							e.preventDefault();
							setTextOpen(false);
						}
					}
				}),
				h("button", { type: "button", className: "wa-btn", "data-primary": "1", onClick: sendText }, "输入"),
				h("button", { type: "button", className: "wa-btn", onClick: function () { setTextOpen(false); } }, "关闭")
			) : null;

			var foot = notes.length ? h("div", { className: "wa-foot" },
				notes.map(function (n) {
					return h("div", { className: "wa-note", key: n.id },
						h("span", { className: "wa-note-sel", title: n.hint || n.selector }, n.selector),
						h("span", { className: "wa-note-body" }, n.text),
						h("button", {
							type: "button",
							className: "wa-note-del",
							title: "删除这条批注",
							onClick: function () { removeNote(n.id); }
						}, "✕")
					);
				})
			) : null;

			return h("div", { className: "wa-root" },
				bar,
				banner ? h("div", { className: "wa-note-box", "data-kind": "error" }, banner) : null,
				h("div", { className: "wa-stage", ref: stageRef },
					frameSrc
						? h("img", { className: "wa-frame", src: frameSrc, alt: "网页画面", draggable: false })
						: h("div", { className: "wa-empty" },
							h("div", { className: "wa-empty-title" }, loading ? "正在加载页面…" : "等待画面"),
							h("div", { className: "wa-empty-hint" }, "首次启动浏览器需要几秒。")
						),
					h("div", {
						className: "wa-hit",
						"data-picking": picking ? "1" : "0",
						tabIndex: 0,
						onMouseDown: onMouseDown,
						onMouseMove: onMouseMove,
						onMouseUp: onMouseUp,
						onWheel: onWheel,
						onKeyDown: onStageKeyDown
					}),
					dragRect ? h("div", {
						className: "wa-marquee",
						style: {
							left: Math.min(dragRect.x, dragRect.x + dragRect.w) + "px",
							top: Math.min(dragRect.y, dragRect.y + dragRect.h) + "px",
							width: Math.abs(dragRect.w) + "px",
							height: Math.abs(dragRect.h) + "px"
						}
					}) : null,
					outline,
					tip,
					composer,
					textPanel
				),
				foot
			);
		}

		// ------------------------------------------------------------ 入口

		function apply(ctx) {
			pluginCtx = ctx;
			ensureStyle();

			ctx.effect(function () {
				return ctx.slots.inject("sidebar.right.pane.tab", function () {
					return ctx.slots.register({ name: "sidebar.right.pane.tab", key: ID }, AnnotateBody);
				});
			}, "web-annotate: body");

			ctx.effect(function () {
				return ctx.slots.inject("conversation.input.left", function () {
					return ctx.slots.register(
						{ name: "conversation.input.left", id: ID + ":bridge", order: 900 },
						InputBridge
					);
				});
			}, "web-annotate: input bridge");

			ctx.effect(function () {
				if (!ctx.sidebarRightTabs || typeof ctx.sidebarRightTabs.register !== "function") {
					return function () {};
				}
				return ctx.sidebarRightTabs.register({
					id: ID,
					kind: KIND,
					patterns: [ADDRESS_PREFIX + "[\\s\\S]+"],
					priority: "extension",
					title: function (address) {
						var url = decodeAddress(address);
						return url ? hostOf(url) : "网页批注";
					},
					guide: [
						{
							id: ID + ":entry",
							kind: KIND,
							title: "网页批注",
							description: "在侧栏里指向元素并就地批注",
							order: 21
						}
					]
				});
			}, "web-annotate: tab type");
		}

		module.exports = { apply: apply, inject: inject };
		return module.exports;
	}
});
