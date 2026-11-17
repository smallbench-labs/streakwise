import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNode, focused, resetFocus } from './mocks/fakeDom';
import { ConsentState, openCheckoutIfConsented, PRIVACY_URL, TERMS_URL, CONSENT_HINT } from '../src/license/consent';
import { buildConsentBlock } from '../src/license/consentUi';

function build() {
	const parent = new FakeNode();
	const consent = new ConsentState();
	const bought: number[] = [];
	const opened: string[] = [];
	const ui = buildConsentBlock(parent as unknown as HTMLElement, consent, () => { bought.push(1); return true; }, (u) => opened.push(u)) as unknown as Record<string, FakeNode> & { links: FakeNode[] };
	return { parent, consent, bought, opened, ui };
}

test('consent: unchecked by default; order checkbox row, button, hint; copy', () => {
	const { ui } = build();
	assert.equal(ui.box.checked, false);
	assert.deepEqual(ui.block.children.map((c) => c.tag), ['label', 'button', 'div']);
	assert.equal(ui.label.find((c) => c.hasClass('sw-consent-text'))?.textContent,
		'I agree to the Terms of Service (opens in new window) and Privacy Policy (opens in new window).');
	assert.equal(ui.hint.textContent, CONSENT_HINT);
	assert.equal(ui.button.textContent, 'Buy Pro – US$12');
});

test('spec 4: unchecked -> aria-disabled="true" (no disabled attr), described by the hint; checked removes hint', () => {
	const { ui } = build();
	assert.equal(ui.button.getAttribute('aria-disabled'), 'true');
	assert.equal(ui.button.hasAttribute('disabled'), false);
	assert.equal(ui.button.getAttribute('aria-describedby'), ui.hint.getAttribute('id'));
	ui.box.click();
	assert.equal(ui.box.checked, true);
	assert.equal(ui.button.hasAttribute('aria-disabled'), false);
	assert.equal(ui.button.hasAttribute('aria-describedby'), false);
	assert.equal(ui.hint.parentElement, null, 'hint removed when checked');
	ui.box.click();
	assert.equal(ui.button.getAttribute('aria-disabled'), 'true');
	assert.equal(ui.hint.parentElement, ui.block, 'hint back when unchecked');
});

test('spec 5: clicking Buy while unchecked: no checkout, focus to checkbox, hint stays error colour until checked', () => {
	resetFocus();
	const { ui, bought } = build();
	ui.button.click();
	assert.equal(bought.length, 0);
	assert.equal(focused, ui.box);
	assert.ok(ui.hint.hasClass('sw-consent-hint-error'));
	ui.button.click();
	assert.ok(ui.hint.hasClass('sw-consent-hint-error'), 'still red, no timeout');
	ui.box.click(); // check
	assert.ok(!ui.hint.hasClass('sw-consent-hint-error'));
	assert.equal(ui.hint.parentElement, null);
	ui.box.click(); // uncheck again: hint back in muted colour
	assert.equal(ui.hint.parentElement, ui.block);
	assert.ok(!ui.hint.hasClass('sw-consent-hint-error'));
});

test('checked: clicking Buy opens checkout once', () => {
	const { ui, bought } = build();
	ui.box.click();
	ui.button.click();
	assert.equal(bought.length, 1);
});

test('spec 2: clicking a link opens it in a new window and does NOT toggle the checkbox', () => {
	const { ui, opened } = build();
	const [terms, privacy] = ui.links;
	terms.click();
	privacy.click();
	assert.deepEqual(opened, [TERMS_URL, PRIVACY_URL]);
	assert.equal(ui.box.checked, false);
	for (const a of ui.links) {
		assert.equal(a.getAttribute('target'), '_blank');
		assert.equal(a.getAttribute('rel'), 'noopener');
		assert.ok(!a.textContent.includes('↗'), 'no arrow icon');
		assert.ok(a.find((c) => c.hasClass('sw-sr-only') && c.text === ' (opens in new window)'));
	}
	assert.equal(TERMS_URL, 'https://formchime.com/streakwise/terms');
	assert.equal(PRIVACY_URL, 'https://formchime.com/streakwise/privacy');
});

test('spec 2: clicking the label text toggles the checkbox (whole row is the hit area)', () => {
	const { ui } = build();
	ui.label.find((c) => c.hasClass('sw-consent-text'))!.click();
	assert.equal(ui.box.checked, true);
});

test('handler refuses without consent', () => {
	const c = new ConsentState();
	const opened: string[] = [];
	assert.equal(openCheckoutIfConsented(c, 'u', (u) => opened.push(u)), false);
	c.set(true);
	assert.equal(openCheckoutIfConsented(c, 'u', (u) => opened.push(u)), true);
	assert.deepEqual(opened, ['u']);
});

test('styles: label row does not wrap the checkbox away; light-theme link uses the darker accent', async () => {
	const { readFileSync } = await import('node:fs');
	const css = readFileSync('styles.css', 'utf8');
	const row = /\.sw-consent \{([^}]*)\}/.exec(css)?.[1] ?? '';
	assert.ok(!/flex-wrap/.test(row));
	assert.match(row, /align-items: flex-start/);
	assert.match(css, /\.theme-light \.sw-consent-link \{ color: color-mix\(in srgb, var\(--text-accent\) 65%, black\); \}/);
	assert.match(css, /\.sw-consent-hint\.sw-consent-hint-error \{ color: var\(--text-error\); \}/);
	assert.match(css, /\.theme-light \.sw-consent-hint\.sw-consent-hint-error \{ color: color-mix\(in srgb, var\(--text-error\) 80%, black\); \}/);
	assert.match(css, /\.theme-dark \.sw-consent-hint\.sw-consent-hint-error \{ color: color-mix\(in srgb, var\(--text-error\) 85%, white\); \}/);
});
