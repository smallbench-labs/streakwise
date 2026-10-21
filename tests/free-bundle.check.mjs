// S-24: checks the shipped configuration (FREE_BUILD=true), not just the unit-test build.
// Builds the free bundle exactly like esbuild.config.mjs, then asserts license/network code is gone
// and that the free license stand-in never unlocks Pro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const external = ['obsidian', 'electron', ...builtinModules];
const free = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'cjs', target: 'es2021', treeShaking: true, minify: true, external, define: { FREE_BUILD: 'true' }, logLevel: 'silent' });
const code = free.outputFiles[0].text;

test('free bundle: no network or Polar code', () => {
	for (const s of ['requestUrl', 'polar.sh', 'api.polar', 'license-keys', 'fetch(', 'XMLHttpRequest', 'formchime.com/api']) {
		assert.ok(!code.includes(s), `free main.js contains "${s}"`);
	}
});

test('free bundle: no license key field, no activate button, no purchase link', () => {
	for (const s of ['License key', 'Activate', 'Buy Pro', 'password', 'secretStorage']) assert.ok(!code.includes(s), `free main.js contains "${s}"`);
	assert.ok(code.includes('Streakwise Pro \\u2014 coming soon') || code.includes('Streakwise Pro — coming soon'));
});

test('free bundle: no export button or PNG folder setting', () => {
	for (const s of ['Export PNG', 'PNG export folder']) assert.ok(!code.includes(s), `free main.js contains "${s}"`);
});

test('free license stand-in: Pro always locked', async () => {
	const mod = await build({ entryPoints: ['src/license/free.ts'], bundle: true, write: false, format: 'esm', platform: 'node', define: { FREE_BUILD: 'true' }, logLevel: 'silent' });
	const { FREE_LICENSE, FREE_KEY_STORE } = await import('data:text/javascript;base64,' + Buffer.from(mod.outputFiles[0].text).toString('base64'));
	assert.equal(FREE_LICENSE.isPro(), false);
	assert.equal(FREE_LICENSE.isConfigured(), false);
	await FREE_LICENSE.activate('ANY-KEY', 'Obsidian');
	assert.equal(FREE_LICENSE.isPro(), false);
	assert.equal(FREE_KEY_STORE.load('legacy'), '');
});
