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
import { mkdir, rename, unlink } from 'node:fs/promises';
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

/**
 * An SSH destination must look like a plain alias or hostname.
 *
 * scp interprets a leading `-` as an option, so an unvalidated host such as
 * `-oProxyCommand=...` would let a crafted tool argument execute a local
 * command. Anything outside this character set is rejected before scp runs.
 */
const SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @param {string} host */
export function validateHost(host) {
	if (typeof host !== 'string' || host.length === 0) {
		return finding('error', 'invalid-host', 'host is required, e.g. ace2 or zhong3');
	}
	if (!SSH_HOST.test(host)) {
		return finding(
			'error',
			'invalid-host',
			`host "${host}" is not a plain SSH alias/hostname (letters, digits, dot, dash, underscore only)`,
			host
		);
	}
	return undefined;
}

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
		if (!remote.startsWith('/') && !remote.startsWith('~/')) {
			findings.push(finding('error', 'relative-remote-path', `${remote} 必须是远程绝对路径或以 ~/ 开头`, remote));
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
	const hostFinding = validateHost(host);
	if (hostFinding !== undefined) return { planned: [], synced: [], findings: [hostFinding], dryRun };

	const { allowed, findings } = validateRemotePaths(remotePaths);
	const destDir = join(workspace, 'evidence');
	const planned = [];
	const manifestEntries = [];

	if (!dryRun) await mkdir(destDir, { recursive: true });

	// Two remote paths with the same basename would silently overwrite each
	// other in evidence/, so treat that as a caller error instead of a surprise.
	const claimedNames = new Map();
	for (const remote of allowed) {
		const name = basename(remote);
		const previous = claimedNames.get(name);
		if (previous !== undefined && previous !== remote) {
			findings.push(
				finding('error', 'evidence-name-collision', `${previous} 与 ${remote} 同名，会互相覆盖`, name)
			);
		} else {
			claimedNames.set(name, remote);
		}
	}

	for (const remote of allowed) {
		const name = basename(remote);
		if (findings.some((item) => item.code === 'evidence-name-collision' && item.locator === name)) continue;

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
			await rename(staging, dest);
		} catch (error) {
			await unlink(staging).catch(() => {});
			findings.push(
				finding('error', 'scp-failed', `从 ${source} 拉取失败：${(error.stderr ?? error.message ?? '').trim()}`, remote)
			);
			continue;
		}
		const hash = await sha256File(dest);
		manifestEntries.push({ file: name, remote: source, sha256: hash, syncedAt: new Date().toISOString() });
	}

	if (!dryRun && manifestEntries.length > 0) {
		const manifestPath = join(destDir, 'SYNC_MANIFEST.json');
		let existing = { entries: [] };
		try {
			existing = JSON.parse((await readText(manifestPath)) ?? '{"entries":[]}');
		} catch {
			findings.push(
				finding('warn', 'manifest-unreadable', 'SYNC_MANIFEST.json 无法解析，已按空清单重建', 'SYNC_MANIFEST.json')
			);
		}
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
