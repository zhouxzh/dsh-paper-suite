/**
 * Manuscript review: is the paper complete, are its numbers consistent, and does
 * the argument hold together?
 *
 * Mechanical checks (missing files, undefined refs, absent figure files, claim
 * rows without evidence, stale PDF) are hard failures. Rhetorical checks
 * (does the discussion contain a limitation statement) are heuristics and are
 * reported as info, never as errors.
 *
 * @module dsh-paper-suite/review
 */

import { join } from 'node:path';
import { auditPaper } from './audit.js';
import { exists, finding, listFiles, readText, relPath } from './util.js';

/** The canonical per-file layout used by the papers this suite scaffolds. */
const REQUIRED_SECTIONS = [
	'sections/abstract.tex',
	'sections/introduction.tex',
	'sections/related_work.tex',
	'sections/method.tex',
	'sections/experimental_setup.tex',
	'sections/results.tex',
	'sections/discussion.tex',
	'sections/conclusion.tex',
	'sections/declarations.tex'
];

/** Sections whose absence is a hard failure in the canonical layout. */
const CORE_SECTION_FILES = new Set([
	'sections/abstract.tex',
	'sections/introduction.tex',
	'sections/method.tex',
	'sections/experimental_setup.tex',
	'sections/results.tex',
	'sections/conclusion.tex'
]);

/**
 * Semantic roles, used when a paper does not use the canonical file layout.
 * Single-file manuscripts (PMS, Regime-Gated) still get a real completeness
 * check instead of being failed for a filename they never promised to use.
 */
const SECTION_ROLES = [
	{ key: 'abstract', label: '摘要', pattern: /\\begin\{abstract\}|\\section\*?\{[^}]*(?:摘要|Abstract)/i, core: true },
	{ key: 'introduction', label: '引言', pattern: /\\section\*?\{[^}]*(?:引言|前言|Introduction)/i, core: true },
	{ key: 'related', label: '相关工作', pattern: /\\section\*?\{[^}]*(?:相关|Related)/i, core: false },
	{ key: 'method', label: '方法', pattern: /\\section\*?\{[^}]*(?:方法|模型|Method|Approach|Model)/i, core: true },
	{
		key: 'setup',
		label: '实验设计',
		pattern: /\\section\*?\{[^}]*(?:实验|评估|Experimental|Evaluation|Setup|Protocol|协议|Reproducib)/i,
		core: true
	},
	{ key: 'results', label: '结果', pattern: /\\section\*?\{[^}]*(?:结果|Results)/i, core: true },
	{ key: 'discussion', label: '讨论', pattern: /\\section\*?\{[^}]*(?:讨论|Discussion|Interpretation|分析)/i, core: false },
	{ key: 'limitations', label: '局限', pattern: /\\section\*?\{[^}]*(?:局限|Limitation)/i, core: false },
	{ key: 'conclusion', label: '结论', pattern: /\\section\*?\{[^}]*(?:结论|总结|Conclusion)/i, core: true },
	{ key: 'declarations', label: '声明', pattern: /\\section\*?\{[^}]*(?:声明|数据、代码|Declarations)/i, core: false }
];

/** A body section below this many characters is treated as unwritten. */
const MIN_SECTION_CHARS = 120;

/** Numbers that carry no evidential weight. */
const TRIVIAL_NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/** Keywords that suggest a limitation/boundary statement (zh + en). */
const LIMITATION_WORDS = /局限|限制|边界|不适用|不推广|不涵盖|未能|未证明|limitation|boundary|does not|cannot|not generaliz/i;

/** Keywords that suggest an explicit contribution list. */
const CONTRIBUTION_WORDS = /贡献|本文提出|我们提出|contribution|we propose|we introduce/i;

/** Strip LaTeX comments while preserving length. */
function stripComments(text) {
	return text.replace(/(^|[^\\])(%[^\n]*)/gm, (_m, prefix, comment) => prefix + ' '.repeat(comment.length));
}

/** Count CJK characters plus Latin words, ignoring commands and braces. */
function proseLength(text) {
	const bare = stripComments(text)
		.replace(/\\(?:begin|end)\{[^}]*\}/g, ' ')
		.replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g, ' ')
		.replace(/[{}]/g, ' ');
	const cjk = (bare.match(/[\u3400-\u9fff]/g) ?? []).length;
	const words = (bare.match(/[A-Za-z][A-Za-z-]+/g) ?? []).length;
	return cjk + words * 2;
}

/** Numeric tokens worth cross-checking. */
function numericTokens(text) {
	const tokens = stripComments(text).match(/-?\d+(?:\.\d+)?%?/g) ?? [];
	return [...new Set(tokens.filter((token) => !TRIVIAL_NUMBERS.has(token.replace('%', ''))))];
}

/** Labels and references defined in one file. */
function refsAndLabels(text) {
	const labels = [...text.matchAll(/\\label\{([^}]+)\}/g)].map((m) => m[1]);
	const refs = [...text.matchAll(/\\(?:ref|eqref|autoref|cref|Cref|pageref)\{([^}]+)\}/g)].map((m) => m[1]);
	return { labels, refs };
}

/** Rows of the claims register: id, evidence cell, status. */
function parseClaims(text) {
	const rows = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
		if (cells.length < 3) continue;
		if (/^-+$/.test(cells[0].replace(/[:\s]/g, ''))) continue;
		if (/^id$/i.test(cells[0])) continue;
		// Both `| id | claim | evidence | status |` and the older
		// `| claim | evidence | status |` shape are accepted.
		const id = cells.length >= 4 ? cells[0] : `C${rows.length + 1}`;
		rows.push({
			id,
			evidence: cells[cells.length - 2],
			status: cells[cells.length - 1]
		});
	}
	return rows;
}

/** One scored check. `soft` checks never fail the paper. */
function check(category, label, ok, failFinding, soft = false) {
	return { category, label, ok, soft, finding: ok ? undefined : failFinding };
}

/**
 * Review one paper workspace.
 * @param {{dir: string}} options
 */
export async function reviewPaper({ dir }) {
	const checks = [];
	const base = await auditPaper({ dir });

	// ---------------------------------------------------------------- completeness
	const texAll = await listFiles(dir, { extensions: ['.tex'] });
	const combined = [];
	for (const path of texAll) {
		const text = (await readText(path)) ?? '';
		combined.push({ file: relPath(dir, path), text });
	}
	const combinedText = combined.map((item) => item.text).join('\n');

	// Two supported layouts: the canonical `sections/*.tex` split, or a
	// single-file manuscript whose sections are found by heading. Judging a
	// single-file paper against the split layout reported false failures.
	const canonical = await exists(join(dir, 'sections', 'abstract.tex'));
	const sections = [];

	if (canonical) {
		for (const relative of REQUIRED_SECTIONS) {
			const text = await readText(join(dir, relative));
			const name = relative.replace('sections/', '').replace('.tex', '');
			const core = CORE_SECTION_FILES.has(relative);
			if (text === undefined) {
				sections.push({ name, present: false, chars: 0 });
				checks.push(
					check(
						'completeness',
						`${name} 章节存在`,
						false,
						finding(core ? 'error' : 'warn', 'section-missing', `缺少 ${relative}`, relative),
						!core
					)
				);
				continue;
			}
			const chars = proseLength(text);
			const present = chars >= (name === 'abstract' ? 80 : MIN_SECTION_CHARS);
			sections.push({ name, present, chars });
			checks.push(
				check(
					'completeness',
					`${name} 章节已撰写`,
					present,
					finding('warn', 'section-thin', `${relative} 只有 ${chars} 字，可能仍是占位`, relative)
				)
			);
		}
	} else {
		for (const role of SECTION_ROLES) {
			const present = role.pattern.test(combinedText);
			sections.push({ name: role.key, present, chars: 0 });
			checks.push(
				check(
					'completeness',
					`${role.label} 章节存在`,
					present,
					finding(role.core ? 'error' : 'warn', 'section-missing', `没有找到「${role.label}」章节`, role.key),
					!role.core
				)
			);
		}
	}

	const claimsText = await readText(join(dir, 'claims_register.md'));
	const claims = claimsText === undefined ? [] : parseClaims(claimsText);
	checks.push(
		check(
			'completeness',
			'claims register 有 claim',
			claims.length > 0,
			finding('warn', 'claims-empty', 'claims_register.md 没有登记任何 claim', 'claims_register.md'),
			true
		)
	);
	// An empty evidence cell is a real defect; prose-only provenance is accepted
	// (older registers describe the source instead of linking a path).
	const emptyEvidence = claims.filter(
		(row) => row.evidence.length === 0 || /^<.*>$/.test(row.evidence) || /^pending$/i.test(row.evidence)
	);
	checks.push(
		check(
			'completeness',
			'每条 claim 都写了证据来源',
			emptyEvidence.length === 0,
			finding(
				'error',
				'claim-without-evidence',
				`${emptyEvidence.length} 条 claim 的 Evidence 列为空：${emptyEvidence.map((r) => r.id).join(', ')}`,
				'claims_register.md'
			)
		)
	);
	const machineReadable = claims.filter((row) => row.evidence.includes('`'));
	checks.push(
		check(
			'completeness',
			'claim 证据可用工具解析',
			claims.length === 0 || machineReadable.length === claims.length,
			finding(
				'info',
				'claim-evidence-not-machine-readable',
				`${claims.length - machineReadable.length} 条 claim 的证据是散文描述，paper_audit 无法自动核验`,
				'claims_register.md'
			),
			true
		)
	);

	checks.push(
		check(
			'completeness',
			'PDF 已生成且不旧于源文件',
			base.freshness.state === 'fresh',
			finding('warn', 'pdf-not-fresh', `main.pdf 状态：${base.freshness.state}`, 'main.pdf')
		)
	);

	// -------------------------------------------------------------------- results
	const texPaths = await listFiles(dir, { extensions: ['.tex'] });
	const texText = new Map();
	for (const path of texPaths) texText.set(relPath(dir, path), (await readText(path)) ?? '');

	const allLabels = new Set();
	const allRefs = [];
	for (const [name, text] of texText) {
		const { labels, refs } = refsAndLabels(text);
		for (const label of labels) allLabels.add(label);
		for (const ref of refs) allRefs.push({ ref, file: name });
	}
	const danglingRefs = allRefs.filter((item) => !allLabels.has(item.ref));
	checks.push(
		check(
			'results',
			'所有 \\ref 都有对应 \\label',
			danglingRefs.length === 0,
			finding(
				'error',
				'dangling-reference',
				`${danglingRefs.length} 处引用没有对应 label：${[...new Set(danglingRefs.map((r) => r.ref))].join(', ')}`,
				danglingRefs[0]?.file
			)
		)
	);

	const graphics = [];
	for (const [name, text] of texText) {
		for (const match of text.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
			const target = match[1].trim();
			const candidates = [join(dir, target), join(dir, '..', target), join(dir, `${target}.png`), join(dir, `${target}.pdf`)];
			let found = false;
			for (const candidate of candidates) if (await exists(candidate)) found = true;
			graphics.push({ target, found, file: name });
		}
	}
	const missingGraphics = graphics.filter((item) => !item.found);
	checks.push(
		check(
			'results',
			'引用的图文件都存在',
			missingGraphics.length === 0,
			finding(
				'error',
				'missing-figure',
				`${missingGraphics.length} 个图文件不存在：${missingGraphics.map((g) => g.target).join(', ')}`,
				missingGraphics[0]?.file
			)
		)
	);

	const tableCount = [...texText.values()].reduce((sum, text) => sum + (text.match(/\\begin\{table\}/g) ?? []).length, 0);
	const captionCount = [...texText.values()].reduce((sum, text) => sum + (text.match(/\\caption\{/g) ?? []).length, 0);
	checks.push(
		check(
			'results',
			'每张表都有 caption',
			tableCount === 0 || captionCount >= tableCount,
			finding('warn', 'table-without-caption', `${tableCount} 个 table 环境只有 ${captionCount} 个 caption`)
		)
	);

	const resultsText = [...texText.entries()].filter(([name]) => /results\.tex$/.test(name)).map(([, text]) => text).join('\n');
	const evidenceFiles = await listFiles(join(dir, 'evidence'), { extensions: ['.csv', '.json', '.md'] });
	let evidenceText = '';
	for (const path of evidenceFiles) evidenceText += `${await readText(path)}\n`;
	const claimNumbers = [...new Set(numericTokens(resultsText))];
	checks.push(
		check(
			'results',
			'结果章节含可核对数字',
			claimNumbers.length > 0,
			finding('warn', 'results-no-numbers', 'results.tex 里没有可核对的结果数字')
		)
	);

	// Abstract and conclusion numbers must be traceable to the results section or
	// the evidence tables. This is a string-level check, so a miss is a warning.
	const abstractText = texText.get('sections/abstract.tex') ?? '';
	const conclusionText = texText.get('sections/conclusion.tex') ?? '';
	const summaryNumbers = [...new Set([...numericTokens(abstractText), ...numericTokens(conclusionText)])];
	const haystack = `${resultsText}\n${evidenceText}`;
	const orphanNumbers = summaryNumbers.filter((token) => !haystack.includes(token));
	checks.push(
		check(
			'results',
			'摘要/结论数字都能在结果或证据中找到',
			orphanNumbers.length === 0,
			finding(
				'warn',
				'untraceable-number',
				`${orphanNumbers.length} 个数字在结果与 evidence 中找不到：${orphanNumbers.slice(0, 8).join(', ')}`,
				'sections/abstract.tex'
			),
			true
		)
	);

	// ---------------------------------------------------------------------- logic
	const introduction = texText.get('sections/introduction.tex') ?? '';
	const discussion = texText.get('sections/discussion.tex') ?? '';
	checks.push(
		check(
			'logic',
			'引言列出明确贡献',
			CONTRIBUTION_WORDS.test(introduction) || /\\begin\{enumerate\}/.test(introduction),
			finding('info', 'no-contribution-list', '引言没有明显的贡献列表或“本文提出”式陈述', 'sections/introduction.tex'),
			true
		)
	);
	checks.push(
		check(
			'logic',
			'讨论写明限制或适用范围',
			LIMITATION_WORDS.test(discussion),
			finding('info', 'no-limitation', '讨论没有明显的局限/边界陈述', 'sections/discussion.tex'),
			true
		)
	);
	checks.push(
		check(
			'logic',
			'结论重申适用范围',
			LIMITATION_WORDS.test(conclusionText),
			finding('info', 'conclusion-no-boundary', '结论没有重申适用范围或不推广声明', 'sections/conclusion.tex'),
			true
		)
	);

	const supported = claims.filter((row) => /supported/i.test(row.status));
	const pending = claims.filter((row) => /pending/i.test(row.status));
	checks.push(
		check(
			'logic',
			'没有 claim 停留在 pending',
			pending.length === 0,
			finding(
				'info',
				'claims-pending',
				`${pending.length} 条 claim 仍是 pending（${pending.slice(0, 6).map((r) => r.id).join(', ')}）`,
				'claims_register.md'
			),
			true
		)
	);

	// --------------------------------------------------------------------- output
	const findings = [...base.findings.map((item) => ({ ...item, category: 'citations' }))];
	for (const item of checks) {
		if (item.finding !== undefined) findings.push({ ...item.finding, category: item.category });
	}

	const score = (category) => {
		const scoped = checks.filter((item) => item.category === category);
		if (scoped.length === 0) return 100;
		return Math.round((scoped.filter((item) => item.ok).length / scoped.length) * 100);
	};
	const scored = {
		completeness: score('completeness'),
		results: score('results'),
		logic: score('logic')
	};
	const hard = findings.filter((item) => item.severity === 'error');
	const soft = findings.filter((item) => item.severity === 'warn');

	return {
		slug: relPath(join(dir, '..'), dir),
		dir,
		title: await paperTitle(dir),
		verdict: hard.length > 0 ? 'fail' : soft.length > 0 ? 'warn' : 'pass',
		scores: scored,
		overall: Math.round((scored.completeness + scored.results + scored.logic) / 3),
		findings,
		stats: {
			sections: sections.filter((item) => item.present).length,
			sectionsTotal: sections.length,
			words: sections.reduce((sum, item) => sum + item.chars, 0),
			tables: tableCount,
			figures: graphics.length,
			claims: claims.length,
			supported: supported.length,
			pending: pending.length,
			citations: base.summary?.citedKeys ?? 0,
			bibEntries: base.summary?.bibEntries ?? 0,
			uncited: base.summary?.uncited ?? 0,
			pdf: base.freshness.state
		},
		sections
	};
}

/** Best-effort paper title from `\title{...}`. */
async function paperTitle(dir) {
	const main = (await readText(join(dir, 'main.tex'))) ?? '';
	const match = /\\title\{([\s\S]*?)\}\s*\n/.exec(main);
	if (match === null) return undefined;
	return match[1].replace(/\\\\/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Review every paper workspace under `root`.
 * A workspace is any immediate child directory containing `main.tex`.
 * @param {{root: string, only?: string[]}} options
 */
export async function reviewCollection({ root, only }) {
	const { readdir } = await import('node:fs/promises');
	let entries = [];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return { root, papers: [], error: `cannot read ${root}` };
	}
	const papers = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		if (only !== undefined && !only.includes(entry.name)) continue;
		const dir = join(root, entry.name);
		if (!(await exists(join(dir, 'main.tex')))) continue;
		papers.push(await reviewPaper({ dir }));
	}
	papers.sort((a, b) => a.slug.localeCompare(b.slug));
	return {
		root,
		generatedAt: new Date().toISOString(),
		summary: {
			papers: papers.length,
			fail: papers.filter((p) => p.verdict === 'fail').length,
			warn: papers.filter((p) => p.verdict === 'warn').length,
			pass: papers.filter((p) => p.verdict === 'pass').length
		},
		papers
	};
}
