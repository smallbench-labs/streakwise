// S-12: colour contrast of heatmap palettes, read straight from styles.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Obsidian 1.14 default --interactive-accent (light / dark), measured with getComputedStyle.
const ACCENT_LIGHT = '#9873f7', ACCENT_DARK = '#8a5cf5';
const BG = { light: '#ffffff', dark: '#1e1e1e' }; // Obsidian default --background-primary

function luminance(hex: string): number {
	const n = hex.replace('#', '');
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const css = readFileSync('styles.css', 'utf8');
const rules = [...css.matchAll(/^(\.theme-dark )?\.sw-palette-(\w+) \{([^}]*)\}/gm)].map((m) => ({
	theme: m[1] ? 'dark' as const : 'light' as const,
	name: m[2] ?? '',
	vars: Object.fromEntries([...(m[3] ?? '').matchAll(/--(sw-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((v) => [v[1], v[2]])),
}));

const fixedRules = rules.filter((r) => r.name !== 'accent');
test('all 4 fixed palettes defined for light and dark', () => {
	assert.equal(fixedRules.length, 8);
});

for (const r of fixedRules) {
	test(`${r.theme} ${r.name}: filled levels >= 3:1 vs background, increasing, day numbers >= 4.5:1`, () => {
		let prev = 0;
		for (let l = 1; l <= 4; l++) {
			const fill = r.vars[`sw-${l}`] as string;
			const on = r.vars[`sw-on-${l}`] as string;
			const c = contrast(fill, BG[r.theme]);
			assert.ok(c >= 3, `level ${l} ${fill} only ${c.toFixed(2)}:1`);
			assert.ok(c > prev, `level ${l} not stronger than level ${l - 1}`);
			if (l > 1) assert.ok(contrast(fill, r.vars[`sw-${l - 1}`] as string) >= 1.25, `levels ${l - 1}/${l} too similar`);
			assert.ok(contrast(fill, on) >= 4.5, `day number on level ${l} only ${contrast(fill, on).toFixed(2)}:1`);
			prev = c;
		}
	});
}

test('empty cells have a visible border', () => {
	assert.match(css, /\.sw-cell\.sw-l0 \{[^}]*stroke: var\(--text-muted\)(?![^}]*stroke-opacity)/);
});

// --- Accent palette (default): color-mix of the theme accent with --text-normal, checked with Obsidian's
// default theme values (measured in Obsidian 1.14 under Xvfb; see obsidian-internal/uiux-r2-fixes.md).
const DEFAULT_THEME = {
	light: { bg: '#ffffff', accent: ACCENT_LIGHT, text: '#222222', onAccent: '#ffffff' },
	dark: { bg: '#1c1c1c', accent: ACCENT_DARK, text: '#dadada', onAccent: '#ffffff' },
};
const hex = (n: number[]) => '#' + n.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16));
/** CSS color-mix(in srgb, a p%, b). */
const mix = (a: string, p: number, b: string) => { const x = rgb(a), y = rgb(b); return hex(x.map((c, i) => c * p + (y[i] ?? 0) * (1 - p))); };
const accentRule = css.match(/\.sw-palette-accent \{([^}]*)\}/)?.[1] ?? '';
const pcts = [...accentRule.matchAll(/--sw-(\d): color-mix\(in srgb, var\(--interactive-accent\) (\d+)%, var\(--text-normal\)\)/g)].map((m) => Number(m[2]) / 100);

test('accent palette defined with color-mix for levels 2-4', () => {
	assert.match(accentRule, /--sw-1: var\(--interactive-accent\)/);
	assert.equal(pcts.length, 3);
});
for (const theme of ['light', 'dark'] as const) {
	test(`${theme} accent (default theme): filled levels >= 3:1, increasing, distinct`, () => {
		const t = DEFAULT_THEME[theme];
		const fills = [t.accent, ...pcts.map((p) => mix(t.accent, p, t.text))];
		let prev = 0;
		fills.forEach((f, i) => {
			const c = contrast(f, t.bg);
			assert.ok(c >= 3, `level ${i + 1} ${f} only ${c.toFixed(2)}:1`);
			assert.ok(c > prev, `level ${i + 1} not stronger`);
			if (i > 0) assert.ok(contrast(f, fills[i - 1] as string) >= 1.25, `levels ${i}/${i + 1} too similar`);
			prev = c;
		});
	});
}
