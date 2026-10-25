// S-34: Buy Pro visibility on the 1.13+ declarative path and the legacy display() path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Setting, setDeclarative, mockEnv } from 'obsidian';
import { StreakwiseSettingTab } from '../src/settings';
import { EMPTY_LICENSE } from '../src/license/types';
import type { HttpGetJson } from '../src/license/checkout';

interface Def { name?: string; desc?: string; render?: (s: unknown) => void; visible?: () => boolean; type?: string; items?: Def[] }

function makeTab(get: HttpGetJson, isPro = false) {
	const plugin = {
		settings: { sourceMode: 'custom', customFolder: 'Daily', customFormat: 'YYYY-MM-DD', defaultHabit: '', weekStart: 1, palette: 'accent', exportFolder: 'x', license: { ...EMPTY_LICENSE } },
		license: { isConfigured: () => true, isPro: () => isPro, graceDaysLeft: () => 0, state: { ...EMPTY_LICENSE } },
		keyStore: { kind: 'keychain' },
		deviceCode: 'a1b2',
		deviceLabel: 'Obsidian – Linux – a1b2',
		saveSettings: async () => {},
		refreshAfterSettings: () => {},
	};
	const app = { internalPlugins: { getPluginById: () => null }, plugins: { getPlugin: () => null }, vault: { getConfig: () => null } };
	const tab = new StreakwiseSettingTab(app as never, plugin as never);
	tab.regionGet = get;
	return tab;
}

function deferred() {
	let resolve!: (v: { status: number; json: unknown }) => void;
	let reject!: (e: Error) => void;
	const p = new Promise<{ status: number; json: unknown }>((res, rej) => { resolve = res; reject = rej; });
	let calls = 0;
	const get: HttpGetJson = () => { calls++; return p; };
	return { get, resolve, reject, calls: () => calls };
}

// Legacy display() draws every row, including the colour swatches (DOM). A permissive stub is enough.
function anyStub(): unknown {
	const f = function () { return anyStub(); };
	return new Proxy(f, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : anyStub()), apply: () => anyStub(), set: () => true });
}
(globalThis as { document?: unknown }).document ??= anyStub();

const tick = () => new Promise((r) => setTimeout(r, 0));

function proDefs(tab: StreakwiseSettingTab): Def[] {
	const groups = tab.getSettingDefinitions() as unknown as Def[];
	const pro = groups.find((g) => g.type === 'group' && g.items?.some((i) => i.name === 'Status'));
	assert.ok(pro);
	return pro.items ?? [];
}

/** Simulates Obsidian 1.13 drawing the tab: render every row, evaluate `visible`. */
function drawDeclarative(tab: StreakwiseSettingTab) {
	const items = proDefs(tab);
	for (const d of items) d.render?.(new Setting());
	return {
		buy: items.find((d) => d.name === 'Get Streakwise Pro' && !!d.render && !d.desc?.startsWith('Couldn')),
		note: items.find((d) => d.desc?.startsWith('Couldn')),
	};
}

for (const [label, settle, expected] of [
	['blocked -> hidden', (d: ReturnType<typeof deferred>) => d.resolve({ status: 200, json: { blocked: true } }), false],
	['not blocked -> shown', (d: ReturnType<typeof deferred>) => d.resolve({ status: 200, json: { blocked: false } }), true],
	['request fails -> hidden (fail closed)', (d: ReturnType<typeof deferred>) => d.reject(new Error('offline')), false],
	['error status -> hidden (fail closed)', (d: ReturnType<typeof deferred>) => d.resolve({ status: 500, json: null }), false],
	['bad JSON -> hidden (fail closed)', (d: ReturnType<typeof deferred>) => d.resolve({ status: 200, json: '<html>' }), false],
] as const) {
	test(`S-34 1.13+: ${label}; hidden while unknown; DOM state refreshed after the check`, async () => {
		setDeclarative(true);
		const d = deferred();
		const tab = makeTab(d.get);
		const { buy, note } = drawDeclarative(tab);
		assert.ok(buy?.visible, 'Buy row uses the declarative visible predicate');
		assert.equal(buy.visible(), false, 'hidden until region is known');
		assert.equal(note?.visible?.(), false, 'note hidden until region is known');
		const before = mockEnv.domRefreshes;
		settle(d);
		await tick();
		assert.equal(buy.visible(), expected);
		assert.equal(note?.visible?.(), label.includes('fail closed'), 'region note only when the check failed');
		assert.equal(mockEnv.domRefreshes, before + 1, 'refreshDomState() called once after the check');
		// A re-fetch of definitions (update()) keeps the known state without a new request.
		const again = proDefs(tab).find((x) => x.name === 'Get Streakwise Pro');
		assert.equal(again?.visible?.(), expected);
		assert.equal(d.calls(), 1);
	});
}

test('S-34 1.13+: getSettingDefinitions alone (search indexing) makes no region request', () => {
	setDeclarative(true);
	const d = deferred();
	const tab = makeTab(d.get);
	tab.getSettingDefinitions();
	tab.getSettingDefinitions();
	assert.equal(d.calls(), 0);
});

test('S-34 1.13+: Pro users get no Buy row and no region request', () => {
	setDeclarative(true);
	const d = deferred();
	const tab = makeTab(d.get, true);
	const { buy } = drawDeclarative(tab);
	assert.equal(buy, undefined);
	assert.equal(d.calls(), 0);
});

test('S-34 1.13+: closing the tab re-checks the region next time', async () => {
	setDeclarative(true);
	let calls = 0;
	const tab = makeTab(async () => { calls++; return { status: 200, json: { blocked: true } }; });
	drawDeclarative(tab);
	await tick();
	tab.hide();
	const { buy } = drawDeclarative(tab);
	assert.equal(buy?.visible?.(), false);
	await tick();
	assert.equal(calls, 2);
});

for (const [label, json, expected] of [['blocked', { blocked: true }, true], ['allowed', { blocked: false }, false]] as const) {
	test(`S-34 legacy display(): ${label} -> Buy row hidden=${expected}`, async () => {
		setDeclarative(false);
		try {
			const d = deferred();
			const tab = makeTab(d.get);
			Setting.created.length = 0;
			tab.display();
			const buy = Setting.created.find((s) => s.name === 'Get Streakwise Pro');
			assert.ok(buy);
			assert.equal(buy.settingEl.hidden, true, 'hidden until known');
			d.resolve({ status: 200, json });
			await tick();
			assert.equal(buy.settingEl.hidden, expected);
		} finally {
			setDeclarative(true);
		}
	});
}

test('legacy display(): request failure hides the button and shows the region note', async () => {
	setDeclarative(false);
	try {
		const d = deferred();
		const tab = makeTab(d.get);
		Setting.created.length = 0;
		tab.display();
		const [buy, note] = Setting.created.filter((s) => s.name === 'Get Streakwise Pro');
		assert.equal(note?.settingEl.hidden, true, 'note hidden until known');
		d.reject(new Error('offline'));
		await tick();
		assert.equal(buy?.settingEl.hidden, true);
		assert.equal(note?.settingEl.hidden, false);
	} finally {
		setDeclarative(true);
	}
});

test('SEC-2: without Keychain (Obsidian < 1.11.4) the license row warns about plain text in data.json', () => {
	const tab = makeTab(async () => ({ status: 200, json: { blocked: false } }));
	(tab as unknown as { plugin: { keyStore: { kind: string } } }).plugin.keyStore.kind = 'data.json';
	const sec = (tab as unknown as { licenseSection(): { rows: { name: string; desc?: string }[] } }).licenseSection();
	const row = sec.rows.find((r) => r.name === 'License key');
	assert.ok(row?.desc?.includes('plain text'));
	assert.ok(row?.desc?.includes('1.11.4'));
});

test('SEC-2: with Keychain no plain-text warning is shown', () => {
	const tab = makeTab(async () => ({ status: 200, json: { blocked: false } }));
	const sec = (tab as unknown as { licenseSection(): { rows: { name: string; desc?: string }[] } }).licenseSection();
	const row = sec.rows.find((r) => r.name === 'License key');
	assert.ok(row?.desc?.includes('Keychain'));
	assert.ok(!row?.desc?.includes('plain text'));
});

test('S-39: settings tab shows this device code', () => {
	const tab = makeTab(async () => ({ status: 200, json: { blocked: false } }));
	const sec = (tab as unknown as { licenseSection(): { rows: { name: string; desc?: string }[] } }).licenseSection();
	const row = sec.rows.find((r) => r.name === 'This device');
	assert.ok(row?.desc?.includes('"Obsidian – Linux – a1b2"'));
	assert.ok(!row?.desc?.includes('…'));
});

test('m-01: with a stored key that is not Pro, License key (Activate) comes before Buy Pro', () => {
	const tab = makeTab(async () => ({ status: 200, json: { blocked: false } }));
	(tab as unknown as { plugin: { license: { state: Record<string, unknown> } } }).plugin.license.state = { ...EMPTY_LICENSE, key: 'K', status: 'invalid', message: 'This device was released in the Polar customer portal. Press Activate to use Pro here again.' };
	const sec = (tab as unknown as { licenseSection(): { rows: { name: string }[] } }).licenseSection();
	const names = sec.rows.map((r) => r.name);
	assert.ok(names.indexOf('License key') < names.indexOf('Get Streakwise Pro'));
});

test('m-01: without a key, Buy Pro stays above License key', () => {
	const tab = makeTab(async () => ({ status: 200, json: { blocked: false } }));
	const sec = (tab as unknown as { licenseSection(): { rows: { name: string }[] } }).licenseSection();
	const names = sec.rows.map((r) => r.name);
	assert.ok(names.indexOf('Get Streakwise Pro') < names.indexOf('License key'));
});
