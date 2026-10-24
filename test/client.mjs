/**
 * Client-shape test: executes lib/client.js against a fake `__ModuleLoader__`
 * and asserts that it registers exactly the sidebar entry and the panel.
 *
 * A malformed client bundle otherwise fails only after a DSH restart, where the
 * symptom is an empty panel with no diagnostics.
 */

import assert from 'node:assert/strict';

let loaded;
globalThis.window = {
	__ModuleLoader__: {
		load(spec) {
			loaded = spec;
		}
	}
};

await import('../lib/client.js');
assert.ok(loaded !== undefined, 'client did not call __ModuleLoader__.load');
assert.equal(loaded.id, 'dsh-paper-suite');

// Minimal React surface: components are registered, never rendered, here.
const react = {
	createElement: (...args) => args,
	useState: (initial) => [initial, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn,
	useMemo: (fn) => fn()
};

const module = loaded.factory((id) => {
	if (id === 'react') return react;
	throw new Error(`unexpected client dependency: ${id}`);
});

assert.equal(module.PANEL_ID, 'paper-suite');
assert.deepEqual(module.inject, ['slots']);
assert.equal(typeof module.apply, 'function');

const registrations = [];
const ctx = {
	slots: {
		inject(_name, factory) {
			const out = factory();
			if (out !== undefined && typeof out.next === 'function') {
				out.next();
				out.next();
			}
		},
		register(spec, component) {
			registrations.push({ spec, component });
		}
	}
};

// installStyles touches document; provide the smallest possible DOM shim.
globalThis.document = {
	getElementById: () => null,
	createElement: () => ({ id: '', textContent: '' }),
	head: { appendChild: () => {} }
};

module.apply(ctx);

assert.equal(registrations.length, 2, 'expected a main panel and a sidebar entry');
assert.deepEqual(registrations.map((item) => item.spec.name).sort(), ['main', 'sidebar.panellist']);
assert.ok(registrations.every((item) => typeof item.component === 'function'));
assert.equal(registrations[1].spec.id, 'paper-suite');
assert.ok(registrations[1].spec.label.length > 0);

console.log(`client ok: ${registrations.length} registrations (panel + sidebar entry)`);
