// 2026-11-24: quiet, dismissible Pro line under free heatmaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNode } from './mocks/fakeDom';
import { PRO_HINT_TEXT, renderProHint, shouldShowProHint, ProHintState } from '../src/ui/proHint';
import { sanitizeSettings, PlainSettings } from '../src/core/settingsSanitize';
import { DEFAULT_SETTINGS } from '../src/settings';

const base: ProHintState = { isPro: false, proSoon: false, dismissed: false, proCardShown: false, hasErrors: false };

test('pro hint: shown only to configured free users with no Pro card, no errors, not dismissed', () => {
	assert.equal(shouldShowProHint(base), true);
	assert.equal(shouldShowProHint({ ...base, isPro: true }), false);
	assert.equal(shouldShowProHint({ ...base, proSoon: true }), false);
	assert.equal(shouldShowProHint({ ...base, dismissed: true }), false);
	assert.equal(shouldShowProHint({ ...base, proCardShown: true }), false);
	assert.equal(shouldShowProHint({ ...base, hasErrors: true }), false);
});

test('pro hint: exact text, a real button with a label, and a labelled close button', () => {
	const root = new FakeNode();
	let opened = 0; let dismissed = 0; const icons: string[] = [];
	const line = renderProHint(root, { open: () => { opened++; }, dismiss: () => { dismissed++; } }, (_el, n) => { icons.push(n); });
	assert.ok(line.hasClass('sw-pro-hint'));
	assert.equal(line.children.length, 2);
	const [link, close] = line.children as [FakeNode, FakeNode];
	assert.equal(link.tag, 'button');
	assert.equal(link.text, PRO_HINT_TEXT);
	assert.equal(PRO_HINT_TEXT, 'Pro: more views, multiple habits, PNG export');
	assert.equal(link.getAttribute('type'), 'button');
	assert.match(link.getAttribute('aria-label') ?? '', /Opens Streakwise settings/);
	assert.equal(close.tag, 'button');
	assert.equal(close.getAttribute('aria-label'), 'Hide this Pro hint');
	assert.deepEqual(icons, ['x']);
	link.click();
	assert.deepEqual([opened, dismissed], [1, 0]);
	close.click();
	assert.deepEqual([opened, dismissed], [1, 1]);
	// No inline styles anywhere in the line.
	const all = (n: FakeNode): FakeNode[] => [n, ...n.children.flatMap(all)];
	for (const n of all(line)) assert.equal(n.getAttribute('style'), null);
});

test('pro hint: dismissal is a stored setting, default off, validated on load', () => {
	assert.equal(DEFAULT_SETTINGS.proHintDismissed, false);
	const D: PlainSettings = { sourceMode: 'auto', customFolder: '', customFormat: 'YYYY-MM-DD', defaultHabit: '', weekStart: 1, palette: 'accent', exportFolder: 'Streakwise exports', proHintDismissed: false };
	assert.equal(sanitizeSettings({ proHintDismissed: true }, D).proHintDismissed, true);
	assert.equal(sanitizeSettings({ proHintDismissed: false }, D).proHintDismissed, false);
	for (const bad of ['true', 1, null, {}]) assert.equal(sanitizeSettings({ proHintDismissed: bad }, D).proHintDismissed, false, String(bad));
	assert.equal(sanitizeSettings({}, D).proHintDismissed, false);
});
