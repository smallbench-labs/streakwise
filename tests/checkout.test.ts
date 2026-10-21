import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKOUT_URL, REGION_URL, shouldShowBuyButton } from '../src/license/checkout';

test('checkout link uses the shared gate, never polar.sh directly', () => {
	assert.equal(CHECKOUT_URL, 'https://formchime.com/api/checkout?product=streakwise-pro');
	assert.ok(!/polar\.sh/.test(CHECKOUT_URL));
});

test('region blocked -> hide Buy Pro', async () => {
	const urls: string[] = [];
	assert.equal(await shouldShowBuyButton(async (u) => { urls.push(u); return { status: 200, json: { country: 'JP', blocked: true } }; }), false);
	assert.deepEqual(urls, [REGION_URL]);
});

test('region not blocked -> show', async () => {
	assert.equal(await shouldShowBuyButton(async () => ({ status: 200, json: { country: 'TW', blocked: false } })), true);
});

test('network failure / error status / bad JSON -> still show (fail open)', async () => {
	assert.equal(await shouldShowBuyButton(async () => { throw new Error('offline'); }), true);
	assert.equal(await shouldShowBuyButton(async () => ({ status: 500, json: null })), true);
	assert.equal(await shouldShowBuyButton(async () => ({ status: 200, json: null })), true);
});
