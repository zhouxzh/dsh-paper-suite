#!/usr/bin/env node
/**
 * Copy the `@deepseek-ai/dsh-tools` test fixture into `node_modules` so the
 * host-shape test can resolve the bare specifier on a fresh clone.
 *
 * `node_modules` is git-ignored, so this runs as the `pretest` hook instead of
 * committing a fake dependency.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = join(root, 'test', 'fixtures', 'dsh-tools');
const target = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools');

await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true, force: true });
console.log(`stub ready: ${target}`);
