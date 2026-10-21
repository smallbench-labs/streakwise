import { DateRange, DayKey, addDays, daysBetween, eachDay } from './dates';

export interface HabitStats {
	/** Consecutive done days ending today (or yesterday, if today has no entry yet). */
	currentStreak: number;
	/** Longest run of consecutive done days inside the range. */
	longestStreak: number;
	/** Days in the range with a value > 0. */
	doneDays: number;
	/** Days in the range up to today (future days are not counted). */
	elapsedDays: number;
	/** Sum of all values in the range. */
	total: number;
}

const done = (values: Map<DayKey, number>, day: DayKey) => (values.get(day) ?? 0) > 0;

export function computeStats(values: Map<DayKey, number>, range: DateRange, today: DayKey): HabitStats {
	let longest = 0, run = 0, doneDays = 0, elapsed = 0, total = 0;
	for (const day of eachDay(range)) {
		if (daysBetween(day, today) < 0) break; // future
		elapsed++;
		const v = values.get(day) ?? 0;
		if (v > 0) {
			total += v;
			doneDays++;
			run++;
			longest = Math.max(longest, run);
		} else {
			run = 0;
		}
	}

	// Current streak looks at all data, not only the visible range.
	let current = 0;
	let cursor = done(values, today) ? today : addDays(today, -1);
	while (done(values, cursor)) {
		current++;
		cursor = addDays(cursor, -1);
	}

	return { currentStreak: current, longestStreak: longest, doneDays, elapsedDays: elapsed, total };
}
