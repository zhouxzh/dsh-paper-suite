/**
 * Scholarship audit: does the manuscript read as a paper rather than a lab log?
 *
 * Structural checks in audit.js/review.js prove that evidence is present and
 * traceable. This module checks a different failure class: internal experiment
 * identifiers leaking into scholarly prose, Results sections dominated by
 * protocol bookkeeping and display pointers, and nondetection being reported as
 * equivalence.
 *
 * Heuristics are deliberately conservative. A hit is a reading prompt, not a
 * claim that the science is wrong.
 *
 * @module dsh-paper-suite/scholarship
 */

import { readText } from './util.js';

/** Project/run identifiers such as canonical_v2 or encoder_l_v1.r6. */
const INTERNAL_ID = /\b[a-z][a-z0-9]*(?:\\?_)[a-z0-9]+(?:\\?_(?:[a-z0-9]+))*(?:\.(?:r|v)?\d+)?\b/gi;

/** A version token embedded in a title, e.g. v2 or r6. */
const VERSION_TOKEN = /\b(?:v|r)\d+(?:\.\d+)?\b/i;

/** Protocol bookkeeping words that should mostly live in Methods. */
const PROTOCOL_TERMS =
	/\b(?:protocol|prespecified|frozen|ledger|checkpoint|manifest|hash|bundle|test access|deviation|seed|cell|artifact audit)\b/gi;

/** Attribution cues acceptable in a caption or table note. */
const PROVENANCE_CUE =
	/\b(?:data are from|source|derived from|released|available|repository|appendix|supplementary|table|figure|evidence)\b|\b[\w-]+\.(?:csv|json|md)\b/i;

/** Remove LaTeX comments. */
function stripComments(text) {
	return text.replace(/(^|[^\\])(%[^\n]*)/gm, (_m, prefix) => prefix);
}

/** Remove display environments so prose metrics are not inflated by tables. */
function stripDisplays(text) {
	return text
		.replace(/\\begin\{table\}[\s\S]*?\\end\{table\}/g, ' ')
		.replace(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/g, ' ')
		.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, ' ');
}

/** Convert a small LaTeX fragment to readable plain text. */
function plain(text) {
	return text
		.replace(/\\texttt\{([^{}]*)\}/g, '$1')
		.replace(/\\emph\{([^{}]*)\}/g, '$1')
		.replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, ' ')
		.replace(/[{}~]/g, ' ')
		.replace(/\\_/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Count matches without sharing a global regex's lastIndex. */
function countMatches(text, pattern) {
	const copy = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
	return (text.match(copy) ?? []).length;
}

/** Remove file-path commands; artifact names are provenance, not prose. */
function stripArtifactPaths(text) {
	return text
		.replace(/\\includegraphics(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
		.replace(/\\(?:path|url)\{[^}]*\}/g, ' ');
}

/** Unique internal identifiers mentioned in a fragment. */
function internalIds(text) {
	const copy = new RegExp(INTERNAL_ID.source, INTERNAL_ID.flags);
	const seen = new Map();
	for (const match of text.matchAll(copy)) {
		const id = match[0].replace(/\\_/g, '_');
		const head = id.split('_')[0];
		const versioned = /\.(?:r|v)\d+$/.test(id);
		// Single-letter mathematical symbols (g_t, r_t, x_t, w_s) are notation,
		// not experiment identifiers. File-like tokens are handled as provenance.
		if (head.length < 3 && !versioned) continue;
		if (/\.(?:csv|json|md|tex|pdf|npz|png|svg)$/i.test(id)) continue;
		seen.set(id, (seen.get(id) ?? 0) + 1);
	}
	return seen;
}

/** Split prose into sentence-like units. */
function sentences(text) {
	return text
		.split(/(?<=[.!?])\s+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/** Extract the manuscript title from main.tex. */
async function readTitle(dir) {
	const main = (await readText(`${dir}/main.tex`)) ?? '';
	const match = /\\title\{([\s\S]*?)\}\s*\n/.exec(main);
	return match === null ? '' : plain(match[1].replace(/\\\\/g, ' '));
}

/**
 * Run the scholarship pass.
 * @param {{dir: string, texFiles: Array<{path: string, text: string}>}} options
 * @returns {Promise<Array<{severity: string, code: string, message: string, location?: string}>>}
 */
export async function auditScholarship({ dir, texFiles }) {
	const findings = [];
	const at = (code, severity, message, location) => findings.push({ severity, code, message, location });

	const title = await readTitle(dir);
	if (title.length > 0) {
		const ids = internalIds(title);
		if (ids.size > 0) {
			at(
				'internal-id-in-title',
				'error',
				`标题含内部实验标识 ${[...ids.keys()].join(', ')}；论文标题应使用研究名称或科学问题，版本号放在 Data/Code Availability`,
				'main.tex'
			);
		} else if (VERSION_TOKEN.test(title)) {
			at(
				'internal-version-in-title',
				'warn',
				'标题含版本样式标记（如 v2/r6）；除非它是领域通用名称，否则改用研究名称',
				'main.tex'
			);
		}
	}

	const byPath = new Map(texFiles.map((file) => [file.path.replaceAll('\\', '/'), file]));
	const abstract = byPath.get('sections/abstract.tex')?.text ?? '';
	const results = byPath.get('sections/results.tex')?.text ?? '';
	const intro = byPath.get('sections/introduction.tex')?.text ?? '';

	// Internal identifiers in the abstract and Results are the strongest signal
	// that a manuscript still reads like a run report.
	for (const [section, text] of [
		['摘要', abstract],
		['结果', results]
	]) {
		const ids = internalIds(stripArtifactPaths(stripComments(text)));
		if (ids.size > 0) {
			const listing = [...ids.entries()].map(([id, n]) => `${id}×${n}`).join(', ');
			at(
				'internal-id-in-summary',
				'warn',
				`${section}出现内部实验标识：${listing}。改为 “Study 1/2”“the mechanism simulation” 等研究名称；版本号移入 Data/Code Availability`,
				section === '摘要' ? 'sections/abstract.tex' : 'sections/results.tex'
			);
		}
	}

	// ------------------------------------------------------------------ Results
	const resultsProse = plain(stripDisplays(stripComments(results)));
	const units = sentences(resultsProse);
	const displayLeads = units.filter((sentence) => /^(?:Table|Figure|Fig\.)\s*(?:~\s*)?\\?ref/i.test(sentence)).length;
	const decisionLists = (resultsProse.match(/\([1-9]\)/g) ?? []).length;
	const protocolHits = countMatches(resultsProse, PROTOCOL_TERMS);
	const auditWords = (resultsProse.match(/\b(?:ledger|checkpoint|manifest|hash|bundle|artifact audit)\b/gi) ?? []).length;

	const reportSignals = [
		protocolHits >= 12 ? `协议/冻结类措辞 ${protocolHits} 次` : '',
		displayLeads >= 5 ? `${displayLeads} 个句子以 Table/Figure 开头` : '',
		decisionLists >= 3 ? `${decisionLists} 处编号式裁决` : '',
		auditWords >= 1 ? `成果审计词 ${auditWords} 次` : ''
	].filter(Boolean);
	if (reportSignals.length >= 2) {
		at(
			'report-style-results',
			'warn',
			`结果章节呈实验报告式叙事（${reportSignals.join('；')}）。把协议版本、哈希和审计过程移到 Methods/Data Availability；Results 以发现、证据和边界为句首`,
			'sections/results.tex'
		);
	} else if (auditWords >= 1) {
		at(
			'audit-detail-in-results',
			'warn',
			`结果章节含 ${auditWords} 处审计/哈希/台账措辞；除影响解释的偏差外，这些应放在 Methods 或 Data/Code Availability`,
			'sections/results.tex'
		);
	}

	// Nondetection is not equivalence.
	for (const sentence of sentences(plain(stripDisplays(stripComments(`${results}\n${intro}`))))) {
		const nondetection = /\b(?:not significant|no significant|did not significantly|non-significant|failed to reach significance)\b/i.test(
			sentence
		);
		const equivalence = /\b(?:equivalent|equivalence|no difference|identical|same performance|equally good)\b/i.test(sentence);
		const justified = /\b(?:equivalence margin|non-inferiority|tolerance interval|pre-?specified bound)\b/i.test(sentence);
		if (nondetection && equivalence && !justified) {
			at(
				'nondetection-as-equivalence',
				'warn',
				`疑似把“不显著”写成“等价”：${sentence.slice(0, 140)}${sentence.length > 140 ? '…' : ''}`,
				'sections/results.tex'
			);
			break;
		}
	}

	// ---------------------------------------------------------------- captions
	const captionPattern = /\\caption\{([\s\S]*?)\}\s*(?:\n|\\label)/g;
	const captions = [...`${abstract}\n${results}\n${(byPath.get('sections/experimental_setup.tex')?.text ?? '')}`.matchAll(captionPattern)].map(
		(match) => plain(match[1])
	);
	const numericCaptions = captions.filter((caption) => /\d/.test(caption));
	const unsourced = numericCaptions.filter((caption) => !PROVENANCE_CUE.test(caption));
	if (unsourced.length > 0) {
		at(
			'caption-without-provenance',
			'info',
			`${unsourced.length}/${numericCaptions.length} 个含数字的图表注没有数据来源或可追溯提示`,
			'sections/results.tex'
		);
	}

	return findings;
}
