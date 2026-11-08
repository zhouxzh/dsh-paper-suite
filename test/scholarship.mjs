/**
 * Scholarship-register regression tests.
 *
 * The paper suite historically scored structurally complete manuscripts highly
 * even when they read like run logs. These cases pin the new failure class.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditPaper } from '../lib/audit.js';
import { scaffoldPaper } from '../lib/scaffold.js';

const SCHOLARSHIP_CODES = new Set([
	'internal-id-in-title',
	'internal-version-in-title',
	'internal-id-in-summary',
	'report-style-results',
	'audit-detail-in-results',
	'nondetection-as-equivalence',
	'caption-without-provenance'
]);

const root = await mkdtemp(join(tmpdir(), 'paper-scholarship-'));

/** Rewrite the title while keeping the scaffold's preamble intact. */
async function setTitle(dir, title) {
	const path = join(dir, 'main.tex');
	const text = await readFile(path, 'utf8');
	await writeFile(path, text.replace(/\\title\{[\s\S]*?\}\s*\n/, `\\title{${title}}\n`), 'utf8');
}

async function scholarshipCodes(dir) {
	const result = await auditPaper({ dir });
	return new Set(result.findings.filter((item) => SCHOLARSHIP_CODES.has(item.code)).map((item) => item.code));
}

try {
	const bad = await scaffoldPaper({ root, slug: 'bad-register', title: 'Placeholder' });
	await setTitle(bad.dir, 'Residual Forecasting: A \\texttt{canonical\\_v2} Study');
	await writeFile(
		join(bad.dir, 'sections', 'results.tex'),
		[
			'\\section{Results}',
			'The frozen protocol used a prespecified manifest, a hash ledger, and a checkpoint audit. ',
			'The canonical\\_v2 run supplied all reported cells. ',
			'(1) The prespecified protocol passed. (2) The frozen cell audit passed. (3) The test-access ledger passed. ',
			'For every deviation the seed and cell were recorded in the artifact audit. ',
			'Table~\\ref{tab:one} reports the result. Figure~\\ref{fig:one} reports the result. ',
			'Table~\\ref{tab:two} reports the result. Figure~\\ref{fig:two} reports the result. ',
			'The comparison was not significant, so the two encoders are equivalent.'
		].join('\n'),
		'utf8'
	);
	const badCodes = await scholarshipCodes(bad.dir);
	for (const code of ['internal-id-in-title', 'internal-id-in-summary', 'report-style-results', 'nondetection-as-equivalence']) {
		assert.ok(badCodes.has(code), `expected ${code}, got ${[...badCodes].join(', ') || '(none)'}`);
	}

	const good = await scaffoldPaper({ root, slug: 'good-register', title: 'Placeholder' });
	await setTitle(good.dir, 'Residual Forecasting by Change Mechanism');
	await writeFile(
		join(good.dir, 'sections', 'results.tex'),
		[
			'\\section{Results}',
			'The residual reduced path error on seen trend breaks. ',
			'On unseen jumps, the interval included zero, so no advantage was established. ',
			'This result does not imply equivalence with persistence. ',
			'The second study held origins and optimization fixed and compared four encoders.'
		].join('\n'),
		'utf8'
	);
	const goodCodes = await scholarshipCodes(good.dir);
	for (const code of badCodes) {
		assert.ok(!goodCodes.has(code), `clean manuscript should not raise ${code}`);
	}

	console.log('scholarship register checks passed');
} catch (error) {
	console.error(`FAIL ${error.message}`);
	process.exitCode = 1;
} finally {
	await rm(root, { recursive: true, force: true });
}
