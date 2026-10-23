/**
 * Shared filesystem and formatting helpers for dsh-paper-suite.
 * No DSH imports live here so every module stays unit-testable with plain Node.
 * @module dsh-paper-suite/util
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

/** Directories never walked by the scanners. */
export const SKIP_DIRS = new Set([
	'.git',
	'node_modules',
	'__pycache__',
	'.pytest_cache',
	'dist',
	'build',
	'.venv'
]);

/** Whether a path exists. */
export async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** Whether a path is a directory. */
export async function isDir(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** mtime in milliseconds, or 0 when the path is absent. */
export async function mtime(path) {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return 0;
	}
}

/** Recursively list files, optionally filtered by extension. */
export async function listFiles(root, { extensions } = {}) {
	const out = [];
	const walk = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
				await walk(join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			if (extensions !== undefined && !extensions.includes(extname(entry.name).toLowerCase())) continue;
			out.push(join(dir, entry.name));
		}
	};
	await walk(root);
	out.sort();
	return out;
}

/** Read a UTF-8 file, returning undefined when it cannot be read. */
export async function readText(path) {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
}

/** Write a UTF-8 file, creating parents. Refuses to clobber unless `overwrite`. */
export async function writeText(path, content, { overwrite = false } = {}) {
	if (!overwrite && (await exists(path))) return false;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, 'utf8');
	return true;
}

/** SHA-256 of a file, hex encoded. */
export async function sha256File(path) {
	const data = await readFile(path);
	return createHash('sha256').update(data).digest('hex');
}

/** Path relative to root with forward slashes, for stable reporting. */
export function relPath(root, path) {
	return relative(root, path).split(sep).join('/');
}

/** Resolve `path` and require it to sit inside `root`. */
export function confined(root, path) {
	const base = resolve(root);
	const target = resolve(base, path);
	if (target !== base && !target.startsWith(base + sep)) {
		throw new Error(`path escapes the workspace: ${path}`);
	}
	return target;
}

/** One finding: severity, stable code, human message, optional locator. */
export function finding(severity, code, message, locator) {
	return locator === undefined ? { severity, code, message } : { severity, code, message, locator };
}

/** Sort findings error → warn → info, then by code. */
export function sortFindings(findings) {
	const order = { error: 0, warn: 1, info: 2 };
	return [...findings].sort((a, b) => {
		const bySeverity = (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
		return bySeverity !== 0 ? bySeverity : a.code.localeCompare(b.code);
	});
}

/** Count findings by severity. */
export function countBySeverity(findings) {
	const counts = { error: 0, warn: 0, info: 0 };
	for (const item of findings) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
	return counts;
}

/** Render findings as plain text with a one-line header. */
export function renderFindings(title, findings, extraLines = []) {
	const sorted = sortFindings(findings);
	const counts = countBySeverity(sorted);
	const head = `${title}: ${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} info`;
	const body = sorted.map((item) => {
		const where = item.locator === undefined ? '' : ` [${item.locator}]`;
		return `- ${item.severity.toUpperCase()} ${item.code}${where}: ${item.message}`;
	});
	return [head, ...extraLines, ...body].join('\n');
}

/** Slugify a title into a safe directory name. */
export function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}
