/**
 * dsh-paper-suite — Host half.
 *
 * Registers five model-facing tools over the offline modules in this package:
 *
 * - `paper_scaffold`      create a Chinese LaTeX paper skeleton, never overwriting prose
 * - `paper_audit`         citation / bibliography / claim-map / author-placeholder audit
 * - `paper_build`         latexmk build with structured diagnostics
 * - `paper_sync_evidence` pull compact evidence from a remote code repository
 * - `paper_kit`           scaffold + registry rows + audit + build in one call
 *
 * There is no browser half and no custom remote codec, so this plugin depends on
 * nothing beyond the host-provided `@deepseek-ai/dsh-tools`.
 *
 * @module dsh-paper-suite
 */

import { join } from 'node:path';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { auditPaper } from './audit.js';
import { buildPaper } from './build.js';
import { reviewCollection, reviewPaper } from './review.js';
import { updateRegistries } from './registry.js';
import { scaffoldPaper } from './scaffold.js';
import { syncEvidence } from './sync.js';
import { countBySeverity, renderFindings, sortFindings } from './util.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-paper-suite';

/** The host services this plugin needs before it may mount. */
export const inject = ['tools'];

/** Exact route the browser panel reads its report from. */
const REPORT_PATH = '/paper-suite/report.json';

/** How long a computed collection report stays cached for the HTTP route. */
const REPORT_TTL_MS = 5000;

/** Resolve the repository root the panel scans. */
function resolveRoot(config) {
	const root = config?.repoRoot;
	return typeof root === 'string' && root.length > 0 ? root : process.cwd();
}

const ROOT_PARAM = {
	type: 'string',
	description: 'Absolute path of the repository root that contains (or will contain) the paper workspace.'
};

const WORKSPACE_PARAM = {
	type: 'string',
	required: true,
	description: 'Absolute path of one paper workspace, e.g. D:\\Github\\nonstationary-mamba\\mamba-autocon-tsf'
};

const OUTPUT = {
	schema: { type: 'object', additionalProperties: true },
	render: (_args, value) => [{ type: 'text', text: value?.text ?? '(no output)' }]
};

/** Wrap a tool body so an exception becomes a readable failure, not a crash. */
function guarded(label, body) {
	return async (args) => {
		try {
			return await body(args);
		} catch (error) {
			return {
				text: `${label} failed: ${error?.message ?? String(error)}`,
				summary: { ok: false, error: String(error?.message ?? error) }
			};
		}
	};
}

/** Format an audit result as text. */
function auditText(dir, result) {
	const extra = [];
	if (result.summary !== undefined) {
		extra.push(
			`citations: ${result.summary.citedKeys} key(s) in ${result.texFiles} tex file(s), ` +
				`${result.summary.bibEntries} bib entry/entries, ${result.summary.missing} missing, ${result.summary.uncited} uncited`
		);
	}
	extra.push(`pdf: ${result.freshness.state}`);
	return renderFindings(`Audit ${dir}`, result.findings, extra);
}

/**
 * Register the paper-suite tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{repoRoot?: string, defaultHost?: string}} [config]
 */
export function apply(ctx, config = {}) {
	ctx.tools.register(
		defineTool({
			name: 'paper_scaffold',
			description:
				'Create a Chinese LaTeX paper workspace (scrartcl + ctex + biblatex APA + XeLaTeX) with sections, ' +
				'claims register, claim-evidence map, author-verification checklist and provenance file. ' +
				'Existing files are never overwritten: prose you have written is always safe. ' +
				'Use dryRun first to see what would be created.',
			parameters: {
				root: { ...ROOT_PARAM, required: true },
				slug: { type: 'string', required: true, description: 'Workspace directory name, e.g. mamba-autocon-tsf.' },
				title: { type: 'string', required: true, description: 'Paper title used in main.tex and README.md.' },
				author: { type: 'string', description: 'Author line. Defaults to the "待作者确认" placeholder.' },
				dryRun: { type: 'boolean', description: 'Report the plan without writing. Default false.' }
			},
			output: OUTPUT,
			execute: guarded('paper_scaffold', async (args) => {
				const result = await scaffoldPaper({
					root: args.root,
					slug: args.slug,
					title: args.title,
					author: args.author,
					dryRun: args.dryRun === true
				});
				const lines = [
					`${result.dryRun ? 'Planned' : 'Scaffolded'} ${result.dir}`,
					`created: ${result.created.length} file(s)`,
					...result.created.map((file) => `  + ${file}`),
					`skipped (already present): ${result.skipped.length}`
				];
				if (result.protectedSkipped.length > 0) {
					lines.push(`protected files left untouched: ${result.protectedSkipped.join(', ')}`);
				}
				return {
					text: lines.join('\n'),
					summary: {
						ok: true,
						dir: result.dir,
						created: result.created,
						skipped: result.skipped,
						protectedSkipped: result.protectedSkipped
					}
				};
			})
		})
	);

	ctx.tools.register(
		defineTool({
			name: 'paper_audit',
			description:
				'Audit one paper workspace offline: \\cite keys that have no bibliography entry, bibliography entries ' +
				'never cited, duplicate keys, missing required fields, unbalanced braces, unresolved author/section ' +
				'placeholders, claim-map evidence files that do not exist, open author-verification items, and whether ' +
				'main.pdf is older than its sources. It cannot verify that a DOI resolves or that a claim is true.',
			parameters: {
				workspace: WORKSPACE_PARAM,
				maxFindings: { type: 'integer', description: 'Cap on returned findings after sorting. Default 200.' }
			},
			output: OUTPUT,
			execute: guarded('paper_audit', async (args) => {
				const result = await auditPaper({ dir: args.workspace });
				const all = sortFindings(result.findings);
				const cap = Number.isInteger(args.maxFindings) ? args.maxFindings : 200;
				const shown = all.slice(0, cap);
				const counts = countBySeverity(all);
				return {
					text: renderFindings(`Audit ${args.workspace}`, shown, [
						`citations: ${result.summary?.citedKeys ?? 0} key(s), ${result.summary?.bibEntries ?? 0} bib entry/entries, ` +
							`${result.summary?.missing ?? 0} missing, ${result.summary?.uncited ?? 0} uncited`,
						`pdf: ${result.freshness.state}`,
						shown.length < all.length ? `(${all.length - shown.length} more finding(s) suppressed by maxFindings)` : ''
					].filter(Boolean)),
					summary: {
						ok: counts.error === 0,
						...counts,
						total: all.length,
						freshness: result.freshness.state,
						citations: result.summary
					}
				};
			})
		})
	);

	ctx.tools.register(
		defineTool({
			name: 'paper_build',
			description:
				'Compile a paper workspace with latexmk and return structured diagnostics: LaTeX errors, undefined ' +
				'citations and references, missing glyphs, overfull horizontal boxes and the resulting page count. ' +
				'Picks XeLaTeX automatically when the entry file uses ctex/xeCJK/fontspec.',
			parameters: {
				workspace: WORKSPACE_PARAM,
				entry: { type: 'string', description: 'Entry .tex filename. Default main.tex.' },
				engine: { type: 'string', description: 'auto (default), xelatex, pdflatex or lualatex.' },
				timeoutMs: { type: 'integer', description: 'Compile timeout in milliseconds. Default 300000.' }
			},
			output: OUTPUT,
			execute: guarded('paper_build', async (args) => {
				const result = await buildPaper({
					dir: args.workspace,
					entry: args.entry ?? 'main.tex',
					engine: args.engine ?? 'auto',
					timeoutMs: Number.isInteger(args.timeoutMs) ? args.timeoutMs : 300000
				});
				const counts = countBySeverity(result.findings);
				const header = `${result.ok ? 'Build OK' : 'Build FAILED'} (${result.engine ?? 'unknown engine'}, exit ${result.exitCode})`;
				const meta = [
					`pages: ${result.pageCount ?? 'unknown'}`,
					`errors: ${counts.error}, warnings: ${counts.warn}`,
					result.freshness === undefined ? '' : `pdf: ${result.freshness.state}`
				].filter(Boolean);
				return {
					text: renderFindings(header, result.findings, meta),
					summary: { ok: result.ok, exitCode: result.exitCode, pages: result.pageCount, ...counts }
				};
			})
		})
	);

	ctx.tools.register(
		defineTool({
			name: 'paper_sync_evidence',
			description:
				'Copy compact evidence files (.csv/.json/.md/.yaml/.bib) from a remote code repository into the ' +
				'workspace evidence/ directory, hashing each file into evidence/SYNC_MANIFEST.json. Checkpoints, ' +
				'prediction arrays, datasets and archives are refused. Run with dryRun first.',
			parameters: {
				workspace: WORKSPACE_PARAM,
				host: { type: 'string', description: 'SSH host alias, e.g. ace2 or zhong3. Defaults to plugin config.' },
				remotePaths: {
					type: 'string',
					required: true,
					description: 'Comma-separated absolute remote paths, e.g. /home/zhong/runs/x/metrics.csv'
				},
				overwrite: { type: 'boolean', description: 'Overwrite an existing local evidence file. Default false.' },
				dryRun: { type: 'boolean', description: 'Print the scp plan without contacting the host. Default false.' }
			},
			output: OUTPUT,
			execute: guarded('paper_sync_evidence', async (args) => {
				const host = args.host ?? config.defaultHost;
				if (typeof host !== 'string' || host.length === 0) {
					throw new Error('no host given and no defaultHost configured for dsh-paper-suite');
				}
				const remotePaths = String(args.remotePaths)
					.split(',')
					.map((item) => item.trim())
					.filter((item) => item.length > 0);
				const result = await syncEvidence({
					workspace: args.workspace,
					host,
					remotePaths,
					overwrite: args.overwrite === true,
					dryRun: args.dryRun === true
				});
				const lines = [
					result.dryRun ? 'Planned evidence sync (dry run)' : 'Evidence sync',
					...result.planned.map((item) => `  ${item.source} -> ${item.dest}`),
					...result.synced.map((item) => `  synced ${item.file} sha256=${item.sha256.slice(0, 12)}`)
				];
				const findings = sortFindings(result.findings);
				return {
					text: lines.concat(findings.map((item) => `- ${item.severity.toUpperCase()} ${item.code}: ${item.message}`)).join('\n'),
					summary: { ok: findings.every((item) => item.severity !== 'error'), synced: result.synced.length }
				};
			})
		})
	);

	ctx.tools.register(
		defineTool({
			name: 'paper_kit',
			description:
				'One call for the repetitive part of starting or finishing a paper: optionally scaffold the workspace, ' +
				'propose the three repository registry rows (README / AGENTS / code_repository_split), then audit and ' +
				'build it. Registry writes are opt-in via applyRegistries and default to a printed plan.',
			parameters: {
				root: { ...ROOT_PARAM, required: true },
				slug: { type: 'string', required: true, description: 'Workspace directory name.' },
				title: { type: 'string', required: true, description: 'Paper title.' },
				scope: { type: 'string', description: 'One-line evidence scope used in the registry rows.' },
				host: { type: 'string', description: 'Code host for the registry rows, e.g. ace2.' },
				codePath: { type: 'string', description: 'Absolute code repository path on that host.' },
				author: { type: 'string', description: 'Author line; defaults to the placeholder.' },
				scaffold: { type: 'boolean', description: 'Create missing files. Default true.' },
				applyRegistries: { type: 'boolean', description: 'Actually write README/AGENTS/split rows. Default false.' },
				build: { type: 'boolean', description: 'Run latexmk after the audit. Default false.' }
			},
			output: OUTPUT,
			execute: guarded('paper_kit', async (args) => {
				const sections = [];
				// join() keeps this portable: the old template used a literal
				// backslash, which produced "root\slug" even on POSIX hosts.
				let workspace = join(args.root, args.slug);

				if (args.scaffold !== false) {
					const scaffold = await scaffoldPaper({
						root: args.root,
						slug: args.slug,
						title: args.title,
						author: args.author
					});
					workspace = scaffold.dir;
					sections.push(`scaffold: ${scaffold.created.length} created, ${scaffold.skipped.length} skipped`);
				}

				if (typeof args.scope === 'string' && typeof args.host === 'string' && typeof args.codePath === 'string') {
					const registry = await updateRegistries({
						root: args.root,
						slug: args.slug,
						title: args.title,
						scope: args.scope,
						host: args.host,
						codePath: args.codePath,
						apply: args.applyRegistries === true
					});
					sections.push(
						`registries: ${registry.results.map((item) => `${item.file}=${item.state}`).join(', ') || 'none'}`
					);
					for (const item of registry.results.filter((entry) => entry.row !== undefined)) {
						sections.push(`  ${item.file}: ${item.row}`);
					}
					if (registry.findings.length > 0) sections.push(renderFindings('registry', registry.findings));
				}

				const audit = await auditPaper({ dir: workspace });
				sections.push(auditText(workspace, audit));

				if (args.build === true) {
					const build = await buildPaper({ dir: workspace });
					sections.push(renderFindings(`Build (${build.engine ?? 'unknown'})`, build.findings, [`pages: ${build.pageCount ?? 'unknown'}`]));
				}

				const counts = countBySeverity(audit.findings);
				return {
					text: sections.join('\n\n'),
					summary: { ok: counts.error === 0, workspace, audit: counts }
				};
			})
		})
	);

	ctx.tools.register(
		defineTool({
			name: 'paper_review',
			description:
				'Answer "is this paper complete and internally coherent?" for one workspace or every paper under a root. ' +
				'Checks section coverage, claim evidence, dangling \\ref targets, missing figure files, table captions, ' +
				'numbers in the abstract/conclusion that cannot be found in results or evidence, and limitation/scope ' +
				'statements. Mechanical defects are errors; rhetorical checks are info-only.',
			parameters: {
				root: ROOT_PARAM,
				workspace: {
					type: 'string',
					description: 'Review a single paper workspace instead of every paper under root.'
				}
			},
			output: OUTPUT,
			execute: guarded('paper_review', async (args) => {
				if (typeof args.workspace === 'string' && args.workspace.length > 0) {
					const single = await reviewPaper({ dir: args.workspace });
					const counts = countBySeverity(single.findings);
					const lines = [
						`${single.slug}: ${single.verdict.toUpperCase()} (overall ${single.overall})`,
						`completeness ${single.scores.completeness} · results ${single.scores.results} · logic ${single.scores.logic}`,
						`sections ${single.stats.sections}/${single.stats.sectionsTotal} · tables ${single.stats.tables} · figures ${single.stats.figures} · claims ${single.stats.claims} · pdf ${single.stats.pdf}`
					];
					return {
						text: `${lines.join('\n')}\n\n${renderFindings('findings', single.findings)}`,
						summary: { ok: counts.error === 0, ...counts, verdict: single.verdict, scores: single.scores }
					};
				}
				const report = await reviewCollection({ root: args.root ?? resolveRoot(config) });
				const lines = [
					`${report.summary.papers} paper(s): ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
					`root: ${report.root}`
				];
				for (const paper of report.papers) {
					const errors = paper.findings.filter((item) => item.severity === 'error').length;
					lines.push(
						`- ${paper.slug}: ${paper.verdict.toUpperCase()} overall ${paper.overall} ` +
							`(completeness ${paper.scores.completeness}, results ${paper.scores.results}, logic ${paper.scores.logic}, ${errors} error(s))`
					);
				}
				return {
					text: lines.join('\n'),
					summary: { ok: report.summary.fail === 0, ...report.summary, root: report.root }
				};
			})
		})
	);

	// The browser panel reads the same review data over HTTP. A composition
	// without a web server (headless, ACP) simply keeps the tools.
	ctx.inject(['webServer'], (scope) => {
		let cache;
		const report = async (fresh) => {
			const now = Date.now();
			if (fresh !== true && cache !== undefined && now - cache.at < REPORT_TTL_MS) return cache.value;
			const value = await reviewCollection({ root: resolveRoot(config) });
			cache = { at: now, value };
			return value;
		};
		const handler = async (request, response) => {
			const fresh = (request.url ?? '').includes('fresh=1');
			try {
				const body = JSON.stringify(await report(fresh));
				response.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store',
					'content-length': Buffer.byteLength(body)
				});
				response.end(body);
			} catch (error) {
				const body = JSON.stringify({ ok: false, error: String(error?.message ?? error) });
				response.writeHead(500, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store',
					'content-length': Buffer.byteLength(body)
				});
				response.end(body);
			}
		};
		scope.effect(
			() => scope.webServer.register({ kind: 'exact', path: REPORT_PATH, handler }),
			'paper-suite: report route'
		);
	});
}
