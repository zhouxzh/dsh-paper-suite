/**
 * Evidence-chain audit for one paper workspace: citations, bibliography health,
 * unresolved author placeholders, claim-map locators and PDF freshness.
 *
 * Deliberately offline. Whether a DOI resolves or whether a claim is true needs
 * a human or a network tool; this module only proves the internal chain is
 * consistent and that no placeholder survived.
 *
 * @module dsh-paper-suite/audit
 */

import { join } from 'node:path';
import { checkFreshness } from './build.js';
import { auditCitations, citationSummary } from './cite.js';
import { exists, finding, listFiles, readText, relPath } from './util.js';

/** Placeholder markers that must not survive into a submission. */
const PLACEHOLDER_PATTERNS = [
	{ pattern: /待作者确认/g, code: 'placeholder-author', message: '作者占位符"待作者确认"仍在稿中' },
	{ pattern: /Author to be confirmed/gi, code: 'placeholder-author', message: 'author placeholder "Author to be confirmed" survived' },
	{ pattern: /<待撰写[^>]*>/g, code: 'placeholder-section', message: '章节仍是"待撰写"占位符' },
	{ pattern: /\b(?:to be written|TODO|TBD)\b/gi, code: 'placeholder-section', message: 'unresolved to-be-written/TODO marker' },
	{ pattern: /<YYYY-MM-DD>/g, code: 'placeholder-date', message: '日期占位符未替换' },
	{ pattern: /<可证伪的主张>/g, code: 'placeholder-claim', message: 'claims register 仍是占位符' }
];

/**
 * Audit one paper workspace.
 * @param {{dir: string}} options
 */
export async function auditPaper({ dir }) {
	const findings = [];

	const texPaths = await listFiles(dir, { extensions: ['.tex'] });
	const texFiles = [];
	for (const path of texPaths) {
		const text = await readText(path);
		if (text !== undefined) texFiles.push({ path: relPath(dir, path), text, abs: path });
	}
	if (texFiles.length === 0) {
		findings.push(finding('error', 'no-tex', '工作区里没有任何 .tex 文件', dir));
	}

	// A workspace may stack several bibliographies (SAPR uses references.bib plus
	// references_extra.bib), so resolve every declared resource instead of assuming one.
	const bibNames = new Set(['references.bib']);
	for (const file of texFiles) {
		for (const match of file.text.matchAll(/\\(?:addbibresource|bibliography)\s*\{([^}]+)\}/g)) {
			for (const part of match[1].split(',')) {
				let name = part.trim();
				if (name.length === 0) continue;
				if (!name.toLowerCase().endsWith('.bib')) name += '.bib';
				bibNames.add(name);
			}
		}
	}

	const bibs = [];
	for (const name of bibNames) {
		const text = await readText(join(dir, name));
		if (text === undefined) {
			if (name === 'references.bib') findings.push(finding('error', 'no-bib', '缺少 references.bib', dir));
			else findings.push(finding('warn', 'bib-resource-missing', `\\addbibresource 声明的 ${name} 不存在`, name));
			continue;
		}
		bibs.push({ path: name, text });
	}
	if (bibs.length > 0) findings.push(...auditCitations({ texFiles, bibs }));

	for (const file of texFiles) {
		for (const rule of PLACEHOLDER_PATTERNS) {
			rule.pattern.lastIndex = 0;
			let match;
			while ((match = rule.pattern.exec(file.text)) !== null) {
				const line = file.text.slice(0, match.index).split('\n').length;
				findings.push(finding('warn', rule.code, rule.message, `${file.path}:${line}`));
			}
		}
	}

	const claimMapPath = join(dir, 'audit', 'claim_evidence_map.md');
	const claimMap = await readText(claimMapPath);
	if (claimMap === undefined) {
		findings.push(finding('warn', 'no-claim-map', '缺少 audit/claim_evidence_map.md', dir));
	} else {
		// Locators may be workspace-relative (evidence/x.csv) or repository-relative
		// (docs/analysis/...), so a miss inside the workspace is retried at the
		// enclosing repository root before it is reported.
		const parent = join(dir, '..');
		const locatorPattern = /`([^`\s]+\.(?:csv|json|md|txt|tex|parquet|png|pdf))`/g;
		let match;
		const seen = new Set();
		let missing = 0;
		while ((match = locatorPattern.exec(claimMap)) !== null) {
			const locator = match[1];
			if (seen.has(locator)) continue;
			seen.add(locator);
			// Remote provenance locators (host:path, http(s)://) are recorded for
			// traceability and are not expected to resolve on this machine.
			if (locator.startsWith('http')) continue;
			if (locator.includes(':') && !/^[A-Za-z]:[\\/]/.test(locator)) continue;
			if (await exists(join(dir, locator))) continue;
			if (await exists(join(parent, locator))) continue;
			missing += 1;
			findings.push(
				finding('error', 'missing-evidence-file', `claim map 指向的 ${locator} 在工作区与仓库根都不存在`, 'audit/claim_evidence_map.md')
			);
		}
		if (seen.size === 0) {
			findings.push(finding('info', 'claim-map-empty', 'claim map 尚未登记任何 evidence locator'));
		} else if (missing === 0) {
			findings.push(finding('info', 'claim-map-locators-ok', `${seen.size} 个 claim-map locator 均存在`));
		}
	}

	const authorTodo = await readText(join(dir, 'audit', 'author_verification_required.md'));
	if (authorTodo === undefined) {
		findings.push(finding('warn', 'no-author-todo', '缺少 audit/author_verification_required.md', dir));
	} else if (/^- \[ \]/m.test(authorTodo)) {
		const open = (authorTodo.match(/^- \[ \]/gm) ?? []).length;
		findings.push(finding('warn', 'author-todo-open', `作者核验清单仍有 ${open} 项未完成`, 'audit/author_verification_required.md'));
	}

	const claims = await readText(join(dir, 'claims_register.md'));
	const pending = claims === undefined ? 0 : (claims.match(/\|\s*pending\s*\|/g) ?? []).length;
	if (claims === undefined) {
		findings.push(finding('warn', 'no-claims-register', '缺少 claims_register.md', dir));
	} else if (pending > 0) {
		findings.push(finding('info', 'claims-pending', `${pending} 条 claim 仍为 pending`, 'claims_register.md'));
	}

	const freshness = await checkFreshness(dir);
	if (freshness.state === 'missing') findings.push(finding('warn', 'pdf-missing', 'main.pdf 尚未生成', dir));
	if (freshness.state === 'stale')
		findings.push(
			finding('warn', 'pdf-stale', `main.pdf 比 ${relPath(dir, freshness.sourcePath)} 旧，需要重新编译`, 'main.pdf')
		);

	const summary = bibs.length === 0 ? undefined : citationSummary(texFiles, bibs);
	return { findings, summary, freshness, texFiles: texFiles.length };
}
