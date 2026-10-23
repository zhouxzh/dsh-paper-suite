/**
 * Test stub for the host-provided `@deepseek-ai/dsh-tools` package.
 *
 * It validates the shape a real `defineTool` call must satisfy and returns the
 * spec unchanged, so `test/host.mjs` can exercise `apply()` without booting
 * DeepSeek Harness. `scripts/link-stub.mjs` copies this fixture into
 * `node_modules/@deepseek-ai/dsh-tools` before the test run.
 */

export function defineTool(spec) {
	if (typeof spec?.name !== 'string' || spec.name.length === 0) throw new Error('tool needs a name');
	if (typeof spec?.description !== 'string' || spec.description.length === 0)
		throw new Error(`${spec.name}: tool needs a description`);
	if (typeof spec?.parameters !== 'object' || spec.parameters === null)
		throw new Error(`${spec.name}: tool needs a parameters object`);
	if (typeof spec?.output?.schema !== 'object') throw new Error(`${spec.name}: tool needs output.schema`);
	if (typeof spec?.output?.render !== 'function') throw new Error(`${spec.name}: tool needs output.render`);
	if (typeof spec?.execute !== 'function') throw new Error(`${spec.name}: tool needs execute()`);
	return spec;
}
