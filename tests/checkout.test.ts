import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKOUT_URL, REGION_URL, REGION_TIMEOUT_MS, checkRegion, shouldShowBuyButton } from '../src/license/checkout';

test('checkout link uses the shared gate, never polar.sh directly', () => {
	assert.equal(CHECKOUT_URL, 'https://formchime.com/api/checkout?product=streakwise-pro');
	assert.ok(!/polar\.sh/.test(CHECKOUT_URL));
});

test('region blocked -> hide Buy Pro', async () => {
	const urls: string[] = [];
	assert.equal(await checkRegion(async (u) => { urls.push(u); return { status: 200, json: { country: 'JP', blocked: true } }; }), 'blocked');
	assert.deepEqual(urls, [REGION_URL]);
	assert.equal(await shouldShowBuyButton(async () => ({ status: 200, json: { blocked: true } })), false);
});

test('region allowed -> show', async () => {
	assert.equal(await checkRegion(async () => ({ status: 200, json: { country: 'TW', blocked: false } })), 'allowed');
	assert.equal(await shouldShowBuyButton(async () => ({ status: 200, json: { blocked: false } })), true);
});

test('fail closed: network failure, error status, bad JSON, unexpected shape -> error (hidden)', async () => {
	const cases: Array<() => Promise<{ status: number; json: unknown }>> = [
		async () => { throw new Error('offline'); },
		async () => ({ status: 500, json: null }),
		async () => ({ status: 403, json: { blocked: false } }),
		async () => ({ status: 200, json: null }),
		async () => ({ status: 200, json: '<html>' }),
		async () => ({ status: 200, json: [] }),
		async () => ({ status: 200, json: {} }),
		async () => ({ status: 200, json: { blocked: 'true' } }),
		async () => ({ status: 200, json: { blocked: 0 } }),
	];
	for (const get of cases) {
		assert.equal(await checkRegion(get), 'error');
		assert.equal(await shouldShowBuyButton(get), false);
	}
});

test('fail closed: a request that never answers times out -> error', async () => {
	let waited = -1;
	const r = await checkRegion(() => new Promise(() => {}), undefined, async (ms) => { waited = ms; });
	assert.equal(r, 'error');
	assert.equal(waited, REGION_TIMEOUT_MS);
	assert.equal(REGION_TIMEOUT_MS, 10_000);
});

test('a fast answer wins over the timeout', async () => {
	const r = await checkRegion(async () => ({ status: 200, json: { blocked: false } }), 10_000, () => new Promise(() => {}));
	assert.equal(r, 'allowed');
});
