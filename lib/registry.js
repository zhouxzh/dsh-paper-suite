/**
 * Keep the repository-wide paper registries in sync.
 *
 * Three files list every paper workspace: the root `README.md`, `AGENTS.md`
 * (paper → code repository mapping) and `docs/code_repository_split.md`.
 * Adding a paper by hand to all three is the most repetitive step in this
 * repository, so this module proposes and (opt-in) applies one row each.
 *
 * Every edit is anchored to an existing table header and appended after that
 * table's last row. When any anchor is missing nothing is written.
 *
 * @module dsh-paper-suite/registry
 */

import { join } from 'node:path';
import { finding, readText, writeText } from './util.js';

/** Insert `row` after the last row of the table whose header contains `anchor`. */
export function insertTableRow(markdown, anchor, row) {
	const lines = markdown.split(/\r?\n/);
	const headerIndex = lines.findIndex((line) => line.trimStart().startsWith('|') && line.includes(anchor));
	if (headerIndex === -1) return undefined;
	if (lines.some((line) => line.trim() === row.trim())) return { changed: false, text: markdown };

	let last = headerIndex;
	while (last + 1 < lines.length && lines[last + 1].trimStart().startsWith('|')) last += 1;
	lines.splice(last + 1, 0, row);
	return { changed: true, text: lines.join('\n') };
}

/** Rows this paper should contribute to each registry. */
export function registryRows({ slug, title, scope, host, codePath }) {
	return {
		readme: `| ${title} | [${slug}](${slug}/README.md) | ${scope} |`,
		agents: `| \`${slug}/\` | \`${host}:${codePath}\` |`,
		split: `| ${title} | \`${slug}\` | \`${host}:${codePath}\` | inspected; compact evidence copied, no checkpoints | ${scope} |`
	};
}

/**
 * Plan or apply the three registry rows.
 * @param {{root: string, slug: string, title: string, scope: string, host: string, codePath: string, apply?: boolean}} options
 */
export async function updateRegistries({ root, slug, title, scope, host, codePath, apply = false }) {
	const rows = registryRows({ slug, title, scope, host, codePath });
	const targets = [
		{ file: 'README.md', anchor: '研究线', row: rows.readme },
		{ file: 'AGENTS.md', anchor: 'Paper workspace (this repo)', row: rows.agents },
		{ file: join('docs', 'code_repository_split.md'), anchor: 'Research line', row: rows.split }
	];

	const results = [];
	const findings = [];
	const pending = [];

	for (const target of targets) {
		const path = join(root, target.file);
		const text = await readText(path);
		if (text === undefined) {
			findings.push(finding('warn', 'registry-file-missing', `找不到 ${target.file}`, target.file));
			continue;
		}
		const edited = insertTableRow(text, target.anchor, target.row);
		if (edited === undefined) {
			findings.push(finding('error', 'registry-anchor-missing', `${target.file} 中找不到表头 "${target.anchor}"`, target.file));
			continue;
		}
		if (!edited.changed) {
			results.push({ file: target.file, state: 'already-present' });
			continue;
		}
		pending.push({ path, file: target.file });
		results.push({ file: target.file, state: apply ? 'updated' : 'planned', row: target.row });
	}

	if (apply && findings.every((item) => item.severity !== 'error')) {
		for (const item of pending) {
			const text = await readText(item.path);
			const rowsForFile = results.find((entry) => entry.file === item.file);
			const edited = insertTableRow(text, targets.find((t) => t.file === item.file).anchor, rowsForFile.row);
			if (edited !== undefined && edited.changed) await writeText(item.path, edited.text, { overwrite: true });
		}
	}

	return { results, findings, applied: apply && pending.length > 0 };
}
