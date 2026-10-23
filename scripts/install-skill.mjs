#!/usr/bin/env node
/**
 * Copy every bundled skill into a DSH skill root.
 *
 * Skills are plain files: dropping `<name>/SKILL.md` into a scanned skill root is
 * all that DSH needs. Directories without a `SKILL.md` are support material and
 * are skipped (they are copied only when a sibling skill references them by path
 * inside its own directory).
 *
 * Usage:
 *   node scripts/install-skill.mjs                 # install to ~/.dsh/skills
 *   node scripts/install-skill.mjs --target <dir>  # install elsewhere
 *   node scripts/install-skill.mjs --check         # verify, non-zero when stale
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = resolve(here, '..', 'skills');

/** SHA-256 of a file, or undefined when it is absent. */
async function hash(path) {
	try {
		return createHash('sha256').update(await readFile(path)).digest('hex');
	} catch {
		return undefined;
	}
}

/** Skill directories: those carrying a SKILL.md. */
export async function listSkills(root = skillsRoot) {
	const entries = await readdir(root, { withFileTypes: true });
	const skills = [];
	const skipped = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = join(root, entry.name);
		try {
			await stat(join(dir, 'SKILL.md'));
			skills.push({ name: entry.name, dir });
		} catch {
			skipped.push(entry.name);
		}
	}
	skills.sort((a, b) => a.name.localeCompare(b.name));
	return { skills, skipped };
}

/**
 * Install, or with `check: true`, compare without writing.
 * @param {{target?: string, check?: boolean}} options
 */
export async function installSkills({ target, check = false } = {}) {
	const root = target === undefined ? join(homedir(), '.dsh', 'skills') : resolve(target);
	const { skills, skipped } = await listSkills();
	const results = [];

	for (const skill of skills) {
		const dest = join(root, skill.name);
		const sourceHash = await hash(join(skill.dir, 'SKILL.md'));
		const destHash = await hash(join(dest, 'SKILL.md'));
		if (check) {
			results.push({
				name: skill.name,
				state: destHash === undefined ? 'missing' : destHash === sourceHash ? 'current' : 'stale'
			});
			continue;
		}
		await mkdir(root, { recursive: true });
		await cp(skill.dir, dest, { recursive: true, force: true });
		results.push({ name: skill.name, state: destHash === undefined ? 'installed' : 'updated' });
	}

	return { root, results, skipped };
}

// Windows exposes argv[1] as a native path, so compare canonical file URLs
// instead of hand-building one (two slashes vs three silently never matches).
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	const args = process.argv.slice(2);
	const check = args.includes('--check');
	const index = args.indexOf('--target');
	const target = index === -1 ? undefined : args[index + 1];
	const { root, results, skipped } = await installSkills({ target, check });

	for (const item of results) console.log(`${item.state.padEnd(9)} ${item.name}`);
	if (skipped.length > 0) console.log(`skipped (no SKILL.md): ${skipped.join(', ')}`);
	console.log(`skill root: ${root}`);

	if (check) {
		const bad = results.filter((item) => item.state !== 'current');
		if (bad.length > 0) {
			console.error(`${bad.length} skill(s) missing or stale; run: node scripts/install-skill.mjs`);
			process.exit(1);
		}
		console.log('all bundled skills are installed and current');
	}
}
