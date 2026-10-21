import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LicenseManager, DEFAULT_LICENSE_CONFIG, CLOCK_SKEW_TOLERANCE_MS } from '../src/license/licenseManager';
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

const BENEFIT = DEFAULT_LICENSE_CONFIG.benefitId;
const granted = (extra: Record<string, unknown> = {}) => ({ status: 200, json: { id: 'lk-1', status: 'granted', organization_id: ORG, benefit_id: BENEFIT, expires_at: null, ...extra } });

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
	const { mgr } = setup([{ status: 403, json: { error: 'NotPermitted' } }, act('a2'), granted()], { useActivations: true });
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

// --- Free-only v0.1.0: placeholder org id => zero network, Pro never unlocks ---
test('free-only build (placeholder org id): no fetch/requestUrl/http at all, Pro stays locked', async () => {
	const http = fakeHttp([granted(), granted()]);
	const origFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => { fetchCalls++; throw new Error('fetch must not be called'); }) as typeof fetch;
	try {
		// Stale "valid" cache from a hypothetical older build must not unlock Pro either.
		const cache: LicenseCache = { ...EMPTY_LICENSE, key: 'K', status: 'valid', lastValidatedAt: T0, lastCheckedAt: 0, activationId: 'a' };
		const mgr = new LicenseManager(cache, { ...DEFAULT_LICENSE_CONFIG, organizationId: 'REPLACE_WITH_POLAR_ORG_ID' }, http.http, () => T0 + 2 * DAY, async () => {});
		assert.equal(mgr.isConfigured(), false);
		assert.equal(mgr.isPro(), false);
		await mgr.refreshIfDue();
		await mgr.activate('SOME-KEY', 'Obsidian');
		await mgr.clear();
		assert.equal(mgr.isPro(), false);
		assert.equal(http.calls.length, 0);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = origFetch;
	}
});

test('v0.2 default config: real Polar org id, portal, 5-device activations', () => {
	assert.equal(DEFAULT_LICENSE_CONFIG.organizationId, '189678f8-c892-4af0-8586-0bf2a6873e02');
	assert.equal(DEFAULT_LICENSE_CONFIG.portalUrl, 'https://polar.sh/formchime/portal');
	assert.equal(DEFAULT_LICENSE_CONFIG.useActivations, true);
	const mgr = new LicenseManager({ ...EMPTY_LICENSE }, { ...DEFAULT_LICENSE_CONFIG }, async () => { throw new Error('no'); }, () => T0, async () => {});
	assert.equal(mgr.isConfigured(), true);
});

// ---- v0.2 Pro: strict Polar validate checks (mocked production-shaped responses) ----
test('v0.2 production product + benefit ids are wired', () => {
	assert.equal(DEFAULT_LICENSE_CONFIG.productId, '3e788897-c49f-4314-84f5-bffe07edec6f');
	assert.equal(DEFAULT_LICENSE_CONFIG.benefitId, '5ec5a70e-bb98-4923-b040-5c5679f9daa8');
	assert.equal(DEFAULT_LICENSE_CONFIG.apiBase, 'https://api.polar.sh');
});

test('strict: valid granted key with our org + benefit unlocks Pro', async () => {
	const { mgr } = setup([granted({ expires_at: new Date(T0 + 30 * DAY).toISOString() })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.state.status, 'valid');
});

test('strict: wrong benefit id is not Pro', async () => {
	const { mgr } = setup([granted({ benefit_id: '00000000-0000-4000-8000-000000000000' })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.status, 'invalid');
});

test('strict: missing benefit id is not Pro', async () => {
	const { mgr } = setup([granted({ benefit_id: undefined })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
});

for (const st of ['revoked', 'disabled']) {
	test(`strict: ${st} key (200 body) is not Pro, and locks a previously valid key`, async () => {
		const { mgr, advance } = setup([granted(), granted({ status: st })]);
		await mgr.activate('KEY', 'x');
		assert.equal(mgr.isPro(), true);
		advance(DAY);
		await mgr.refreshIfDue();
		assert.equal(mgr.isPro(), false);
		assert.equal(mgr.state.status, 'invalid');
	});
}

test('strict: already-expired key is not Pro even if granted', async () => {
	const { mgr } = setup([granted({ expires_at: new Date(T0 - DAY).toISOString() })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.status, 'invalid');
});

test('strict: wrong org id is not Pro', async () => {
	const { mgr } = setup([granted({ organization_id: '99999999-2222-4333-8444-555555555555' })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.isPro(), false);
	assert.equal(mgr.state.status, 'invalid');
});

test('strict: network failure after valid keeps 7-day grace, then locks', async () => {
	const { mgr, advance } = setup([granted(), 'throw', 'throw']);
	await mgr.activate('KEY', 'x');
	advance(2 * DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.state.status, 'valid');
	advance(5 * DAY + 1);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), false);
});

for (const [name, json] of [
	['null body', null],
	['string body', 'granted'],
	['array body', [{ status: 'granted' }]],
	['no status', { organization_id: ORG, benefit_id: BENEFIT }],
	['bad expires_at', { status: 'granted', organization_id: ORG, benefit_id: BENEFIT, expires_at: 'not-a-date' }],
	['numeric expires_at', { status: 'granted', organization_id: ORG, benefit_id: BENEFIT, expires_at: 12345 }],
] as Array<[string, unknown]>) {
	test(`strict: malformed response (${name}) is not Pro`, async () => {
		const { mgr } = setup([{ status: 200, json }]);
		await mgr.activate('KEY', 'x');
		assert.equal(mgr.isPro(), false);
		assert.equal(mgr.state.status, 'invalid');
	});
}

// ---- S-30: clock moved backwards ----
test('S-30: lastSeenAt is persisted', async () => {
	const { mgr, saved } = setup([granted()]);
	await mgr.activate('KEY', 'x');
	assert.equal(saved.at(-1)?.lastSeenAt, T0);
});

test('S-30: rewound clock forces revalidation (cache miss) even inside recheck interval', async () => {
	const { mgr, calls, advance } = setup([granted(), granted()]);
	await mgr.activate('KEY', 'x');
	advance(-365 * DAY);
	assert.equal(mgr.clockRewound(), true);
	await mgr.refreshIfDue();
	assert.equal(calls.length, 2);
	assert.equal(mgr.isPro(), true);
});

test('S-30: small skew within tolerance is not a rewind', async () => {
	const { mgr, calls, advance } = setup([granted()]);
	await mgr.activate('KEY', 'x');
	advance(-CLOCK_SKEW_TOLERANCE_MS + 1000);
	await mgr.refreshIfDue();
	assert.equal(calls.length, 1);
});

test('S-30: rewound + offline -> grace counts from lastSeen, not the rewound clock', async () => {
	const { mgr, advance } = setup([granted(), 'throw', 'throw', 'throw']);
	await mgr.activate('KEY', 'x');
	advance(6 * DAY);
	await mgr.refreshIfDue(); // offline, lastSeen = T0+6d
	assert.equal(mgr.isPro(), true);
	assert.equal(mgr.state.lastSeenAt, T0 + 6 * DAY);
	advance(-365 * DAY); // user rewinds a year
	await mgr.refreshIfDue(); // forced revalidation fails offline
	assert.equal(mgr.isPro(), true); // still within 7d of lastValidated measured at lastSeen
	assert.equal(mgr.graceDaysLeft(), 1);
	assert.equal(mgr.state.lastSeenAt, T0 + 6 * DAY);
	advance(365 * DAY + DAY + 1); // real time passes beyond grace
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), false);
});

test('S-30: rewinding below lastValidated cannot extend grace past 7d of seen time', async () => {
	const cache: LicenseCache = { ...EMPTY_LICENSE, key: 'K', status: 'valid', lastValidatedAt: T0, lastCheckedAt: T0 + 8 * DAY, lastSeenAt: T0 + 8 * DAY };
	const { mgr } = setup(['throw'], {}, cache); // now = T0, rewound 8 days
	assert.equal(mgr.isPro(), false);
	await mgr.refreshIfDue();
	assert.equal(mgr.isPro(), false);
});

// ---- S-31: only Polar verdicts mark a key invalid ----
for (const status of [401, 403]) {
	test(`S-31: validate ${status} from proxy/WAF is transient, keeps Pro under grace`, async () => {
		const { mgr, advance } = setup([granted(), { status, json: null }]);
		await mgr.activate('KEY', 'x');
		advance(DAY);
		await mgr.refreshIfDue();
		assert.equal(mgr.state.status, 'valid');
		assert.equal(mgr.isPro(), true);
		assert.match(mgr.state.message, /Could not reach/);
	});
	test(`S-31: activate ${status} without Polar body is transient, not invalid`, async () => {
		const { mgr } = setup([{ status, json: '<html>blocked</html>' }], { useActivations: true });
		await mgr.activate('KEY', 'x');
		assert.notEqual(mgr.state.status, 'invalid');
		assert.equal(mgr.isPro(), false);
	});
}

test('S-31: validate 422 marks invalid', async () => {
	const { mgr, advance } = setup([granted(), { status: 422, json: { detail: [] } }]);
	await mgr.activate('KEY', 'x');
	advance(DAY);
	await mgr.refreshIfDue();
	assert.equal(mgr.state.status, 'invalid');
	assert.equal(mgr.isPro(), false);
});

test('S-31: explicit revoked in 200 body still marks invalid', async () => {
	const { mgr } = setup([granted({ status: 'revoked' })]);
	await mgr.activate('KEY', 'x');
	assert.equal(mgr.state.status, 'invalid');
});

// ---- S-33: lastSeen recorded on load and periodically, forward-only ----
function setupMono(responses: Parameters<typeof fakeHttp>[0], cache: LicenseCache = { ...EMPTY_LICENSE }) {
	let now = T0;
	let mono = 0;
	const { http, calls } = fakeHttp(responses);
	const saved: LicenseCache[] = [];
	const mgr = new LicenseManager(cache, { ...DEFAULT_LICENSE_CONFIG, organizationId: ORG, useActivations: false }, http, () => now, async (c) => { saved.push(c); }, () => mono);
	return { mgr, calls, saved, setNow: (t: number) => { now = t; }, wall: (ms: number) => { now += ms; }, run: (ms: number) => { now += ms; mono += ms; } };
}

test('S-33: touch() advances lastSeen with time and never decreases it', async () => {
	const { mgr, run, wall } = setupMono([granted()]);
	await mgr.activate('KEY', 'x');
	await mgr.touch();
	run(3_600_000);
	await mgr.touch();
	assert.equal(mgr.state.lastSeenAt, T0 + 3_600_000);
	wall(-2 * DAY); // clock set back during the session
	await mgr.touch();
	assert.equal(mgr.state.lastSeenAt, T0 + 3_600_000);
	run(3_600_000); // an hour of real use while the clock is behind still counts
	await mgr.touch();
	assert.equal(mgr.state.lastSeenAt, T0 + 2 * 3_600_000);
});

test('S-33: touch() without a key does nothing', async () => {
	const { mgr, saved } = setupMono([]);
	await mgr.touch();
	assert.equal(saved.length, 0);
});

test('S-33: onLoad with clock behind lastSeen forces revalidation', async () => {
	const cache: LicenseCache = { ...EMPTY_LICENSE, key: 'K', status: 'valid', lastValidatedAt: T0 - DAY, lastCheckedAt: T0 - DAY, lastSeenAt: T0 + DAY };
	const { mgr, calls } = setupMono([granted()], cache); // now = T0, a day behind lastSeen
	await mgr.onLoad();
	assert.equal(calls.length, 1);
	assert.equal(mgr.isPro(), true);
});

test('S-33: onLoad within recheck interval and clock fine: no request, lastSeen recorded', async () => {
	const { mgr, calls, run } = setupMono([granted()]);
	await mgr.activate('KEY', 'x');
	run(2 * 3_600_000);
	await mgr.onLoad();
	assert.equal(calls.length, 1);
	assert.equal(mgr.state.lastSeenAt, T0 + 2 * 3_600_000);
});

test('S-33: QA scenario - rewinding to just after the last check each session no longer keeps Pro forever offline', async () => {
	const { mgr, setNow, run } = setupMono([granted(), ...Array.from({ length: 60 }, () => 'throw' as const)]);
	await mgr.activate('KEY', 'x'); // validated at T0
	let pro = 0;
	for (let i = 0; i < 60; i++) {
		setNow(T0 + 60_000); // user rewinds to 1 minute after the last check, stays offline
		await mgr.onLoad();
		if (mgr.isPro()) pro++;
		for (let h = 0; h < 4; h++) { run(3_600_000); await mgr.touch(); } // 4-hour session, hourly touch
	}
	assert.ok(pro < 60, `Pro in ${pro}/60 sessions`);
	assert.equal(mgr.isPro(), false); // 60 x 4h = 10 days of use > 7-day grace
});
