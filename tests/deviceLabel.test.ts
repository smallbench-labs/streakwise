import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceLabel, platformName, getDeviceCode, randomDeviceCode, DEVICE_CODE_KEY, LocalStore } from '../src/license/deviceLabel';

function memStore(init: Record<string, unknown> = {}): LocalStore & { data: Record<string, unknown> } {
	const data = { ...init };
	return { data, load: (k) => data[k] ?? null, save: (k, v) => { data[k] = v; } };
}

test('S-39: label is app, platform and device code (no vault name)', () => {
	assert.equal(buildDeviceLabel({ isMacOS: true }, 'a1b2'), 'Obsidian – macOS – a1b2');
	assert.equal(buildDeviceLabel({ isWin: true }, 'zz09'), 'Obsidian – Windows – zz09');
	assert.equal(buildDeviceLabel({ isIosApp: true, isMacOS: true }, 'k3m4'), 'Obsidian – iOS – k3m4');
	assert.equal(platformName({ isAndroidApp: true }), 'Android');
	assert.equal(platformName({ isLinux: true }), 'Linux');
	assert.equal(platformName({}), 'Unknown platform');
});

test('S-39: random code is 4 lowercase alphanumerics', () => {
	for (let i = 0; i < 200; i++) assert.match(randomDeviceCode(), /^[0-9a-z]{4}$/);
	assert.equal(randomDeviceCode(() => 0), '0000');
	assert.equal(randomDeviceCode(() => 0.9999999), 'zzzz');
});

test('S-39: code is generated once and persisted', () => {
	const s = memStore();
	const a = getDeviceCode(s);
	assert.equal(s.data[DEVICE_CODE_KEY], a);
	assert.equal(getDeviceCode(s), a);
	assert.equal(getDeviceCode(s, () => 0.5), a);
});

test('S-39: invalid stored value is replaced', () => {
	const s = memStore({ [DEVICE_CODE_KEY]: 'My Vault' });
	const c = getDeviceCode(s, () => 0);
	assert.equal(c, '0000');
	assert.equal(s.data[DEVICE_CODE_KEY], '0000');
});
