/**
 * Offline citation and BibTeX analysis: which keys the manuscript cites, which
 * entries the bibliography defines, and which of each never meet.
 *
 * No network access. Verifying that a DOI resolves is deliberately out of scope;
 * this module only reports internal consistency.
 *
 * @module dsh-paper-suite/cite
 */

import { finding } from './util.js';

/** Commands whose braced argument is a citation key list. */
const CITE_PATTERN = /\\(?:[A-Za-z]*cite[A-Za-z]*|bibentry)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

/** Required fields per BibTeX entry type. */
const REQUIRED_FIELDS = {
	article: ['author', 'title', 'journal', 'year'],
	book: ['title', 'publisher', 'year'],
	inproceedings: ['author', 'title', 'booktitle', 'year'],
	incollection: ['author', 'title', 'booktitle', 'publisher', 'year'],
	misc: ['title', 'year'],
	phdthesis: ['author', 'title', 'school', 'year'],
	mastersthesis: ['author', 'title', 'school', 'year'],
	techreport: ['author', 'title', 'institution', 'year'],
	unpublished: ['author', 'title', 'note']
};

/** Line number of a character offset, 1-based. */
function lineAt(text, index) {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
	return line;
}

/**
 * Extract every citation key used by a set of `.tex` files.
 * @param {Array<{path: string, text: string}>} texFiles
 * @returns {Map<string, Array<{file: string, line: number}>>}
 */
export function collectCiteKeys(texFiles) {
	const keys = new Map();
	for (const file of texFiles) {
		CITE_PATTERN.lastIndex = 0;
		let match;
		while ((match = CITE_PATTERN.exec(file.text)) !== null) {
			const line = lineAt(file.text, match.index);
			for (const raw of match[1].split(',')) {
				const key = raw.trim();
				if (key.length === 0) continue;
				const uses = keys.get(key) ?? [];
				uses.push({ file: file.path, line });
				keys.set(key, uses);
			}
		}
	}
	return keys;
}

/**
 * Parse a BibTeX file into entries, detecting duplicate keys and unbalanced braces.
 * @param {string} text
 * @returns {{entries: Array<{type: string, key: string, fields: string[], line: number}>, duplicates: Array<{key: string, lines: number[]}>, unbalanced: boolean}}
 */
export function parseBib(text) {
	const entries = [];
	const seen = new Map();
	let unbalanced = false;
	const header = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,/g;
	let match;
	while ((match = header.exec(text)) !== null) {
		const type = match[1].toLowerCase();
		const key = match[2];
		if (type === 'comment' || type === 'string' || type === 'preamble') continue;

		const bodyStart = header.lastIndex;
		let depth = 1;
		let index = bodyStart;
		for (; index < text.length; index += 1) {
			const ch = text[index];
			if (ch === '{') depth += 1;
			else if (ch === '}') {
				depth -= 1;
				if (depth === 0) break;
			}
		}
		if (depth !== 0) {
			unbalanced = true;
			break;
		}
		const body = text.slice(bodyStart, index);
		header.lastIndex = index + 1;

		// Split the entry body on commas that sit at brace depth zero, then read the
		// field name from the head of each segment. Escaped characters are blanked
		// so `\,` and `\{` cannot perturb the depth count.
		const segments = [];
		let segment = '';
		let braceDepth = 0;
		for (const ch of body.replace(/\\./g, '  ')) {
			if (ch === '{') braceDepth += 1;
			else if (ch === '}') braceDepth -= 1;
			if (ch === ',' && braceDepth === 0) {
				segments.push(segment);
				segment = '';
				continue;
			}
			segment += ch;
		}
		segments.push(segment);
		const fields = segments
			.map((item) => /^\s*([A-Za-z][\w-]*)\s*=/.exec(item)?.[1])
			.filter((item) => item !== undefined)
			.map((item) => item.toLowerCase());

		const line = lineAt(text, match.index);
		entries.push({ type, key, fields, line });
		const at = seen.get(key) ?? [];
		at.push(line);
		seen.set(key, at);
	}

	const duplicates = [...seen.entries()]
		.filter(([, lines]) => lines.length > 1)
		.map(([key, lines]) => ({ key, lines }));

	return { entries, duplicates, unbalanced };
}

/**
 * Cross-check manuscript citations against one or more bibliographies.
 *
 * Accepts either the legacy single-file shape (`bibText`/`bibPath`) or the
 * multi-file shape (`bibs: [{path, text}]`) used by workspaces that stack
 * `references.bib` and `references_extra.bib`.
 *
 * @param {{texFiles: Array<{path: string, text: string}>, bibs?: Array<{path: string, text: string}>, bibText?: string, bibPath?: string}} input
 * @returns {Array<ReturnType<typeof finding>>}
 */
export function auditCitations({ texFiles, bibs, bibText, bibPath }) {
	const files =
		bibs ??
		(bibText === undefined ? [] : [{ path: bibPath ?? 'references.bib', text: bibText }]);
	const findings = [];
	const cited = collectCiteKeys(texFiles);
	const star = cited.has('*');

	const definitions = new Map();
	const occurrences = new Map();
	const unbalancedFiles = [];
	const parsedEntries = [];

	for (const file of files) {
		const parsed = parseBib(file.text);
		if (parsed.unbalanced) unbalancedFiles.push(file.path);
		for (const entry of parsed.entries) {
			if (!definitions.has(entry.key)) definitions.set(entry.key, { ...entry, path: file.path });
			const at = occurrences.get(entry.key) ?? [];
			at.push(`${file.path}:${entry.line}`);
			occurrences.set(entry.key, at);
			parsedEntries.push({ ...entry, path: file.path });
		}
	}

	for (const [key, uses] of cited) {
		if (key === '*') continue;
		if (definitions.has(key)) continue;
		const first = uses[0];
		findings.push(
			finding(
				'error',
				'missing-bib-entry',
				`正文引用 "${key}" 但 ${files.length === 1 ? files[0].path : '所有 .bib 文件'} 中都没有该条目`,
				`${first.file}:${first.line}`
			)
		);
	}

	if (!star) {
		// Aggregate per bibliography: a shared .bib can easily hold dozens of
		// candidate entries, and one finding per entry would drown every other defect.
		const uncitedByPath = new Map();
		for (const entry of parsedEntries) {
			if (cited.has(entry.key)) continue;
			const bucket = uncitedByPath.get(entry.path) ?? [];
			bucket.push(entry.key);
			uncitedByPath.set(entry.path, bucket);
		}
		for (const [path, keys] of uncitedByPath) {
			const shown = keys.slice(0, 6).join(', ');
			const more = keys.length > 6 ? `，另有 ${keys.length - 6} 条` : '';
			findings.push(
				finding(
					'warn',
					'uncited-bib-entry',
					`${path} 有 ${keys.length} 条条目未被正文引用：${shown}${more}（如为有意保留请加入 \\nocite）`,
					path
				)
			);
		}
	}

	for (const [key, at] of occurrences) {
		if (at.length < 2) continue;
		findings.push(
			finding('error', 'duplicate-bib-key', `BibTeX key "${key}" 重复定义（${at.join(', ')}）`, at[0].split(':')[0])
		);
	}

	for (const path of unbalancedFiles) {
		findings.push(finding('error', 'unbalanced-bib-braces', `${path} 花括号不配对，可能有条目缺少右花括号`, path));
	}

	for (const entry of parsedEntries) {
		if (entry.key === '*') continue;
		const required = REQUIRED_FIELDS[entry.type];
		if (required === undefined) continue;
		const absent = required.filter((field) => !entry.fields.includes(field));
		if (absent.length === 0) continue;
		findings.push(
			finding(
				'warn',
				'missing-required-field',
				`条目 "${entry.key}" (${entry.type}) 缺少必填字段：${absent.join(', ')}`,
				`${entry.path}:${entry.line}`
			)
		);
	}

	return findings;
}

/** Summary counters used by the tool output. */
export function citationSummary(texFiles, bibTextOrFiles) {
	const files = Array.isArray(bibTextOrFiles)
		? bibTextOrFiles
		: [{ path: 'references.bib', text: bibTextOrFiles }];
	const cited = collectCiteKeys(texFiles);
	const defined = new Set();
	let bibEntries = 0;
	for (const file of files) {
		const { entries } = parseBib(file.text);
		bibEntries += entries.length;
		for (const entry of entries) defined.add(entry.key);
	}
	return {
		bibFiles: files.length,
		citedKeys: [...cited.keys()].filter((key) => key !== '*').length,
		bibEntries,
		missing: [...cited.keys()].filter((key) => key !== '*' && !defined.has(key)).length,
		uncited: [...defined].filter((key) => !cited.has(key)).length
	};
}
