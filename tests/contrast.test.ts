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

// --- Accent palette (default): fixed OKLCH lightness ladder in the theme accent's hue/chroma.
// Accent and background values measured in Obsidian 1.14.4 (getComputedStyle) for the default theme and Minimal;
// see obsidian-internal/contrast-r3.md for the in-app rendered table.
const THEMES = {
	'default light': { dark: false, bg: '#ffffff', accent: '#9873f7' },
	'default dark': { dark: true, bg: '#1c1c1c', accent: '#8a5cf5' },
	'Minimal light': { dark: false, bg: '#ffffff', accent: '#7c95a2' },
	'Minimal dark': { dark: true, bg: '#262626', accent: '#7992a0' },
	'grey accent (chroma 0) light': { dark: false, bg: '#ffffff', accent: '#7a7a7a' },
	'grey accent (chroma 0) dark': { dark: true, bg: '#1e1e1e', accent: '#7a7a7a' },
};
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => { const x = Math.min(1, Math.max(0, c)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
function hexToOklch(hex: string): [number, number, number] {
	const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
	return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)];
}
function oklchToHex(L: number, C: number, h: number): string {
	const A = C * Math.cos(h), B = C * Math.sin(h);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
	const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
	return '#' + rgb.map((c) => Math.round(fromLin(c) * 255).toString(16).padStart(2, '0')).join('');
}
const ladder = (sel: RegExp) => {
	const body = css.match(sel)?.[1] ?? '';
	return [...body.matchAll(/--sw-(\d): oklch\(from var\(--interactive-accent\) ([\d.]+) c h\)/g)].map((m) => Number(m[2]));
};
const LADDER = { light: ladder(/\n\.sw-palette-accent \{([^}]*)\}/), dark: ladder(/\.theme-dark \.sw-palette-accent \{([^}]*)\}/) };

test('accent palette: 4-step OKLCH lightness ladders for light and dark', () => {
	assert.equal(LADDER.light.length, 4);
	assert.equal(LADDER.dark.length, 4);
});
for (const [name, t] of Object.entries(THEMES)) {
	test(`accent, ${name}: each level >= 3:1 vs background, adjacent levels >= 1.35:1`, () => {
		const [, c, h] = hexToOklch(t.accent);
		const fills = (t.dark ? LADDER.dark : LADDER.light).map((L) => oklchToHex(L, c, h));
		let prev = 0;
		fills.forEach((f, i) => {
			const vsBg = contrast(f, t.bg);
			assert.ok(vsBg >= 3, `level ${i + 1} ${f} only ${vsBg.toFixed(2)}:1`);
			assert.ok(vsBg > prev, `level ${i + 1} not stronger`);
			if (i > 0) assert.ok(contrast(f, fills[i - 1] as string) >= 1.35, `levels ${i}/${i + 1} only ${contrast(f, fills[i - 1] as string).toFixed(2)}:1`);
			prev = vsBg;
		});
	});
}
