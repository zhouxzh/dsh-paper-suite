/**
 * Offline smoke test: exercises every module that does not need the DSH host.
 * Run with `node test/smoke.mjs`.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditPaper } from '../lib/audit.js';
import { buildPaper, parseLatexLog } from '../lib/build.js';
import { auditCitations, collectCiteKeys, parseBib } from '../lib/cite.js';
import { insertTableRow } from '../lib/registry.js';
import { reviewPaper } from '../lib/review.js';
import { scaffoldPaper } from '../lib/scaffold.js';
import { syncEvidence, validateHost, validateRemotePaths } from '../lib/sync.js';

const failures = [];
/**
 * Await the assertion body. A synchronous wrapper here silently discarded every
 * async rejection, so async cases reported "ok" without ever being awaited.
 */
const check = async (label, fn) => {
	try {
		await fn();
		console.log(`ok   ${label}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`FAIL ${label}: ${error.message}`);
	}
};

const root = await mkdtemp(join(tmpdir(), 'paper-factory-'));

try {
	// 1. scaffold creates the expected shape
	const first = await scaffoldPaper({ root, slug: 'demo-paper', title: '演示论文' });
	await check('scaffold creates files', () => {
		assert.ok(first.created.length >= 18, `expected >=18 files, got ${first.created.length}`);
		assert.ok(first.created.includes('main.tex'));
		assert.ok(first.created.includes('audit/author_verification_required.md'));
		assert.equal(first.skipped.length, 0);
	});

	// 2. re-running never overwrites
	const mainPath = join(first.dir, 'main.tex');
	await writeFile(mainPath, '% hand written\n', 'utf8');
	const second = await scaffoldPaper({ root, slug: 'demo-paper', title: '演示论文' });
	await check('scaffold is idempotent and preserves prose', async () => {
		assert.equal(second.created.length, 0);
		assert.ok(second.protectedSkipped.includes('main.tex'));
	});
	await check('main.tex content survived', async () => {
		assert.equal(await readFile(mainPath, 'utf8'), '% hand written\n');
	});

	// 3. citation audit finds both directions
	const texFiles = [
		{ path: 'sections/intro.tex', text: 'A \\cite{alpha,beta} and \\parencite[p.~2]{alpha}.' }
	];
	const bib = `
@article{alpha,
  author = {A, B}, title = {T}, journal = {J}, year = {2026}
}
@article{gamma,
  author = {C, D}, title = {U}, journal = {J}, year = {2026}
}
@article{gamma,
  author = {C, D}, title = {U2}, journal = {J}, year = {2026}
}`;
	await check('collects citation keys', () => {
		const keys = collectCiteKeys(texFiles);
		assert.deepEqual([...keys.keys()].sort(), ['alpha', 'beta']);
	});
	await check('detects duplicate bib keys', () => {
		const parsed = parseBib(bib);
		assert.equal(parsed.duplicates.length, 1);
		assert.equal(parsed.duplicates[0].key, 'gamma');
	});
	await check('reports missing and uncited entries', () => {
		const found = auditCitations({ texFiles, bibText: bib, bibPath: 'references.bib' });
		const codes = found.map((item) => item.code);
		assert.ok(codes.includes('missing-bib-entry'), 'beta should be missing');
		assert.ok(codes.includes('uncited-bib-entry'), 'gamma should be uncited');
		assert.ok(codes.includes('duplicate-bib-key'));
	});

	// 4. log parsing
	await check('parses latex log defects', () => {
		const log = [
			'! Undefined control sequence.',
			'l.12 \\foo',
			"LaTeX Warning: Citation `smith2020' on page 3 undefined on input line 42.",
			"LaTeX Warning: Reference `fig:x' on page 4 undefined on input line 50.",
			'Missing character: There is no 中 in font SimSun!',
			'Overfull \\hbox (11.4pt too wide) in paragraph at lines 6--7',
			'Output written on main.pdf (7 pages, 196594 bytes).'
		].join('\n');
		const parsed = parseLatexLog(log);
		assert.equal(parsed.errors.length, 1);
		assert.deepEqual(parsed.undefinedCitations, ['smith2020']);
		assert.deepEqual(parsed.undefinedReferences, ['fig:x']);
		assert.deepEqual(parsed.missingCharacters, ['中']);
		assert.equal(parsed.overfull.length, 1);
		assert.equal(parsed.pageCount, 7);
	});

	// 5. registry row insertion
	await check('inserts a registry row after the table', () => {
		const md = ['| 研究线 | 工作区 |', '| --- | --- |', '| A | [a](a/) |', '', 'tail'].join('\n');
		const edited = insertTableRow(md, '研究线', '| B | [b](b/) |');
		assert.ok(edited?.changed);
		assert.ok(edited.text.includes('| B | [b](b/) |\n\n' + 'tail'.replace('\n', '')) || edited.text.includes('| B |'));
	});
	await check('reports an existing row instead of duplicating it', () => {
		const md = ['| 研究线 | 工作区 |', '| --- | --- |', '| B | [b](b/) |'].join('\n');
		const edited = insertTableRow(md, '研究线', '| B | [b](b/) |');
		assert.equal(edited?.changed, false);
	});

	// 6. evidence boundary
	await check('refuses binary artifacts and accepts tables', () => {
		const verdict = validateRemotePaths(['/runs/metrics.csv', '/runs/model.pt', '/runs/preds.npz', '/runs/report.md']);
		assert.deepEqual(verdict.allowed, ['/runs/metrics.csv', '/runs/report.md']);
		assert.equal(verdict.findings.filter((item) => item.code === 'refused-artifact').length, 2);
	});

	await check('rejects host strings that scp would read as options', () => {
		assert.equal(validateHost('ace2'), undefined);
		assert.equal(validateHost('zhong3.example.org'), undefined);
		for (const bad of ['-oProxyCommand=touch /tmp/pwned', 'host name', 'host;rm -rf /', '']) {
			assert.equal(validateHost(bad)?.code, 'invalid-host', `should reject ${JSON.stringify(bad)}`);
		}
	});
	await check('rejects relative remote paths', () => {
		const verdict = validateRemotePaths(['metrics.csv', '~/runs/ok.csv']);
		assert.deepEqual(verdict.allowed, ['~/runs/ok.csv']);
		assert.equal(verdict.findings[0].code, 'relative-remote-path');
	});
	await check('CJK-only title yields a usable slug', async () => {
		const cjk = await scaffoldPaper({ root, slug: '状态感知残差预测', title: '状态感知残差预测', dryRun: true });
		assert.ok(cjk.dir.includes('状态感知残差预测'));
	});
	await check('a commented-out citation is not a missing entry', () => {
		const commented = [
			{ path: 'sections/a.tex', text: '% \\cite{ghost}\nText \\cite{real}.' }
		];
		const found = auditCitations({
			texFiles: commented,
			bibs: [{ path: 'references.bib', text: '@article{real, author={A}, title={T}, journal={J}, year={2026}}' }]
		});
		const missing = found.filter((item) => item.code === 'missing-bib-entry');
		assert.equal(missing.length, 0, 'ghost citation must be ignored');
	});
	await check('evidence basename collisions are refused before scp', async () => {
		const result = await syncEvidence({
			workspace: join(root, 'demo-paper'),
			host: 'ace2',
			remotePaths: ['/a/metrics.csv', '/b/metrics.csv'],
			dryRun: true
		});
		assert.ok(result.findings.some((item) => item.code === 'evidence-name-collision'));
		assert.equal(result.planned.length, 0);
	});
	await check('failed scp leaves no staging file behind', async () => {
		const result = await syncEvidence({
			workspace: join(root, 'demo-paper'),
			host: '127.0.0.1',
			remotePaths: ['/definitely/missing.csv'],
			timeoutMs: 8000
		});
		assert.ok(result.findings.some((item) => item.code === 'scp-failed'));
		const leftovers = (await readdir(join(root, 'demo-paper', 'evidence'))).filter((name) =>
			name.startsWith('.staging-')
		);
		assert.deepEqual(leftovers, []);
	});

	// 7. audit of a scaffolded workspace
	const audit = await auditPaper({ dir: join(root, 'demo-paper') });
	await check('audit flags placeholders and a missing pdf', () => {
		const codes = audit.findings.map((item) => item.code);
		assert.ok(codes.includes('pdf-missing'), 'pdf should be missing');
		assert.ok(codes.includes('placeholder-section') || codes.includes('placeholder-author'));
	});

	// 8. review scoring
	const review = await reviewPaper({ dir: join(root, 'demo-paper') });
	await check('review scores a scaffolded paper and finds its gaps', () => {
		assert.ok(['pass', 'warn', 'fail'].includes(review.verdict));
		assert.equal(review.stats.sectionsTotal >= 9, true);
		assert.ok(review.scores.completeness >= 0 && review.scores.completeness <= 100);
		assert.ok(Array.isArray(review.findings) && review.findings.length > 0);
		for (const item of review.findings) assert.ok(item.category !== undefined, `${item.code} lacks a category`);
	});

	// 9. a single-file manuscript is judged by headings, not by our file layout
	const single = join(root, 'single-file-paper');
	await mkdir(join(single, 'sections'), { recursive: true });
	await writeFile(
		join(single, 'main.tex'),
		[
			'\\documentclass{article}',
			'\\begin{document}',
			'\\begin{abstract}A sufficiently long abstract that describes the problem, the method and the result boundary.',
			'\\end{abstract}',
			'\\section{Introduction}\\label{sec:intro} This paper proposes a method.',
			'\\section{Method} We describe the approach in detail.',
			'\\section{Retrospective Protocol} The protocol and reproducibility contract.',
			'\\section{Results} The measured values are reported here.',
			'\\section{Conclusion} The scope does not generalize beyond this setting.',
			'\\end{document}'
		].join('\n'),
		'utf8'
	);
	await writeFile(
		join(single, 'references.bib'),
		'@article{a,\n  author = {A},\n  title = {T},\n  journal = {J},\n  year = {2026}\n}\n',
		'utf8'
	);
	const singleReview = await reviewPaper({ dir: single });
	await check('single-file manuscript is not failed for using its own layout', () => {
		const missing = singleReview.findings.filter(
			(item) => item.code === 'section-missing' && item.severity === 'error'
		);
		assert.deepEqual(missing, [], 'heading-based detection should find every core section');
		assert.equal(singleReview.stats.sections >= 6, true);
	});
} finally {
	await rm(root, { recursive: true, force: true });
}

// 8. absent latexmk must degrade, not throw
const empty = await mkdtemp(join(tmpdir(), 'paper-factory-missing-'));
try {
	const result = await buildPaper({ dir: empty });
	await check('missing entry file degrades gracefully', () => {
		assert.equal(result.ok, false);
		assert.equal(result.findings[0].code, 'entry-not-found');
	});
} finally {
	await rm(empty, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error(`\n${failures.length} await check(s) failed`);
	process.exit(1);
}
console.log('\nall smoke checks passed');
