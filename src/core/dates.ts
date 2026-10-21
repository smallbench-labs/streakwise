/**
 * Calendar-date helpers working on "YYYY-MM-DD" strings.
 * All arithmetic is done in UTC milliseconds so daylight-saving changes can never skip or repeat a day.
 */

export type DayKey = string;
export type ViewKind = 'year' | 'ytd' | 'quarter' | 'month' | 'week';
export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

export interface DateRange {
	start: DayKey;
	end: DayKey; // inclusive
}

const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toKey(year: number, month: number, day: number): DayKey {
	return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isValidKey(key: string): boolean {
	const m = KEY_RE.exec(key);
	if (!m) return false;
	return utcToKey(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === key;
}

export function parseKey(key: DayKey): { year: number; month: number; day: number } {
	const m = KEY_RE.exec(key);
	if (!m) throw new Error(`Invalid date "${key}", expected YYYY-MM-DD`);
	return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function keyToUtc(key: DayKey): number {
	const { year, month, day } = parseKey(key);
	return Date.UTC(year, month - 1, day);
}

export function utcToKey(ms: number): DayKey {
	const d = new Date(ms);
	return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(key: DayKey, n: number): DayKey {
	return utcToKey(keyToUtc(key) + n * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(key: DayKey): number {
	return new Date(keyToUtc(key)).getUTCDay();
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: DayKey, b: DayKey): number {
	return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
}

function lastDayOfMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First day of the week containing `key`. */
export function startOfWeek(key: DayKey, weekStart: WeekStart): DayKey {
	const offset = (dayOfWeek(key) - weekStart + 7) % 7;
	return addDays(key, -offset);
}

/**
 * The date range a view covers.
 * `anchor` picks which year/quarter/month/week to show; `today` is only used by "ytd".
 */
export function rangeFor(view: ViewKind, anchor: DayKey, today: DayKey, weekStart: WeekStart): DateRange {
	const { year, month } = parseKey(anchor);
	switch (view) {
		case 'year':
			return { start: toKey(year, 1, 1), end: toKey(year, 12, 31) };
		case 'ytd': {
			const t = parseKey(today);
			return { start: toKey(t.year, 1, 1), end: today };
		}
		case 'quarter': {
			const first = Math.floor((month - 1) / 3) * 3 + 1;
			return { start: toKey(year, first, 1), end: toKey(year, first + 2, lastDayOfMonth(year, first + 2)) };
		}
		case 'month':
			return { start: toKey(year, month, 1), end: toKey(year, month, lastDayOfMonth(year, month)) };
		case 'week': {
			const start = startOfWeek(anchor, weekStart);
			return { start, end: addDays(start, 6) };
		}
	}
}

/** Every day in the range, in order. */
export function eachDay(range: DateRange): DayKey[] {
	const out: DayKey[] = [];
	const n = daysBetween(range.start, range.end);
	for (let i = 0; i <= n; i++) out.push(addDays(range.start, i));
	return out;
}

/**
 * Splits the range into weeks. Each week has exactly 7 slots ordered from `weekStart`;
 * slots outside the range are null so partial first/last weeks line up.
 */
export function weeksOf(range: DateRange, weekStart: WeekStart): (DayKey | null)[][] {
	const weeks: (DayKey | null)[][] = [];
	let cursor = startOfWeek(range.start, weekStart);
	while (daysBetween(cursor, range.end) >= 0) {
		const week: (DayKey | null)[] = [];
		for (let i = 0; i < 7; i++) {
			const day = addDays(cursor, i);
			const inside = daysBetween(range.start, day) >= 0 && daysBetween(day, range.end) >= 0;
			week.push(inside ? day : null);
		}
		weeks.push(week);
		cursor = addDays(cursor, 7);
	}
	return weeks;
}
