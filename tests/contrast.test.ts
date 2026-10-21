// S-12: colour contrast of heatmap palettes, read straight from styles.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('all 4 palettes defined for light and dark', () => {
	assert.equal(rules.length, 8);
});

for (const r of rules) {
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
