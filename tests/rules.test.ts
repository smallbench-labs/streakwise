import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/core/dates';
import { CLASSIC_RULE, StreakRule, computeFlex, parseFreezes, parseWeekdays, parseWeeklyGoal, ruleLabel, ruleLines } from '../src/core/rules';
import { applyFreeLimits, parseBlockConfig } from '../src/core/blockConfig';
import { computeStats } from '../src/core/streaks';
import { buildHeatmapModel } from '../src/core/heatmapModel';
import { discoverProperties, habitLabel, replaceHabitInSource, setRuleInSource } from '../src/core/discover';

const T = '2026-11-18'; // Wednesday
const rule = (r: Partial<StreakRule>): StreakRule => ({ ...CLASSIC_RULE, ...r });
/** values for the given days (offsets from T, negative = past) */
const vals = (offsets: number[], v = 1) => new Map(offsets.map((o) => [addDays(T, o), v]));

test('rules: parsing goal, days, rest, freezes', () => {
	assert.equal(parseWeeklyGoal('3/week'), 3);
	assert.equal(parseWeeklyGoal('3 per week'), 3);
	assert.equal(parseWeeklyGoal('5x a week'), 5);
	assert.equal(parseWeeklyGoal('4 times a week'), 4);
	assert.equal(parseWeeklyGoal('8/week'), null);
	assert.equal(parseWeeklyGoal('3'), null);
	assert.deepEqual(parseWeekdays('weekdays'), [1, 2, 3, 4, 5]);
	assert.deepEqual(parseWeekdays('Mon, Wed, Friday'), [1, 3, 5]);
	assert.equal(parseWeekdays('mondaze'), null);
	assert.equal(parseFreezes('2/month'), 2);
	assert.equal(parseFreezes('1'), 1);
	assert.equal(parseFreezes('99'), null);
	const c = parseBlockConfig('habits: run\ngoal: 3/week');
	assert.equal(c.rule.goalPerWeek, 3);
	assert.deepEqual(c.errors, []);
	const r = parseBlockConfig('habits: run\nrest: sat, sun\nfreezes: 2/month\nmin: 30');
	assert.deepEqual(r.rule, { goalPerWeek: null, days: [1, 2, 3, 4, 5], freezesPerMonth: 2, min: 30 });
	assert.equal(parseBlockConfig('goal: 3/week\ndays: weekdays').errors.length, 1);
	assert.equal(parseBlockConfig('goal: lots').errors.length, 1);
	assert.equal(parseBlockConfig('days: every day').rule.days, null);
});

test('rules: labels and lines round-trip', () => {
	const r = rule({ days: [1, 2, 3, 4, 5], freezesPerMonth: 2 });
	assert.equal(ruleLabel(r), 'Weekdays · 2 freezes a month');
	assert.deepEqual(parseBlockConfig(ruleLines(r).join('\n')).rule, r);
	assert.equal(ruleLabel(rule({ goalPerWeek: 3 })), '3× a week');
	assert.deepEqual(ruleLines(rule({ goalPerWeek: 3 })), ['goal: 3/week']);
});

test('classic rule matches the existing daily streak', () => {
	const v = vals([-1, -2, -3, -5, -6]);
	const flex = computeFlex(v, CLASSIC_RULE, T, 1);
	assert.equal(flex.current, computeStats(v, { start: '2026-01-01', end: '2026-12-31' }, T).currentStreak);
	assert.equal(flex.current, 3);
	assert.equal(flex.longest, 3);
	assert.equal(flex.unit, 'day');
	assert.equal(flex.nudge, 'Log today to keep your 3-day streak.');
	// done today extends it
	assert.equal(computeFlex(vals([0, -1, -2, -3]), CLASSIC_RULE, T, 1).current, 4);
});

test('weekdays only: weekends never break the streak', () => {
	// T is Wed 11-18. Mon 16, Tue 17 done; Sat 14 / Sun 15 nothing; Fri 13 .. Mon 9 done.
	const v = vals([-2, -1, -5, -6, -7, -8, -9]);
	const daily = computeFlex(v, CLASSIC_RULE, T, 1);
	assert.equal(daily.current, 2);
	const wd = computeFlex(v, rule({ days: [1, 2, 3, 4, 5] }), T, 1);
	assert.equal(wd.current, 7);
	assert.equal(wd.marks.get('2026-11-14'), 'rest');
	assert.equal(wd.marks.get('2026-11-15'), 'rest');
	assert.equal(wd.week.target, 5);
	assert.equal(wd.week.done, 2);
});

test('freezes cover missed days up to the monthly limit, then the streak breaks', () => {
	// done every day for 10 days except -3 and -6
	const days = [-1, -2, -4, -5, -7, -8, -9, -10];
	const one = computeFlex(vals(days), rule({ freezesPerMonth: 1 }), T, 1);
	assert.equal(one.current, 2); // second miss in November breaks it
	const two = computeFlex(vals(days), rule({ freezesPerMonth: 2 }), T, 1);
	assert.equal(two.current, 8);
	assert.equal(two.marks.get(addDays(T, -3)), 'frozen');
	assert.equal(two.freezesLeft, 0);
	// freezes only protect a running streak: four misses in a row with two freezes still break it
	assert.equal(computeFlex(vals([-5]), rule({ freezesPerMonth: 2 }), T, 1).current, 0);
	assert.equal(computeFlex(new Map(), rule({ freezesPerMonth: 2 }), T, 1).current, 0);
});

test('weekly goal: streak in weeks, the running week never breaks it', () => {
	// Weeks start Monday. This week (Mon 16 ..): 1 done. Last week (9..15): 3 done. Week before (2..8): 3 done.
	const v = vals([-2, -9, -8, -7, -16, -14, -12]);
	const g = computeFlex(v, rule({ goalPerWeek: 3 }), T, 1);
	assert.equal(g.unit, 'week');
	assert.equal(g.current, 2);
	assert.equal(g.week.done, 1);
	assert.equal(g.week.target, 3);
	assert.match(g.nudge ?? '', /^2 more this week keeps your 2-week streak/);
	// a past week below goal breaks it
	const broken = computeFlex(vals([-2, -9, -16, -14, -12]), rule({ goalPerWeek: 3 }), T, 1);
	assert.equal(broken.current, 0);
	assert.equal(broken.longest, 1);
});

test('min: values below the threshold do not count, and are drawn as not done', () => {
	const v = new Map([[addDays(T, -1), 45], [addDays(T, -2), 10], [addDays(T, -3), 60]]);
	assert.equal(computeFlex(v, rule({ min: 30 }), T, 1).current, 1);
	const model = buildHeatmapModel({ view: 'year', anchor: T, today: T, weekStart: 1, habits: ['r'], data: new Map([['r', v]]), rule: rule({ min: 30 }) });
	const cell = model.habits[0].weeks.flat().find((c) => c?.day === addDays(T, -2));
	assert.equal(cell?.level, 0);
});

test('model: days before the first entry are marked, future days too', () => {
	const model = buildHeatmapModel({ view: 'year', anchor: T, today: T, weekStart: 1, habits: ['r'], data: new Map([['r', vals([-3, -2])]]) });
	const cells = model.habits[0].weeks.flat().filter(Boolean);
	assert.equal(cells.find((c) => c?.day === '2026-03-01')?.before, true);
	assert.equal(cells.find((c) => c?.day === addDays(T, -2))?.before, false);
	assert.equal(cells.find((c) => c?.day === '2026-12-01')?.future, true);
});

test('free limits: a rule is previewed, not locked; Pro keeps it', () => {
	const c = parseBlockConfig('habits: run\ngoal: 3/week');
	const free = applyFreeLimits(c, false);
	assert.deepEqual(free.locked, []);
	assert.equal(free.lockedRule?.goalPerWeek, 3);
	assert.equal(free.config.rule.goalPerWeek, null);
	const pro = applyFreeLimits(c, true);
	assert.equal(pro.lockedRule, null);
	assert.equal(pro.config.rule.goalPerWeek, 3);
});

test('discover: habit-like properties, most used first; dates and lists skipped', () => {
	const byDay = new Map([
		['2026-11-01', { path: 'a', day: '2026-11-01', frontmatter: { exercise: true, reading: '30 min', tags: ['daily'], created: '2026-11-01', mood: 'great' } }],
		['2026-11-02', { path: 'b', day: '2026-11-02', frontmatter: { Exercise: false, meditate: 'yes', mood: 'ok' } }],
		['2026-11-03', { path: 'c', day: '2026-11-03', frontmatter: { exercise: 1, reading: 20, mood: 'tired' } }],
	]);
	const found = discoverProperties({ byDay, duplicates: [] });
	assert.deepEqual(found.map((f) => [f.name, f.notes]), [['exercise', 3], ['reading', 2], ['meditate', 1]]);
	assert.equal(habitLabel('reading_minutes'), 'Reading minutes');
	assert.equal(habitLabel('deepWork'), 'Deep work');
});

test('block source edits touch only what they should', () => {
	assert.equal(replaceHabitInSource('habits: habit\nview: year', 'habit', 'exercise'), 'habits: exercise\nview: year');
	assert.equal(replaceHabitInSource('title: Me\nhabits: run, Habit', 'habit', 'read'), 'title: Me\nhabits: run, read');
	assert.equal(replaceHabitInSource('view: year', '', 'exercise'), 'habits: exercise\nview: year');
	assert.equal(setRuleInSource('habits: run\ngoal: 5/week\nview: year\n', ['goal: 3/week']), 'habits: run\nview: year\ngoal: 3/week');
	assert.equal(setRuleInSource('habits: run\ndays: weekdays', []), 'habits: run');
});
