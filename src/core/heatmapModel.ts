import { DateRange, DayKey, ViewKind, WeekStart, rangeFor, weeksOf, daysBetween } from './dates';
import { intensityLevel, scaleMax } from './scale';
import { HabitStats, computeStats } from './streaks';
import { CLASSIC_RULE, DayMark, FlexResult, StreakRule, computeFlex, firstEntryDay } from './rules';

export interface Cell {
	day: DayKey;
	value: number | null; // null = no daily note / no value
	level: number;        // 0..4
	future: boolean;
	/** Before the first note that has this habit: drawn faint, it is not a miss. */
	before: boolean;
	/** Rest day or a missed day covered by a freeze (flexible streaks). */
	mark: DayMark | null;
}

export interface HabitHeatmap {
	habit: string;
	weeks: (Cell | null)[][]; // weeks × 7 weekdays
	stats: HabitStats;
	max: number;
	/** Streak under the block's rule (the classic daily rule when none is set). */
	flex: FlexResult;
	rule: StreakRule;
	first: DayKey | null;
}

export interface HeatmapModel {
	view: ViewKind;
	range: DateRange;
	weekStart: WeekStart;
	habits: HabitHeatmap[];
}

export interface ModelInput {
	view: ViewKind;
	anchor: DayKey;
	today: DayKey;
	weekStart: WeekStart;
	habits: string[];
	/** habit -> (day -> value) */
	data: Map<string, Map<DayKey, number>>;
	max?: number;
	rule?: StreakRule;
}

/** Everything the renderer needs, computed without touching Obsidian or the DOM. */
export function buildHeatmapModel(input: ModelInput): HeatmapModel {
	const range = rangeFor(input.view, input.anchor, input.today, input.weekStart);
	const weekDays = weeksOf(range, input.weekStart);

	const habits = input.habits.map((habit) => {
		const values = input.data.get(habit) ?? new Map<DayKey, number>();
		const inRange = weekDays.flat().filter((d): d is DayKey => d !== null).map((d) => values.get(d) ?? 0);
		const max = scaleMax(inRange, input.max);
		const rule = input.rule ?? CLASSIC_RULE;
		const flex = computeFlex(values, rule, input.today, input.weekStart);
		const first = firstEntryDay(values);
		const weeks = weekDays.map((week) => week.map((day) => {
			if (day === null) return null;
			const value = values.has(day) ? (values.get(day) as number) : null;
			const below = rule.min !== null && value !== null && value < rule.min;
			return {
				day, value,
				level: below ? 0 : intensityLevel(value, max),
				future: daysBetween(input.today, day) > 0,
				before: first === null || day < first,
				mark: flex.marks.get(day) ?? null,
			};
		}));
		return { habit, weeks, stats: computeStats(values, range, input.today), max, flex, rule, first };
	});

	return { view: input.view, range, weekStart: input.weekStart, habits };
}
