/**
 * LaTeX build with structured diagnostics, plus a freshness check that does not
 * need to compile anything.
 * @module dsh-paper-suite/build
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exists, finding, listFiles, mtime, readText } from './util.js';

const run = promisify(execFile);

/**
 * Which latexmk engine flag to use for an entry file.
 *
 * The magic comment is the most reliable signal, then CJK packages, then the
 * presence of CJK characters in the source. Only a source with none of these is
 * treated as pdflatex.
 */
export function chooseEngine(entrySource, requested = 'auto') {
	if (requested !== 'auto') return requested;
	const source = entrySource ?? '';
	if (/^%\s*!TEX\s+(?:program|TS-program)\s*=\s*(xelatex|lualatex|pdflatex)/im.test(source)) {
		const magic = /^%\s*!TEX\s+(?:program|TS-program)\s*=\s*(xelatex|lualatex|pdflatex)/im.exec(source);
		return magic[1].toLowerCase();
	}
	if (/ctex|xeCJK|fontspec|\\setCJK/.test(source)) return 'xelatex';
	if (/[\u3400-\u9fff\uf900-\ufaff]/.test(source)) return 'xelatex';
	if (/\\documentclass/.test(source)) return 'pdflatex';
	return 'xelatex';
}

/**
 * Parse a LaTeX log into the defects that actually block submission.
 * @param {string} log
 * @returns {{errors: string[], undefinedCitations: string[], undefinedReferences: string[], missingCharacters: string[], overfull: Array<{amount: string, lines: string}>, pageCount: number|undefined}}
 */
export function parseLatexLog(log) {
	const errors = [];
	const undefinedCitations = [];
	const undefinedReferences = [];
	const missingCharacters = new Set();
	const overfull = [];
	const lines = log.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (line.startsWith('!')) errors.push(`${line.trim()} ${(lines[i + 1] ?? '').trim()}`.trim());
		const citation = /Citation [`'"]?([^'"]+)[`'"]? on page \d+ undefined/.exec(line);
		if (citation) undefinedCitations.push(citation[1]);
		const reference = /Reference [`'"]?([^'"]+)[`'"]? on page \d+ undefined/.exec(line);
		if (reference) undefinedReferences.push(reference[1]);
		const glyph = /Missing character: There is no (.+?) in font/.exec(line);
		if (glyph) missingCharacters.add(glyph[1]);
		const box = /Overfull \\hbox \(([\d.]+pt) too wide\) in paragraph at lines (\d+--\d+)/.exec(line);
		if (box) overfull.push({ amount: box[1], lines: box[2] });
	}

	const pageMatch = /Output written on .*?\((\d+) pages?/.exec(log);
	return {
		errors,
		undefinedCitations: [...new Set(undefinedCitations)],
		undefinedReferences: [...new Set(undefinedReferences)],
		missingCharacters: [...missingCharacters],
		overfull,
		pageCount: pageMatch ? Number(pageMatch[1]) : undefined
	};
}

/** True when the PDF is older than any source file. */
export async function checkFreshness(dir) {
	const pdf = join(dir, 'main.pdf');
	const sources = await listFiles(dir, { extensions: ['.tex', '.bib'] });
	const pdfTime = await mtime(pdf);
	const newest = { path: undefined, time: 0 };
	for (const source of sources) {
		const time = await mtime(source);
		if (time > newest.time) {
			newest.time = time;
			newest.path = source;
		}
	}
	if (!(await exists(pdf))) return { state: 'missing', pdfTime: 0, sourceTime: newest.time, sourcePath: newest.path };
	if (newest.time > pdfTime) return { state: 'stale', pdfTime, sourceTime: newest.time, sourcePath: newest.path };
	return { state: 'fresh', pdfTime, sourceTime: newest.time, sourcePath: newest.path };
}

/**
 * Compile a paper and turn the log into findings.
 * @param {{dir: string, entry?: string, engine?: string, timeoutMs?: number}} options
 */
export async function buildPaper({ dir, entry = 'main.tex', engine = 'auto', timeoutMs = 300000 }) {
	const entryPath = join(dir, entry);
	const source = await readText(entryPath);
	if (source === undefined) {
		return {
			ok: false,
			exitCode: 1,
			pageCount: undefined,
			engine: undefined,
			findings: [finding('error', 'entry-not-found', `找不到入口文件 ${entry}`, dir)],
			logExcerpt: ''
		};
	}
	const resolved = chooseEngine(source, engine);
	const args = [`-${resolved}`, '-interaction=nonstopmode', '-halt-on-error', entry];

	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = await run('latexmk', args, { cwd: dir, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
		stdout = result.stdout ?? '';
		stderr = result.stderr ?? '';
	} catch (error) {
		exitCode = typeof error.code === 'number' ? error.code : 1;
		stdout = error.stdout ?? '';
		stderr = error.stderr ?? '';
		if (error.code === 'ENOENT') {
			return {
				ok: false,
				exitCode: 127,
				pageCount: undefined,
				engine: resolved,
				findings: [finding('error', 'latexmk-missing', 'PATH 上没有 latexmk，无法编译', dir)],
				logExcerpt: ''
			};
		}
	}

	const log = (await readText(join(dir, entry.replace(/\.tex$/, '.log')))) ?? `${stdout}\n${stderr}`;
	const parsed = parseLatexLog(log);
	const findings = [];
	for (const message of parsed.errors) findings.push(finding('error', 'latex-error', message));
	for (const key of parsed.undefinedCitations)
		findings.push(finding('error', 'undefined-citation', `未定义引用 ${key}`));
	for (const key of parsed.undefinedReferences)
		findings.push(finding('warn', 'undefined-reference', `未定义交叉引用 ${key}`));
	for (const glyph of parsed.missingCharacters)
		findings.push(finding('error', 'missing-glyph', `字体缺少字符 ${glyph}`));
	for (const box of parsed.overfull)
		findings.push(finding('warn', 'overfull-hbox', `超宽 ${box.amount}，段落 ${box.lines}`));

	const freshness = await checkFreshness(dir);
	return {
		ok: exitCode === 0 && parsed.errors.length === 0,
		exitCode,
		pageCount: parsed.pageCount,
		engine: resolved,
		findings,
		logExcerpt: log.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-25).join('\n'),
		freshness
	};
}
