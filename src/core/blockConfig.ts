import { DayKey, ViewKind, WeekStart, isValidKey, toKey } from './dates';
import { CLASSIC_RULE, StreakRule, isClassicRule, parseFreezes, parseWeekdays, parseWeeklyGoal } from './rules';

/**
 * Configuration written inside a ```habit-heatmap code block, one "key: value" per line:
 *
 *   habits: run, read
 *   view: month          (year | ytd | quarter | month | week)
 *   date: 2026-10-01     (which month/quarter/week to show; default today)
 *   year: 2025           (shortcut for date: 2025-01-01)
 *   colors: blue         (accent | green | blue | purple | orange)
 *   max: 10              (value that gets the darkest colour)
 *   title: My habits
 *   weekstart: monday    (monday | sunday)
 *
 * Flexible streaks (Pro):
 *   goal: 3/week         (streak counted in weeks that reach the goal)
 *   days: weekdays       (weekdays | weekends | mon, wed, fri) or rest: sat, sun
 *   freezes: 2/month     (missed planned days forgiven per month)
 *   min: 30              (value a day needs to count)
 */

/** 'accent' follows the theme's accent colour (default); the others are fixed ramps. */
export const PALETTES = ['accent', 'green', 'blue', 'purple', 'orange'] as const;
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
	rule: StreakRule;
	errors: string[];
}

export function parseBlockConfig(source: string): BlockConfig {
	const cfg: BlockConfig = {
		habits: [], view: 'year', anchor: null, palette: null, max: undefined, title: '', weekStart: null, rule: { ...CLASSIC_RULE }, errors: [],
	};

	let rest: number[] | null = null;
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
			case 'goal': {
				const n = parseWeeklyGoal(value);
				if (n !== null) cfg.rule.goalPerWeek = n;
				else cfg.errors.push(`goal must look like "3/week" (1 to 7 times a week), got "${value}".`);
				break;
			}
			case 'days': {
				const d = parseWeekdays(value);
				if (d && d.length) cfg.rule.days = d.length === 7 ? null : d;
				else cfg.errors.push(`days must be weekdays, weekends or a list like "mon, wed, fri", got "${value}".`);
				break;
			}
			case 'rest': {
				const d = parseWeekdays(value);
				if (d && d.length < 7) rest = d;
				else cfg.errors.push(`rest must be a list of weekdays like "sat, sun", got "${value}".`);
				break;
			}
			case 'freezes':
			case 'freeze': {
				const n = parseFreezes(value);
				if (n !== null) cfg.rule.freezesPerMonth = n;
				else cfg.errors.push(`freezes must look like "2/month" (0 to 10), got "${value}".`);
				break;
			}
			case 'min': {
				const n = Number(value);
				if (Number.isFinite(n) && n > 0) cfg.rule.min = n;
				else cfg.errors.push(`min must be a positive number, got "${value}".`);
				break;
			}
			default:
				cfg.errors.push(`Unknown option "${key}".`);
		}
	}
	if (rest) {
		const base = cfg.rule.days ?? [0, 1, 2, 3, 4, 5, 6];
		const left = base.filter((d) => !rest?.includes(d));
		if (left.length) cfg.rule.days = left;
		else cfg.errors.push('rest leaves no planned days.');
	}
	if (cfg.rule.goalPerWeek !== null && (cfg.rule.days !== null || cfg.rule.freezesPerMonth > 0)) {
		cfg.errors.push('Use goal on its own: with a weekly goal, days, rest and freezes are not needed.');
		cfg.rule = { ...cfg.rule, days: null, freezesPerMonth: 0 };
	}
	return cfg;
}

/**
 * Which requested features need Pro. Free = yearly view of a single habit with a classic daily streak.
 * A flexible streak rule is not "locked" like a view: the free block still draws, with a preview of the rule
 * computed from the user's own notes (`lockedRule`).
 */
export function applyFreeLimits(cfg: BlockConfig, isPro: boolean): { config: BlockConfig; locked: string[]; lockedRule: StreakRule | null } {
	if (isPro) return { config: cfg, locked: [], lockedRule: null };
	const locked: string[] = [];
	const lockedRule = isClassicRule(cfg.rule) ? null : cfg.rule;
	const config = { ...cfg, habits: [...cfg.habits], rule: { ...CLASSIC_RULE } };
	if (cfg.view !== 'year') {
		locked.push(cfg.view === 'ytd' ? 'Year-to-date view' : `${cfg.view.charAt(0).toUpperCase()}${cfg.view.slice(1)} view`);
		config.view = 'year';
	}
	if (cfg.habits.length > 1) {
		locked.push('Multiple habits');
		config.habits = cfg.habits.slice(0, 1);
	}
	return { config, locked, lockedRule };
}
