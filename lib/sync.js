/**
 * Pull compact evidence from a remote code repository into `evidence/`.
 *
 * Only text-sized evidence (csv/json/md/yaml/bib) may cross the boundary.
 * Checkpoints, prediction arrays, datasets and archives are refused: the paper
 * workspace is an evidence index, not a copy of the training tree.
 *
 * @module dsh-paper-suite/sync
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { exists, finding, readText, sha256File, writeText } from './util.js';

const run = promisify(execFile);

/** Extensions allowed across the evidence boundary. */
export const ALLOWED_EXTENSIONS = new Set(['.csv', '.json', '.md', '.yaml', '.yml', '.bib']);

/** Extensions that must never be pulled into the paper repository. */
export const REFUSED_EXTENSIONS = new Set([
	'.npz',
	'.npy',
	'.pt',
	'.pth',
	'.ckpt',
	'.safetensors',
	'.zip',
	'.tar',
	'.gz',
	'.tgz',
	'.parquet',
	'.db'
]);

/** Validate one remote path list before any network call. */
export function validateRemotePaths(remotePaths) {
	const findings = [];
	const allowed = [];
	for (const remote of remotePaths) {
		const ext = extname(remote).toLowerCase();
		if (REFUSED_EXTENSIONS.has(ext)) {
			findings.push(finding('error', 'refused-artifact', `${remote} 是二进制/数据产物，不允许进入论文仓库`, remote));
			continue;
		}
		if (!ALLOWED_EXTENSIONS.has(ext)) {
			findings.push(
				finding('error', 'unsupported-extension', `${remote} 的扩展名 ${ext || '(none)'} 不在允许清单内`, remote)
			);
			continue;
		}
		allowed.push(remote);
	}
	return { allowed, findings };
}

/**
 * Copy compact evidence files from `host:remotePath` into `<workspace>/evidence`.
 * @param {{workspace: string, host: string, remotePaths: string[], overwrite?: boolean, dryRun?: boolean, timeoutMs?: number}} options
 */
export async function syncEvidence({ workspace, host, remotePaths, overwrite = false, dryRun = false, timeoutMs = 120000 }) {
	const { allowed, findings } = validateRemotePaths(remotePaths);
	const destDir = join(workspace, 'evidence');
	const planned = [];
	const manifestEntries = [];

	if (!dryRun) await mkdir(destDir, { recursive: true });

	for (const remote of allowed) {
		const name = basename(remote);
		const dest = join(destDir, name);
		if (!overwrite && (await exists(dest))) {
			findings.push(finding('warn', 'evidence-exists', `${name} 已存在，跳过（overwrite=true 才覆盖）`, name));
			continue;
		}
		const source = `${host}:${remote}`;
		planned.push({ source, dest });
		if (dryRun) continue;

		const staging = join(destDir, `.staging-${name}`);
		try {
			await run('scp', ['-o', 'BatchMode=yes', source, staging], { timeout: timeoutMs });
		} catch (error) {
			findings.push(
				finding('error', 'scp-failed', `从 ${source} 拉取失败：${(error.stderr ?? error.message ?? '').trim()}`, remote)
			);
			continue;
		}
		await copyFile(staging, dest);
		const hash = await sha256File(dest);
		manifestEntries.push({ file: name, remote: source, sha256: hash, syncedAt: new Date().toISOString() });
	}

	if (!dryRun && manifestEntries.length > 0) {
		const manifestPath = join(destDir, 'SYNC_MANIFEST.json');
		const existing = JSON.parse((await readText(manifestPath)) ?? '{"entries":[]}');
		const merged = new Map((existing.entries ?? []).map((entry) => [entry.file, entry]));
		for (const entry of manifestEntries) merged.set(entry.file, entry);
		await writeText(
			manifestPath,
			`${JSON.stringify({ workspace, host, entries: [...merged.values()] }, null, 2)}\n`,
			{ overwrite: true }
		);
	}

	return { planned, synced: manifestEntries, findings, dryRun };
}
