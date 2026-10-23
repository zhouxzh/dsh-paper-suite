/**
 * Skill-package test: every bundled skill must carry valid frontmatter whose
 * name matches its directory, and the installer must round-trip and then report
 * "current" on --check.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installSkills, listSkills } from '../scripts/install-skill.mjs';

const { skills, skipped } = await listSkills();
assert.ok(skills.length >= 2, `expected at least 2 skills, got ${skills.length}`);

for (const skill of skills) {
	const text = await readFile(join(skill.dir, 'SKILL.md'), 'utf8');
	assert.ok(text.startsWith('---\n'), `${skill.name}: SKILL.md must start with YAML frontmatter`);
	assert.ok(!text.includes('\r\n'), `${skill.name}: CRLF line endings`);
	assert.ok(!text.startsWith('\uFEFF'), `${skill.name}: BOM present`);

	const end = text.indexOf('\n---', 4);
	assert.ok(end > 0, `${skill.name}: unterminated frontmatter`);
	const front = text.slice(4, end);

	const name = /^name:\s*(\S+)\s*$/m.exec(front)?.[1];
	assert.equal(name, basename(skill.dir), `${skill.name}: frontmatter name must match directory`);

	const description = /^description:\s*(.+)$/m.exec(front)?.[1] ?? '';
	assert.ok(description.length >= 60, `${skill.name}: description is too short for routing (${description.length} chars)`);
	assert.ok(!description.includes('TODO'), `${skill.name}: placeholder left in description`);

	assert.ok(text.length > 800, `${skill.name}: skill body looks empty (${text.length} bytes)`);
}

const root = await mkdtemp(join(tmpdir(), 'paper-suite-skills-'));
try {
	const first = await installSkills({ target: root });
	assert.equal(first.results.length, skills.length);
	assert.ok(first.results.every((item) => item.state === 'installed'));

	const second = await installSkills({ target: root, check: true });
	assert.ok(second.results.every((item) => item.state === 'current'), 're-check must report current');

	// The CLI entry point is what users actually run; asserting on it catches a
	// broken direct-invocation guard that module-level tests would miss.
	const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-skill.mjs');
	const install = spawnSync(process.execPath, [cli, '--target', root], { encoding: 'utf8' });
	assert.equal(install.status, 0, `install CLI failed: ${install.stderr}`);
	assert.match(install.stdout, /skill root:/);

	const check = spawnSync(process.execPath, [cli, '--target', root, '--check'], { encoding: 'utf8' });
	assert.equal(check.status, 0, `check CLI failed: ${check.stderr}`);
	assert.match(check.stdout, /installed and current/);
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log(
	`skills ok: ${skills.length} skill(s) valid${skipped.length > 0 ? `, ${skipped.length} support dir(s) skipped` : ''}`
);
