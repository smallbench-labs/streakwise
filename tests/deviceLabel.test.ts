import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceLabel, platformName } from '../src/license/deviceLabel';

test('S-39: label has app, platform and vault name', () => {
	assert.equal(buildDeviceLabel({ isMacOS: true }, 'MyVault'), 'Obsidian – macOS – MyVault');
	assert.equal(buildDeviceLabel({ isWin: true }, 'Notes'), 'Obsidian – Windows – Notes');
	assert.equal(buildDeviceLabel({ isLinux: true }, ''), 'Obsidian – Linux');
	assert.equal(buildDeviceLabel({ isIosApp: true, isMacOS: true }, 'V'), 'Obsidian – iOS – V');
	assert.equal(platformName({ isAndroidApp: true }), 'Android');
	assert.equal(platformName({}), 'Unknown platform');
});

test('S-39: label is clean and at most 100 characters', () => {
	const l = buildDeviceLabel({ isLinux: true }, 'a\nb\t' + 'x'.repeat(200));
	assert.ok(l.length <= 100);
	assert.ok(!/[\n\t]/.test(l));
});

test('S-39: label uses only the inputs given (no user name, email or host name)', () => {
	const l = buildDeviceLabel({ isMacOS: true }, 'Vault');
	assert.equal(l.split(' – ').length, 3);
});
