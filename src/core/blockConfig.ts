import { DayKey, ViewKind, WeekStart, isValidKey, toKey } from './dates';

/**
 * Configuration written inside a ```habit-heatmap code block, one "key: value" per line:
 *
 *   habits: run, read
 *   view: month          (year | ytd | quarter | month | week)
 *   date: 2026-10-01     (which month/quarter/week to show; default today)
 *   year: 2025           (shortcut for date: 2025-01-01)
 *   colors: blue         (green | blue | purple | orange)
 *   max: 10              (value that gets the darkest colour)
 *   title: My habits
 *   weekstart: monday    (monday | sunday)
 */

export const PALETTES = ['green', 'blue', 'purple', 'orange'] as const;
export type Palette = (typeof PALETTES)[number];
const VIEWS: ViewKind[] = ['year', 'ytd', 'quarter', 'month', 'week'];

export interface BlockConfig {
	habits: string[];
	view: ViewKind;
	anchor: DayKey | null; // null = today
	palette: Palette | null; // null = plugin default
	max: number | undefined;
	title: string;
	weekStart: WeekStart | null; // null = plugin default
	errors: string[];
}

export function parseBlockConfig(source: string): BlockConfig {
	const cfg: BlockConfig = {
		habits: [], view: 'year', anchor: null, palette: null, max: undefined, title: '', weekStart: null, errors: [],
	};

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const colon = line.indexOf(':');
		if (colon < 0) { cfg.errors.push(`Ignored line without "key: value": ${line}`); continue; }
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();

		switch (key) {
			case 'habit':
			case 'habits':
				cfg.habits.push(...value.split(',').map((h) => h.trim()).filter(Boolean));
				break;
			case 'view': {
				const v = value.toLowerCase() as ViewKind;
				if (VIEWS.includes(v)) cfg.view = v;
				else cfg.errors.push(`Unknown view "${value}". Use: ${VIEWS.join(', ')}.`);
				break;
			}
			case 'date':
				if (isValidKey(value)) cfg.anchor = value;
				else cfg.errors.push(`Invalid date "${value}". Use YYYY-MM-DD.`);
				break;
			case 'year':
				if (/^\d{4}$/.test(value)) cfg.anchor = toKey(+value, 1, 1);
				else cfg.errors.push(`Invalid year "${value}".`);
				break;
			case 'colors':
			case 'color': {
				const p = value.toLowerCase() as Palette;
				if (PALETTES.includes(p)) cfg.palette = p;
				else cfg.errors.push(`Unknown colors "${value}". Use: ${PALETTES.join(', ')}.`);
				break;
			}
			case 'max': {
				const n = Number(value);
				if (Number.isFinite(n) && n > 0) cfg.max = n;
				else cfg.errors.push(`max must be a positive number, got "${value}".`);
				break;
			}
			case 'title':
				cfg.title = value;
				break;
			case 'weekstart': {
				const w = value.toLowerCase();
				if (w === 'monday') cfg.weekStart = 1;
				else if (w === 'sunday') cfg.weekStart = 0;
				else cfg.errors.push(`weekstart must be monday or sunday.`);
				break;
			}
			default:
				cfg.errors.push(`Unknown option "${key}".`);
		}
	}
	return cfg;
}

/** Which requested features need Pro. Free = yearly view of a single habit. */
export function applyFreeLimits(cfg: BlockConfig, isPro: boolean): { config: BlockConfig; locked: string[] } {
	if (isPro) return { config: cfg, locked: [] };
	const locked: string[] = [];
	const config = { ...cfg, habits: [...cfg.habits] };
	if (cfg.view !== 'year') {
		locked.push(cfg.view === 'ytd' ? 'Year-to-date view' : `${cfg.view.charAt(0).toUpperCase()}${cfg.view.slice(1)} view`);
		config.view = 'year';
	}
	if (cfg.habits.length > 1) {
		locked.push('Multiple habits');
		config.habits = cfg.habits.slice(0, 1);
	}
	return { config, locked };
}
