import { DayKey, WeekStart, addDays, dayOfWeek, daysBetween, parseKey, startOfWeek } from './dates';

/**
 * Flexible streak rules (Streakwise Pro, direction B). Only three kinds of rule, on purpose:
 *   goal: 3/week        weekly target; the streak is counted in weeks
 *   days: weekdays      which weekdays count (rest: sat, sun is the same thing said the other way)
 *   freezes: 2/month    missed planned days that are forgiven automatically, per calendar month
 * plus `min: 30`, the value a day needs to count as done (default: anything above 0).
 */
export interface StreakRule {
	/** 1..7 done days per week, or null for a daily streak. */
	goalPerWeek: number | null;
	/** Planned weekdays (0 = Sunday … 6 = Saturday), or null for every day. */
	days: number[] | null;
	/** Missed planned days forgiven per calendar month (daily streaks only). */
	freezesPerMonth: number;
	/** A day counts as done when its value is >= min (null: value > 0). */
	min: number | null;
}

export const CLASSIC_RULE: StreakRule = { goalPerWeek: null, days: null, freezesPerMonth: 0, min: null };

export function isClassicRule(r: StreakRule): boolean {
	return r.goalPerWeek === null && r.days === null && r.freezesPerMonth === 0 && r.min === null;
}

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "weekdays", "weekends", "every day", or a list like "mon, wed, fri" / "Monday Friday". Null if not understood. */
export function parseWeekdays(value: string): number[] | null {
	const v = value.trim().toLowerCase();
	if (v === 'weekdays' || v === 'workdays') return [1, 2, 3, 4, 5];
	if (v === 'weekends' || v === 'weekend') return [0, 6];
	if (v === 'every day' || v === 'everyday' || v === 'daily' || v === 'all') return [0, 1, 2, 3, 4, 5, 6];
	const parts = v.split(/[\s,]+/).filter(Boolean);
	if (!parts.length) return null;
	const out = new Set<number>();
	for (const p of parts) {
		const i = WEEKDAY_NAMES.indexOf(p.slice(0, 3));
		if (i < 0 || !(p.length === 3 || 'sunday monday tuesday wednesday thursday friday saturday tues thur thurs'.split(' ').includes(p))) return null;
		out.add(i);
	}
	return [...out].sort((a, b) => a - b);
}

/** "3/week", "3 per week", "3x a week", "3 times a week" -> 3 (1..7). */
export function parseWeeklyGoal(value: string): number | null {
	const m = /^([1-7])\s*(?:\/|x|×|times?|per|a|\s)*\s*(?:week|wk|w)$/i.exec(value.trim());
	return m ? Number(m[1]) : null;
}

/** "2/month", "2 per month", "2" -> 2 (0..10). */
export function parseFreezes(value: string): number | null {
	const m = /^(\d{1,2})\s*(?:(?:\/|per|a|\s)*\s*(?:month|mo))?$/i.exec(value.trim());
	if (!m) return null;
	const n = Number(m[1]);
	return n <= 10 ? n : null;
}

/** Short human label, e.g. "3× a week", "Weekdays", "Mon, Wed, Fri · 2 freezes a month · at least 30". */
export function ruleLabel(r: StreakRule): string {
	const parts: string[] = [];
	if (r.goalPerWeek !== null) parts.push(r.goalPerWeek === 7 ? 'Every day of the week' : `${r.goalPerWeek}× a week`);
	if (r.days !== null) {
		const key = r.days.join(',');
		parts.push(key === '1,2,3,4,5' ? 'Weekdays' : key === '0,6' ? 'Weekends' : key === '0,1,2,3,4,5,6' ? 'Every day' : r.days.map((d) => WEEKDAY_LABELS[d]).join(', '));
	}
	if (r.freezesPerMonth > 0) parts.push(`${r.freezesPerMonth} ${r.freezesPerMonth === 1 ? 'freeze' : 'freezes'} a month`);
	if (r.min !== null) parts.push(`at least ${r.min}`);
	return parts.length ? parts.join(' · ') : 'Every day';
}

/** Block lines that express a rule (used when the preview writes a rule into a block). */
export function ruleLines(r: StreakRule): string[] {
	const lines: string[] = [];
	if (r.goalPerWeek !== null) lines.push(`goal: ${r.goalPerWeek}/week`);
	if (r.days !== null) {
		const key = r.days.join(',');
		lines.push(`days: ${key === '1,2,3,4,5' ? 'weekdays' : key === '0,6' ? 'weekends' : r.days.map((d) => WEEKDAY_NAMES[d]).join(', ')}`);
	}
	if (r.freezesPerMonth > 0) lines.push(`freezes: ${r.freezesPerMonth}/month`);
	if (r.min !== null) lines.push(`min: ${r.min}`);
	return lines;
}

export type DayMark = 'rest' | 'frozen';

export interface WeekProgress {
	/** First day of the current week. */
	start: DayKey;
	/** Done days counted this week (planned days only for daily rules). */
	done: number;
	/** Weekly goal, or the number of planned days in this week. */
	target: number;
	/** One entry per weekday of this week, in display order. */
	days: { day: DayKey; state: 'done' | 'missed' | 'rest' | 'frozen' | 'today' | 'future' }[];
}

export interface FlexResult {
	unit: 'day' | 'week';
	current: number;
	longest: number;
	/** Periods that met the rule / periods that are over (the running week or today are not counted yet). */
	met: number;
	total: number;
	week: WeekProgress;
	/** Days drawn differently on the heatmap. */
	marks: Map<DayKey, DayMark>;
	/** Freezes still available this calendar month. */
	freezesLeft: number;
	/** One short, actionable line, or null. */
	nudge: string | null;
}

const doneOn = (values: Map<DayKey, number>, day: DayKey, r: StreakRule) => {
	const v = values.get(day);
	if (v === undefined) return false;
	return r.min !== null ? v >= r.min : v > 0;
};

/** Earliest day with any entry for this habit (including 0 / false), or null. */
export function firstEntryDay(values: Map<DayKey, number>): DayKey | null {
	let first: DayKey | null = null;
	for (const day of values.keys()) if (first === null || day < first) first = day;
	return first;
}

const monthKey = (day: DayKey) => day.slice(0, 7);

/**
 * Streak under a rule, over all data up to `today`. Pure: no Obsidian, no DOM.
 * Today never breaks a streak (it is still open); neither does the running week for weekly goals.
 */
export function computeFlex(values: Map<DayKey, number>, rule: StreakRule, today: DayKey, weekStart: WeekStart): FlexResult {
	const first = firstEntryDay(values);
	const start = first !== null && first <= today ? first : today;
	const planned = (day: DayKey) => rule.days === null || rule.days.includes(dayOfWeek(day));
	const marks = new Map<DayKey, DayMark>();
	const weekStartDay = startOfWeek(today, weekStart);

	if (rule.goalPerWeek !== null) {
		const goal = rule.goalPerWeek;
		let run = 0, longest = 0, met = 0, total = 0, current = 0;
		for (let ws = startOfWeek(start, weekStart); ws <= weekStartDay; ws = addDays(ws, 7)) {
			let n = 0;
			for (let i = 0; i < 7; i++) if (doneOn(values, addDays(ws, i), rule)) n++;
			const running = ws === weekStartDay;
			const partialFirst = ws < start; // tracking started mid-week: a short week never breaks anything
			if (n >= goal) { run++; longest = Math.max(longest, run); if (!running) { met++; total++; } }
			else if (running) { /* still open */ }
			else if (partialFirst) { /* not counted */ }
			else { run = 0; total++; }
			current = run;
		}
		const done = countDone(values, rule, weekStartDay, 7);
		const left = Math.max(0, goal - done);
		const daysLeft = 7 - daysBetween(weekStartDay, today); // including today
		let nudge: string | null = null;
		if (left === 0) nudge = 'This week’s goal is done.';
		else if (left <= daysLeft) nudge = `${left} more this week ${current > 0 ? `keeps your ${current}-week streak` : 'starts a streak'}.`;
		else nudge = current > 0 ? 'This week can’t reach the goal any more; the streak restarts next week.' : null;
		return { unit: 'week', current, longest, met, total, week: weekProgress(values, rule, weekStartDay, today, goal, marks), marks, freezesLeft: 0, nudge };
	}

	let run = 0, longest = 0, met = 0, total = 0;
	const used = new Map<string, number>();
	for (let day = start; day <= today; day = addDays(day, 1)) {
		if (!planned(day)) { marks.set(day, 'rest'); continue; }
		if (doneOn(values, day, rule)) {
			run++; longest = Math.max(longest, run);
			if (day !== today) { met++; total++; }
			continue;
		}
		if (day === today) continue; // still open
		total++;
		const month = monthKey(day);
		const u = used.get(month) ?? 0;
		if (u < rule.freezesPerMonth && run > 0) { used.set(month, u + 1); marks.set(day, 'frozen'); continue; }
		run = 0;
	}
	const freezesLeft = Math.max(0, rule.freezesPerMonth - (used.get(monthKey(today)) ?? 0));
	const target = Array.from({ length: 7 }, (_, i) => addDays(weekStartDay, i)).filter(planned).length;
	let nudge: string | null = null;
	if (planned(today) && !doneOn(values, today, rule) && run > 0) nudge = `Log today to keep your ${run}-day streak.`;
	else if (!planned(today) && rule.days !== null) nudge = 'Rest day. Your streak is safe.';
	return { unit: 'day', current: run, longest, met, total, week: weekProgress(values, rule, weekStartDay, today, target, marks), marks, freezesLeft, nudge };
}

function countDone(values: Map<DayKey, number>, rule: StreakRule, from: DayKey, n: number): number {
	let c = 0;
	for (let i = 0; i < n; i++) if (doneOn(values, addDays(from, i), rule)) c++;
	return c;
}

function weekProgress(values: Map<DayKey, number>, rule: StreakRule, ws: DayKey, today: DayKey, target: number, marks: Map<DayKey, DayMark>): WeekProgress {
	const days: WeekProgress['days'] = [];
	let done = 0;
	for (let i = 0; i < 7; i++) {
		const day = addDays(ws, i);
		const isDone = doneOn(values, day, rule);
		const planned = rule.goalPerWeek !== null || rule.days === null || rule.days.includes(dayOfWeek(day));
		if (isDone && planned) done++;
		let state: WeekProgress['days'][number]['state'];
		if (isDone) state = 'done';
		else if (day > today) state = planned ? 'future' : 'rest';
		else if (marks.get(day) === 'frozen') state = 'frozen';
		else if (!planned) state = 'rest';
		else if (day === today) state = 'today';
		else state = 'missed';
		days.push({ day, state });
	}
	return { start: ws, done, target, days };
}

/** Presets offered by the "preview a flexible streak" dialog, applied to the user's own data. */
export const PRESET_RULES: { label: string; rule: StreakRule }[] = [
	{ label: '5× a week', rule: { ...CLASSIC_RULE, goalPerWeek: 5 } },
	{ label: '3× a week', rule: { ...CLASSIC_RULE, goalPerWeek: 3 } },
	{ label: 'Weekdays only', rule: { ...CLASSIC_RULE, days: [1, 2, 3, 4, 5] } },
	{ label: 'Every day, 2 freezes a month', rule: { ...CLASSIC_RULE, freezesPerMonth: 2 } },
];

/** "12 days", "1 week". */
export function unitCount(n: number, unit: 'day' | 'week'): string {
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Month name for "in November"-style labels. */
export function monthName(day: DayKey): string {
	return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][parseKey(day).month - 1] ?? '';
}
