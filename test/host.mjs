/**
 * Host-shape test: boots the plugin against a stubbed `@deepseek-ai/dsh-tools`
 * and checks that every advertised tool is registrable and renderable, and that
 * the browser panel's JSON route returns a real report.
 *
 * This catches the class of failure that made a previous research plugin
 * unusable: a tool spec or route the host rejects at mount time.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject, name } from '../lib/index.js';
import { scaffoldPaper } from '../lib/scaffold.js';

assert.equal(name, 'dsh-paper-suite');
assert.deepEqual(inject, ['tools']);

/** Minimal host context: tools always, web server only when asked. */
function makeContext({ withWebServer = false } = {}) {
	const registered = new Map();
	const effects = [];
	const routes = [];
	const ctx = {
		tools: {
			register(spec) {
				if (registered.has(spec.name)) throw new Error(`duplicate tool registration: ${spec.name}`);
				registered.set(spec.name, spec);
			}
		},
		inject(names, callback) {
			if (withWebServer && names.includes('webServer')) {
				callback({
					effect(fn) {
						effects.push(fn());
					},
					webServer: {
						register(route) {
							routes.push(route);
							return () => {};
						}
					}
				});
			}
		}
	};
	return { ctx, registered, routes, effects };
}

const expected = [
	'paper_scaffold',
	'paper_audit',
	'paper_build',
	'paper_sync_evidence',
	'paper_kit',
	'paper_review'
];

// A composition without a web server still gets every tool.
{
	const { ctx, registered, routes } = makeContext();
	apply(ctx, { defaultHost: 'ace2' });
	assert.deepEqual([...registered.keys()].sort(), [...expected].sort(), 'unexpected tool set');
	assert.equal(routes.length, 0, 'no route may be registered without a web server');

	for (const [toolName, spec] of registered) {
		assert.equal(typeof spec.execute, 'function', `${toolName}: execute`);
		const rendered = spec.output.render({}, { text: `${toolName} ok` });
		assert.ok(Array.isArray(rendered) && rendered[0]?.type === 'text', `${toolName}: render`);
		assert.equal(rendered[0].text, `${toolName} ok`);
	}

	const required = {
		paper_scaffold: { root: 'D:/tmp', slug: 'x', title: 't' },
		paper_audit: { workspace: 'D:/definitely/not/a/workspace' },
		paper_build: { workspace: 'D:/definitely/not/a/workspace' },
		paper_sync_evidence: { workspace: 'D:/tmp', remotePaths: '/x/y.npz' },
		paper_kit: { root: 'D:/tmp', slug: '../escape', title: 't' },
		paper_review: { root: 'D:/definitely/not/a/root' }
	};

	for (const [toolName, args] of Object.entries(required)) {
		const result = await registered.get(toolName).execute(args);
		assert.equal(typeof result.text, 'string', `${toolName}: returns text on failure`);
		assert.ok(result.text.length > 0, `${toolName}: non-empty failure text`);
	}
}

// With a web server the panel route exists and serves the collection report.
const root = await mkdtemp(join(tmpdir(), 'paper-suite-route-'));
try {
	await scaffoldPaper({ root, slug: 'demo', title: '演示论文' });
	const { ctx, routes } = makeContext({ withWebServer: true });
	apply(ctx, { repoRoot: root });

	assert.equal(routes.length, 1, 'exactly one report route');
	const route = routes[0];
	assert.equal(route.kind, 'exact');
	assert.equal(route.path, '/paper-suite/report.json');

	const response = {
		status: undefined,
		body: undefined,
		writeHead(status) {
			this.status = status;
		},
		end(body) {
			this.body = body;
		}
	};
	await route.handler({ url: '/paper-suite/report.json?fresh=1' }, response);
	assert.equal(response.status, 200);
	const report = JSON.parse(response.body);
	assert.equal(report.summary.papers, 1);
	assert.equal(report.papers[0].slug, 'demo');
	assert.ok(Array.isArray(report.papers[0].findings));
	assert.ok(report.papers[0].scores.completeness >= 0);
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log(`host-shape ok: ${expected.length} tools registered, panel route returns a report`);
