/**
 * Host-shape test: boots the plugin against a stubbed `@deepseek-ai/dsh-tools`
 * and checks that every advertised tool is registrable and renderable.
 *
 * This catches the class of failure that made a previous research plugin
 * unusable: a tool spec that the host codec rejects at mount time.
 */

import assert from 'node:assert/strict';

import { apply, inject, name } from '../lib/index.js';

assert.equal(name, 'dsh-paper-suite');
assert.deepEqual(inject, ['tools']);

const registered = new Map();
const ctx = {
	tools: {
		register(spec) {
			if (registered.has(spec.name)) throw new Error(`duplicate tool registration: ${spec.name}`);
			registered.set(spec.name, spec);
		}
	}
};

apply(ctx, { defaultHost: 'ace2' });

const expected = ['paper_scaffold', 'paper_audit', 'paper_build', 'paper_sync_evidence', 'paper_kit'];
assert.deepEqual([...registered.keys()].sort(), [...expected].sort(), 'unexpected tool set');

for (const [toolName, spec] of registered) {
	assert.equal(typeof spec.execute, 'function', `${toolName}: execute`);
	const rendered = spec.output.render({}, { text: `${toolName} ok` });
	assert.ok(Array.isArray(rendered) && rendered[0]?.type === 'text', `${toolName}: render`);
	assert.equal(rendered[0].text, `${toolName} ok`);
}

// Every tool must degrade to a readable failure instead of throwing.
const required = {
	paper_scaffold: { root: 'D:/tmp', slug: 'x', title: 't' },
	paper_audit: { workspace: 'D:/definitely/not/a/workspace' },
	paper_build: { workspace: 'D:/definitely/not/a/workspace' },
	paper_sync_evidence: { workspace: 'D:/tmp', remotePaths: '/x/y.npz' },
	paper_kit: { root: 'D:/tmp', slug: '../escape', title: 't' }
};

for (const [toolName, args] of Object.entries(required)) {
	const result = await registered.get(toolName).execute(args);
	assert.equal(typeof result.text, 'string', `${toolName}: returns text on failure`);
	assert.ok(result.text.length > 0, `${toolName}: non-empty failure text`);
}

console.log(`host-shape ok: ${registered.size} tools registered and failure paths degrade to text`);
