window.__ModuleLoader__.load({
	id: "dsh-paper-suite",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** Shared id between the sidebar entry and the main panel. */
		const PANEL_ID = "paper-suite";
		/** Exact route the host half registers for this panel. */
		const REPORT_URL = "/paper-suite/report.json";

		const CSS = `
.ps-root{height:100%;overflow:auto;padding:18px 22px 40px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.ps-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.ps-title{font-size:16px;font-weight:600;margin:0}
.ps-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.ps-actions{margin-left:auto;display:flex;gap:8px}
.ps-button{border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 12px;font:inherit;cursor:pointer}
.ps-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ps-button:disabled{opacity:.5;cursor:default}
.ps-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0 16px}
.ps-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 12px}
.ps-card b{display:block;font-size:20px;font-weight:600;line-height:26px}
.ps-card span{color:var(--dsw-alias-label-tertiary);font-size:12px}
.ps-grid{display:grid;grid-template-columns:minmax(220px,0.9fr) minmax(0,1.6fr);gap:14px;align-items:start}
@media (max-width:900px){.ps-grid{grid-template-columns:minmax(0,1fr)}}
.ps-list{display:flex;flex-direction:column;gap:6px}
.ps-item{text-align:left;width:100%;border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:7px;padding:8px 10px;font:inherit;cursor:pointer}
.ps-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ps-item.ps-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-selected,rgba(64,128,255,.08))}
.ps-item-top{display:flex;align-items:center;gap:8px}
.ps-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-score{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.ps-bars{display:flex;gap:10px;margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.ps-bar-track{width:52px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l1);display:inline-block;vertical-align:middle;margin-left:4px;overflow:hidden}
.ps-bar{height:4px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.ps-badge{display:inline-block;border-radius:999px;padding:1px 7px;font-size:11px;border:.5px solid var(--dsw-alias-border-l2)}
.ps-pass{color:var(--dsw-alias-state-success-primary,#2f9e44);border-color:var(--dsw-alias-state-success-primary,#2f9e44)}
.ps-warn{color:var(--dsw-alias-state-warning-primary,#c98a00);border-color:var(--dsw-alias-state-warning-primary,#c98a00)}
.ps-fail{color:var(--dsw-alias-state-error-primary,#d92d20);border-color:var(--dsw-alias-state-error-primary,#d92d20)}
.ps-detail{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;min-width:0}
.ps-detail h3{margin:0;font-size:14px}
.ps-path{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;margin-top:2px}
.ps-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:6px;margin:12px 0}
.ps-stat{border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 8px}
.ps-stat b{display:block;font-size:14px}
.ps-stat span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.ps-group{margin-top:14px}
.ps-group h4{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);margin:0 0 6px}
.ps-finding{display:flex;gap:8px;padding:5px 0;border-bottom:.5px solid var(--dsw-alias-border-l1);align-items:flex-start}
.ps-finding:last-child{border-bottom:0}
.ps-sev{font-family:var(--ds-font-family-code);font-size:11px;font-weight:600;flex:none;width:52px}
.ps-sev-error{color:var(--dsw-alias-state-error-primary,#d92d20)}
.ps-sev-warn{color:var(--dsw-alias-state-warning-primary,#c98a00)}
.ps-sev-info{color:var(--dsw-alias-label-tertiary)}
.ps-msg{flex:1;min-width:0}
.ps-loc{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px;word-break:break-all}
.ps-chip{display:inline-block;border:.5px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 5px;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-right:6px}
.ps-empty{color:var(--dsw-alias-label-tertiary);padding:16px 0}
.ps-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
`;

		/** Inject the panel stylesheet once. */
		function installStyles() {
			if (document.getElementById("paper-suite-style") !== null) return;
			const style = document.createElement("style");
			style.id = "paper-suite-style";
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		const VERDICT_LABEL = { pass: "通过", warn: "警告", fail: "失败" };

		/** Colour class for a verdict. */
		function verdictClass(verdict) {
			return verdict === "fail" ? "ps-fail" : verdict === "warn" ? "ps-warn" : "ps-pass";
		}

		/** One labelled score bar. */
		function ScoreBar(props) {
			return h(
				"span",
				null,
				props.label,
				h(
					"span",
					{ className: "ps-bar-track" },
					h("span", { className: "ps-bar", style: { width: `${props.value}%` } })
				)
			);
		}

		/** Sidebar row for one paper. */
		function PaperRow(props) {
			const paper = props.paper;
			return h(
				"button",
				{
					type: "button",
					className: `ps-item${props.active ? " ps-active" : ""}`,
					onClick: () => props.onSelect(paper.slug)
				},
				h(
					"div",
					{ className: "ps-item-top" },
					h("span", { className: `ps-badge ${verdictClass(paper.verdict)}` }, VERDICT_LABEL[paper.verdict] ?? paper.verdict),
					h("span", { className: "ps-name" }, paper.slug),
					h("span", { className: "ps-score" }, String(paper.overall))
				),
				h(
					"div",
					{ className: "ps-bars" },
					h(ScoreBar, { label: "完整", value: paper.scores.completeness }),
					h(ScoreBar, { label: "结果", value: paper.scores.results }),
					h(ScoreBar, { label: "逻辑", value: paper.scores.logic })
				)
			);
		}

		/** Findings grouped by severity. */
		function Findings(props) {
			const order = [
				["error", "错误"],
				["warn", "警告"],
				["info", "提示"]
			];
			const groups = order
				.map(([severity, label]) => [label, props.findings.filter((item) => item.severity === severity)])
				.filter(([, items]) => items.length > 0);

			if (groups.length === 0) return h("div", { className: "ps-empty" }, "没有发现问题。");

			return h(
				"div",
				null,
				...groups.map(([label, items], index) =>
					h(
						"div",
						{ className: "ps-group", key: index },
						h("h4", null, `${label}（${items.length}）`),
						...items.map((item, i) =>
							h(
								"div",
								{ className: "ps-finding", key: i },
								h("span", { className: `ps-sev ps-sev-${item.severity}` }, item.severity.toUpperCase()),
								h(
									"div",
									{ className: "ps-msg" },
									h("div", null, h("span", { className: "ps-chip" }, item.category ?? "general"), item.message),
									item.locator === undefined ? null : h("div", { className: "ps-loc" }, item.locator)
								)
							)
						)
					)
				)
			);
		}

		/** Detail pane for the selected paper. */
		function PaperDetail(props) {
			const paper = props.paper;
			if (paper === undefined) return h("div", { className: "ps-detail ps-empty" }, "左侧选择一篇论文。");
			const stats = [
				["章节", `${paper.stats.sections}/${paper.stats.sectionsTotal}`],
				["表格", paper.stats.tables],
				["图", paper.stats.figures],
				["Claim", paper.stats.claims],
				["引用键", paper.stats.citations],
				["未引用条目", paper.stats.uncited],
				["PDF", paper.stats.pdf]
			];
			return h(
				"div",
				{ className: "ps-detail" },
				h("h3", null, paper.title ?? paper.slug),
				h("div", { className: "ps-path" }, paper.dir),
				h(
					"div",
					{ className: "ps-stats" },
					...stats.map(([label, value], index) =>
						h("div", { className: "ps-stat", key: index }, h("b", null, String(value)), h("span", null, label))
					)
				),
				h(Findings, { findings: paper.findings })
			);
		}

		/** The panel body. */
		function PaperPanel() {
			const [state, setState] = react.useState({ kind: "loading" });
			const [selected, setSelected] = react.useState(undefined);

			const load = react.useCallback((fresh) => {
				setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
				fetch(fresh === true ? `${REPORT_URL}?fresh=1` : REPORT_URL, { headers: { accept: "application/json" } })
					.then(async (response) => {
						if (response.status === 404) {
							throw new Error(
								"论文审计 Host 路由未注册（404）。请确认 dsh-paper-suite 已安装并重启 DSH，或当前 Host/Client 版本不一致。"
							);
						}
						if (!response.ok) throw new Error(`HTTP ${response.status}`);
						return response.json();
					})
					.then((report) => setState({ kind: "ready", report }))
					.catch((error) => setState({ kind: "error", message: String(error && error.message ? error.message : error) }));
			}, []);

			react.useEffect(() => {
				load(false);
			}, [load]);

			const report = state.kind === "ready" ? state.report : undefined;
			const papers = report?.papers ?? [];
			const current = papers.find((paper) => paper.slug === selected) ?? papers[0];

			const body =
				state.kind === "loading"
					? h("div", { className: "ps-empty" }, "正在审计…")
					: state.kind === "error"
						? h("div", { className: "ps-error" }, state.message)
						: papers.length === 0
							? h(
									"div",
									{ className: "ps-empty" },
									`在 ${report.root} 下没有找到含 main.tex 的论文目录。可在 profile 的 cordis.patch.yml 里为 dsh-paper-suite 配置 repoRoot。`
								)
							: h(
									"div",
									{ className: "ps-grid" },
									h(
										"div",
										{ className: "ps-list" },
										...papers.map((paper) =>
											h(PaperRow, {
												key: paper.slug,
												paper,
												active: current !== undefined && paper.slug === current.slug,
												onSelect: setSelected
											})
										)
									),
									h(PaperDetail, { paper: current })
								);

			return h(
				"div",
				{ className: "ps-root" },
				h(
					"div",
					{ className: "ps-head" },
					h(
						"div",
						null,
						h("h2", { className: "ps-title" }, "论文审计"),
						h(
							"div",
							{ className: "ps-sub" },
							report === undefined ? "完整性 · 结果一致性 · 论证逻辑" : `${report.root}${report.generatedAt ? ` · ${report.generatedAt.replace("T", " ").slice(0, 19)}` : ""}`
						)
					),
					h(
						"div",
						{ className: "ps-actions" },
						h(
							"button",
							{ type: "button", className: "ps-button", onClick: () => load(true), disabled: state.kind === "loading" },
							"重新审计"
						)
					)
				),
				report === undefined
					? null
					: h(
							"div",
							{ className: "ps-cards" },
							h("div", { className: "ps-card" }, h("b", null, report.summary.papers), h("span", null, "论文")),
							h("div", { className: "ps-card" }, h("b", null, report.summary.pass), h("span", null, "通过")),
							h("div", { className: "ps-card" }, h("b", null, report.summary.warn), h("span", null, "警告")),
							h("div", { className: "ps-card" }, h("b", null, report.summary.fail), h("span", null, "失败"))
						),
				body
			);
		}

		/** Sidebar icon. */
		function PaperIcon() {
			return h(
				"svg",
				{ width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" },
				h("path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }),
				h("path", { d: "M14 3v5h5" }),
				h("path", { d: "M9 13h6M9 17h4" })
			);
		}

		const inject = ["slots"];

		/** Register the sidebar entry and the panel it opens. */
		function apply(ctx) {
			installStyles();
			ctx.slots.inject("main", function* () {
				yield ctx.slots.register({ name: "main", key: PANEL_ID }, PaperPanel);
			});
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{ name: "sidebar.panellist", id: PANEL_ID, order: 21, label: "论文审计" },
					PaperIcon
				)
			);
		}

		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
