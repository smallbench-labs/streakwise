import { HabitHeatmap, HeatmapModel } from '../core/heatmapModel';
import { LEVELS } from '../core/scale';
import { parseKey } from '../core/dates';
import { Palette } from '../core/blockConfig';

const NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Attrs = Record<string, string | number>;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
	const node = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	parent?.appendChild(node);
	return node;
}
function text(parent: Element, x: number, y: number, content: string, cls: string, extra: Attrs = {}) {
	const t = el('text', { x, y, class: cls, ...extra }, parent);
	t.textContent = content;
	return t;
}

function describe(value: number | null, day: string, habit: string): string {
	return value === null ? `${day}: no entry (${habit})` : `${day}: ${value} (${habit})`;
}

export function statsLine(h: HabitHeatmap): string {
	const s = h.stats;
	return `${h.habit} · current streak ${s.currentStreak} · longest ${s.longestStreak} · ${s.doneDays}/${s.elapsedDays} days`;
}

/** Stats as HTML: streak part and days part are separate lines in narrow panes; number+unit never split. */
export function renderStats(parent: HTMLElement, h: HabitHeatmap) {
	const s = h.stats;
	const row = parent.createDiv({ cls: 'sw-stats', attr: { 'aria-label': statsLine(h) } });
	const streak = row.createSpan({ cls: 'sw-stats-streak' });
	streak.appendText(`${h.habit} · `);
	streak.createSpan({ cls: 'sw-nowrap', text: `current streak ${s.currentStreak}` });
	streak.appendText(' · ');
	streak.createSpan({ cls: 'sw-nowrap', text: `longest ${s.longestStreak}` });
	row.createSpan({ cls: 'sw-stats-sep', text: ' · ' });
	row.createSpan({ cls: 'sw-stats-days sw-nowrap', text: `${s.doneDays}/${s.elapsedDays} days` });
}

/** Calendar layout (rows = weeks) for month/week; GitHub-style layout (columns = weeks) otherwise. */
const isCalendar = (m: HeatmapModel) => m.view === 'month' || m.view === 'week';

/** Draws one habit's grid into `parent` at (x, y). Returns its size. */
function drawGrid(parent: Element, model: HeatmapModel, habit: HabitHeatmap, x: number, y: number): { width: number; height: number } {
	const calendar = isCalendar(model);
	const cell = calendar ? 30 : 10;
	const step = cell + (calendar ? 4 : 2);
	const left = calendar ? 0 : 28;
	const order = Array.from({ length: 7 }, (_, i) => (model.weekStart + i) % 7);
	const g = el('g', { transform: `translate(${x + left}, ${y})` }, parent);
	const weeks = habit.weeks;

	if (calendar) {
		order.forEach((d, i) => text(g, i * step + cell / 2, 10, WEEKDAYS[d] ?? '', 'sw-axis', { 'text-anchor': 'middle' }));
		weeks.forEach((week, row) => week.forEach((c, col) => {
			if (!c) return;
			const cx = col * step, cy = 16 + row * step;
			drawCell(g, c, cx, cy, cell, habit.habit);
			text(g, cx + cell / 2, cy + cell / 2 + 4, String(parseKey(c.day).day), `sw-daynum sw-on-l${c.level}`, { 'text-anchor': 'middle' });
		}));
		return { width: 7 * step, height: 16 + weeks.length * step };
	}

	weeks.forEach((week, col) => {
		const first = week.find((c) => c && parseKey(c.day).day === 1);
		const ref = first ?? (col === 0 ? week.find(Boolean) : undefined);
		if (ref) text(g, col * step, 10, MONTHS[parseKey(ref.day).month - 1] ?? '', 'sw-axis');
	});
	order.forEach((weekday, row) => {
		if (weekday === 1 || weekday === 3 || weekday === 5) {
			text(parent, x, y + 14 + row * step + cell, WEEKDAYS[weekday] ?? '', 'sw-axis');
		}
	});
	weeks.forEach((week, col) => week.forEach((c, row) => {
		if (c) drawCell(g, c, col * step, 14 + row * step, cell, habit.habit);
	}));
	return { width: left + weeks.length * step, height: 14 + 7 * step };
}

function drawCell(g: Element, c: { day: string; value: number | null; level: number; future: boolean }, x: number, y: number, size: number, habit: string) {
	const cls = ['sw-cell', `sw-l${c.level}`];
	if (c.value === null) cls.push('sw-nodata');
	if (c.future) cls.push('sw-future');
	// Inset by 0.5 so the 1px border of empty cells is not clipped.
	const r = el('rect', { x: x + 0.5, y: y + 0.5, width: size - 1, height: size - 1, rx: size > 15 ? 4 : 2, class: cls.join(' '), 'data-day': c.day }, g);
	el('title', {}, r).textContent = describe(c.value, c.day, habit);
}

function sized(svg: SVGSVGElement, width: number, height: number) {
	const w = Math.ceil(width), h = Math.ceil(height);
	svg.setAttribute('width', String(w));
	svg.setAttribute('height', String(h));
	svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
	return svg;
}

/**
 * On screen the SVG is sized in em of --font-ui-small (13px by default), so cells and labels
 * scale with Obsidian's font-size setting. Export keeps pixel sizes.
 */
function scaled(svg: SVGSVGElement): SVGSVGElement {
	const w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
	svg.removeAttribute('width');
	svg.removeAttribute('height');
	svg.setCssProps({ '--sw-w': `${(w / 13).toFixed(3)}em`, '--sw-h': `${(h / 13).toFixed(3)}em` });
	svg.addClass('sw-scaled');
	return svg;
}

/** On-screen grid for one habit. Title, stats and legend are HTML around it so they wrap (S-11). */
export function renderGridSvg(model: HeatmapModel, habit: HabitHeatmap, palette: Palette): SVGSVGElement {
	const svg = el('svg', { class: `sw-svg sw-palette-${palette}`, role: 'img', 'aria-label': statsLine(habit) });
	const size = drawGrid(svg, model, habit, 1, 1);
	return scaled(sized(svg, size.width + 2, size.height + 2));
}

/** The five legend swatches (no text; "Less"/"More" are HTML). */
export function renderLegendSwatches(palette: Palette): SVGSVGElement {
	const svg = el('svg', { class: `sw-svg sw-palette-${palette}`, 'aria-hidden': 'true' });
	// Same size and 2px gap as the grid cells.
	for (let l = 0; l <= LEVELS; l++) el('rect', { x: l * 12 + 0.5, y: 0.5, width: 9, height: 9, rx: 2, class: `sw-cell sw-l${l}` }, svg);
	return scaled(sized(svg, (LEVELS + 1) * 12, 10));
}

/**
 * Self-contained SVG for PNG export: title, stats, grids and legend.
 * Its width is a rough estimate; call fitToContent() once it is in the DOM.
 */
export function renderExportSvg(model: HeatmapModel, palette: Palette, title: string): SVGSVGElement {
	const svg = el('svg', { class: `sw-svg sw-palette-${palette}` });
	const pad = 8;
	let y = pad;
	if (title) { text(svg, pad, y + 14, title, 'sw-svg-title'); y += 24; }
	for (const habit of model.habits) {
		text(svg, pad, y + 12, statsLine(habit), 'sw-svg-stats');
		y += 22;
		y += drawGrid(svg, model, habit, pad, y).height + 8;
	}
	text(svg, pad, y + 10, 'Less', 'sw-axis');
	const swatches = el('g', { transform: `translate(${pad + 30}, ${y})` }, svg);
	for (let l = 0; l <= LEVELS; l++) el('rect', { x: l * 14 + 0.5, y: 0.5, width: 11, height: 11, rx: 2, class: `sw-cell sw-l${l}` }, swatches);
	text(svg, pad + 30 + (LEVELS + 1) * 14 + 4, y + 10, 'More', 'sw-axis');
	return sized(svg, 400, y + 20);
}

/** Resize an SVG that is attached to the document to its real drawn content (no clipped text). */
export function fitToContent(svg: SVGSVGElement, pad = 8) {
	const box = svg.getBBox();
	sized(svg, box.x + box.width + pad, box.y + box.height + pad);
}
