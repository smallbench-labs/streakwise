import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LicenseManager, DEFAULT_LICENSE_CONFIG } from '../src/license/licenseManager';
import { EMPTY_LICENSE, HttpPost, LicenseCache, LicenseConfig } from '../src/license/types';

const DAY = 86_400_000;
const ORG = '11111111-2222-4333-8444-555555555555';
const T0 = Date.parse('2026-10-21T00:00:00Z');

/** Fake HTTP: queue of responses (or 'throw'), records every call. */
function fakeHttp(responses: Array<{ status: number; json: unknown } | 'throw'>) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	const http: HttpPost = async (url, body) => {
		calls.push({ url, body });
		const r = responses.shift();
		if (!r) throw new Error('unexpected request');
		if (r === 'throw') throw new Error('network down');
		return r;
	};
	return { http, calls };
}

function setup(responses: Parameters<typeof fakeHttp>[0], opts: Partial<LicenseConfig> = {}, cache: LicenseCache = { ...EMPTY_LICENSE }) {
	let now = T0;
	const { http, calls } = fakeHttp(responses);
	const saved: LicenseCache[] = [];
	const mgr = new LicenseManager(cache, { ...DEFAULT_LICENSE_CONFIG, organizationId: ORG, useActivations: false, ...opts }, http, () => now, async (c) => { saved.push(c); });
	return { mgr, calls, saved, advance: (ms: number) => { now += ms; } };
}

const granted = (extra: Record<string, unknown> = {}) => ({ status: 200, json: { status: 'granted', expires_at: null, ...extra } });

test('no key: isPro false and no network on refresh', async () => {
	const { mgr, calls } = setup([]);
	assert.equal(mgr.isPro(), false);
	await mgr.refreshIfDue();
	assert.equal(calls.length, 0);
});

test('placeholder org id: activate makes no request', async () => {
	const { mgr, calls } = setup([], { organizationId: 'REPLACE_WITH_POLAR_ORG_ID' });
	await mgr.activate('KEY', 'dev');
	assert.equal(calls.length, 0);
	assert.equal(mgr.isPro(), false);
});

test('valid key unlocks Pro and calls validate endpoint with key + org', async () => {
	const { mgr, calls, saved } = setup([granted()]);
	await mgr.activate('  KEY-1  ', 'dev');
	assert.equal(mgr.isPro(), true);
	assert.equal(calls[0].url, 'https://api.polar.sh/v1/customer-portal/license-keys/validate');
	assert.deepEqual(calls[0].body, { key: 'KEY-1', organization_id: ORG });
	assert.equal(saved.at(-1)?.status, 'valid');
});

test('404 marks invalid', async () => {
	const { mgr } = setup([{ status: 404, json: { error: 'ResourceNotFound' } }]);
	await mgr.activate('BAD', 'dev');
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.status, 'invalid');
});

test('offline grace: stays Pro for 7 days without network, locks after', async () => {
	const { mgr, advance } = setup([granted(), 'throw', 'throw']);
	await mgr.activate('KEY', 'dev');
	advance(3 * DAY);
	await mgr.refreshIfDue(); // network fails
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.graceDaysLeft(), 4);
	advance(4 * DAY + 1);
	await mgr.refreshIfDue(); // still failing
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.status, 'valid'); // not revoked, just stale; reconnecting fixes it
});

test('5xx is treated as offline, not as invalid', async () => {
	const { mgr, advance } = setup([granted(), { status: 503, json: null }]);
	await mgr.activate('KEY', 'dev');
	advance(2 * DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.state.status, 'valid');
	assert.equal(mgr.isPro(), true);
});

test('recheck throttled to once per interval', async () => {
	const { mgr, calls, advance } = setup([granted(), granted()]);
	await mgr.activate('KEY', 'dev');
	advance(DAY / 2);
	await mgr.refreshIfDue();
	assert.equal(calls.length, 1);
	advance(DAY / 2);
	await mgr.refreshIfDue();
	assert.equal(calls.length, 2);
});

test('successful revalidation resets grace window', async () => {
	const { mgr, advance } = setup([granted(), granted()]);
	await mgr.activate('KEY', 'dev');
	advance(6 * DAY);
	await mgr.refreshIfDue();
	advance(6 * DAY);
	assert.equal(mgr.isPro(), true);
});

test('revoked on later check locks immediately', async () => {
	const { mgr, advance } = setup([granted(), { status: 404, json: {} }]);
	await mgr.activate('KEY', 'dev');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), false);
});

test('license expires_at is honoured offline', async () => {
	const { mgr, advance } = setup([granted({ expires_at: new Date(T0 + 2 * DAY).toISOString() })]);
	await mgr.activate('KEY', 'dev');
	advance(2 * DAY);
	assert.equal(mgr.isPro(), false);
});

test('activations mode: activate then validate with activation_id', async () => {
	const { mgr, calls } = setup([{ status: 200, json: { id: 'act-1' } }, granted()], { useActivations: true });
	await mgr.activate('KEY', 'My laptop');
	assert.equal(calls[0].url.endsWith('/license-keys/activate'), true);
	assert.deepEqual(calls[0].body, { key: 'KEY', organization_id: ORG, label: 'My laptop' });
	assert.equal(calls[1].body.activation_id, 'act-1');
	assert.equal(mgr.isPro(), true);
});

test('activations mode: 403 limit reached is invalid', async () => {
	const { mgr } = setup([{ status: 403, json: { error: 'NotPermitted' } }], { useActivations: true });
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.state.status, 'invalid');
	assert.match(mgr.state.message, /activations for this key are in use/);
	assert.match(mgr.state.message, /portal/);
});

test('activate offline with no prior license stays free', async () => {
	const { mgr } = setup(['throw']);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
	assert.match(mgr.state.message, /Could not reach/);
});

test('changing key drops old cached validity', async () => {
	const { mgr } = setup([granted(), 'throw']);
	await mgr.activate('KEY-A', 'x');
	await mgr.activate('KEY-B', 'x');
	assert.equal(mgr.isPro(), false);
});

test('clear removes everything without network', async () => {
	const { mgr, calls } = setup([granted()]);
	await mgr.activate('KEY', 'x');
	await mgr.clear();
	assert.equal(calls.length, 1);
	assert.deepEqual(mgr.state, EMPTY_LICENSE);
});

// ---- Re-activation (Polar benefit: 5 activations per key, never expires) ----
const act = (id: string) => ({ status: 200, json: { id } });
const notFound = { status: 404, json: { error: 'ResourceNotFound' } };

test('default config uses activations', () => {
	assert.equal(DEFAULT_LICENSE_CONFIG.useActivations, true);
});

test('stale activation id: drop it, activate again, validate with new id', async () => {
	const { mgr, calls, advance } = setup([act('old'), granted(), notFound, act('new'), granted()], { useActivations: true });
	await mgr.activate('KEY', 'laptop');
	assert.equal(mgr.state.activationId, 'old');
	advance(DAY);
	await mgr.refreshIfDue(); // user freed this device in Polar -> validate 404
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.state.activationId, 'new');
	assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['activate', 'validate', 'validate', 'activate', 'validate']);
	assert.equal(calls[4].body.activation_id, 'new');
});

test('stale activation and all slots used: 403 with portal hint, Pro locked', async () => {
	const { mgr, advance } = setup([act('old'), granted(), notFound, { status: 403, json: { error: 'NotPermitted' } }], { useActivations: true });
	await mgr.activate('KEY', 'laptop');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.activationId, null);
	assert.match(mgr.state.message, /Polar customer portal/);
});

test('refunded/revoked key: re-activation 404 -> invalid, no loop', async () => {
	const { mgr, calls, advance } = setup([act('old'), granted(), notFound, notFound], { useActivations: true });
	await mgr.activate('KEY', 'laptop');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.state.status, 'invalid');
	assert.equal(calls.length, 4);
});

test('re-activated id still rejected: validate retried only once', async () => {
	const { mgr, calls, advance } = setup([act('old'), granted(), notFound, act('new'), notFound], { useActivations: true });
	await mgr.activate('KEY', 'laptop');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.state.status, 'invalid');
	assert.equal(calls.length, 5);
});

test('after limit error, pressing Activate again reserves a fresh slot', async () => {
	const { mgr } = setup([{ status: 403, json: {} }, act('a2'), granted()], { useActivations: true });
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.state.activationId, 'a2');
});

test('offline during re-activation keeps grace period', async () => {
	const { mgr, advance } = setup([act('old'), granted(), notFound, 'throw'], { useActivations: true });
	await mgr.activate('KEY', 'x');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), true);
});
