// S-25: data.json values are validated on load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, PlainSettings } from '../src/core/settingsSanitize';

const D: PlainSettings = { sourceMode: 'auto', customFolder: '', customFormat: 'YYYY-MM-DD', defaultHabit: '', weekStart: 1, palette: 'accent', exportFolder: 'Streakwise exports' };

test('S-25: weekStart "1"/"0" coerced, invalid falls back', () => {
	assert.equal(sanitizeSettings({ weekStart: '1' }, D).weekStart, 1);
	assert.equal(sanitizeSettings({ weekStart: '0' }, D).weekStart, 0);
	assert.equal(sanitizeSettings({ weekStart: 0 }, D).weekStart, 0);
	for (const bad of [2, -1, 'monday', '', null, true, 1.5]) assert.equal(sanitizeSettings({ weekStart: bad }, D).weekStart, 1, String(bad));
});

test('S-25: palette and sourceMode enums', () => {
	assert.equal(sanitizeSettings({ palette: 'Blue ' }, D).palette, 'blue');
	assert.equal(sanitizeSettings({ palette: 'pink' }, D).palette, 'accent');
	assert.equal(sanitizeSettings({ palette: 3 }, D).palette, 'accent');
	assert.equal(sanitizeSettings({ sourceMode: 'Custom' }, D).sourceMode, 'custom');
	assert.equal(sanitizeSettings({ sourceMode: 'x' }, D).sourceMode, 'auto');
});

test('S-25: strings: wrong types and empty format fall back', () => {
	const s = sanitizeSettings({ customFolder: 5, customFormat: '  ', defaultHabit: ' run ', exportFolder: '' }, D);
	assert.deepEqual([s.customFolder, s.customFormat, s.defaultHabit, s.exportFolder], ['', 'YYYY-MM-DD', 'run', 'Streakwise exports']);
	assert.deepEqual(sanitizeSettings({}, D), D);
});
