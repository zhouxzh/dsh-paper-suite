/**
 * Scaffold a paper workspace without ever overwriting author-written prose.
 * @module dsh-paper-suite/scaffold
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { paperScaffold, PROTECTED_FILES } from './templates.js';
import { exists, slugify, writeText } from './util.js';

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Create the paper skeleton under `<root>/<slug>`.
 *
 * Existing files are skipped, never rewritten. `PROTECTED_FILES` are additionally
 * reported as protected so a caller cannot mistake "skipped" for "identical".
 *
 * @param {object} options
 * @param {string} options.root Repository root that will contain the workspace.
 * @param {string} options.slug Workspace directory name.
 * @param {string} options.title Paper title used in `main.tex` and `README.md`.
 * @param {string} [options.author] Author line; defaults to a placeholder.
 * @param {boolean} [options.dryRun] Report the plan without writing anything.
 * @returns {Promise<{dir: string, created: string[], skipped: string[], protectedSkipped: string[], dryRun: boolean}>}
 */
export async function scaffoldPaper({ root, slug, title, author, dryRun = false }) {
	const clean = slugify(slug ?? title);
	if (!SAFE_SLUG.test(clean)) {
		throw new Error(`invalid workspace slug "${clean}"; use lowercase letters, digits and dashes`);
	}
	if (typeof title !== 'string' || title.trim().length === 0) {
		throw new Error('a non-empty title is required');
	}

	const dir = join(root, clean);
	const files = paperScaffold({ title: title.trim(), slug: clean, author });
	const created = [];
	const skipped = [];
	const protectedSkipped = [];

	for (const [relative, content] of Object.entries(files)) {
		const target = join(dir, relative);
		if (await exists(target)) {
			skipped.push(relative);
			if (PROTECTED_FILES.includes(relative)) protectedSkipped.push(relative);
			continue;
		}
		if (!dryRun) {
			await mkdir(dirname(target), { recursive: true });
			await writeText(target, content, { overwrite: false });
		}
		created.push(relative);
	}

	if (!dryRun) await mkdir(join(dir, 'evidence'), { recursive: true });

	return { dir, created, skipped, protectedSkipped, dryRun };
}
