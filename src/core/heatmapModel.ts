import { DateRange, DayKey, ViewKind, WeekStart, rangeFor, weeksOf, daysBetween } from './dates';
import { intensityLevel, scaleMax } from './scale';
import { HabitStats, computeStats } from './streaks';

export interface Cell {
	day: DayKey;
	value: number | null; // null = no daily note / no value
	level: number;        // 0..4
	future: boolean;
}

export interface HabitHeatmap {
	habit: string;
	weeks: (Cell | null)[][]; // weeks × 7 weekdays
	stats: HabitStats;
	max: number;
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
}

/** Everything the renderer needs, computed without touching Obsidian or the DOM. */
export function buildHeatmapModel(input: ModelInput): HeatmapModel {
	const range = rangeFor(input.view, input.anchor, input.today, input.weekStart);
	const weekDays = weeksOf(range, input.weekStart);

	const habits = input.habits.map((habit) => {
		const values = input.data.get(habit) ?? new Map<DayKey, number>();
		const inRange = weekDays.flat().filter((d): d is DayKey => d !== null).map((d) => values.get(d) ?? 0);
		const max = scaleMax(inRange, input.max);
		const weeks = weekDays.map((week) => week.map((day) => {
			if (day === null) return null;
			const value = values.has(day) ? (values.get(day) as number) : null;
			return { day, value, level: intensityLevel(value, max), future: daysBetween(input.today, day) > 0 };
		}));
		return { habit, weeks, stats: computeStats(values, range, input.today), max };
	});

	return { view: input.view, range, weekStart: input.weekStart, habits };
}
