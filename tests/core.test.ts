import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayOfWeek, isValidKey, rangeFor, weeksOf, eachDay } from '../src/core/dates';
import { parseHabitValue, readHabit } from '../src/core/values';
import { intensityLevel, scaleMax } from '../src/core/scale';
import { computeStats } from '../src/core/streaks';
import { applyFreeLimits, parseBlockConfig } from '../src/core/blockConfig';
import { buildHeatmapModel } from '../src/core/heatmapModel';
import { parseDailyNoteDate } from '../src/core/noteDates';

const T = '2026-10-21'; // a Wednesday

test('dates: arithmetic across month, year and leap day', () => {
	assert.equal(addDays('2026-12-31', 1), '2027-01-01');
	assert.equal(addDays('2028-02-28', 1), '2028-02-29');
	assert.equal(addDays('2026-03-01', -1), '2026-02-28');
	assert.equal(dayOfWeek(T), 3);
	assert.equal(isValidKey('2026-02-30'), false);
	assert.equal(isValidKey('2026-02-28'), true);
});

test('dates: view ranges', () => {
	assert.deepEqual(rangeFor('year', T, T, 1), { start: '2026-01-01', end: '2026-12-31' });
	assert.deepEqual(rangeFor('ytd', '2020-05-05', T, 1), { start: '2026-01-01', end: T });
	assert.deepEqual(rangeFor('quarter', T, T, 1), { start: '2026-10-01', end: '2026-12-31' });
	assert.deepEqual(rangeFor('quarter', '2026-02-10', T, 1), { start: '2026-01-01', end: '2026-03-31' });
	assert.deepEqual(rangeFor('month', '2028-02-10', T, 1), { start: '2028-02-01', end: '2028-02-29' });
	assert.deepEqual(rangeFor('week', T, T, 1), { start: '2026-10-19', end: '2026-10-25' });
	assert.deepEqual(rangeFor('week', T, T, 0), { start: '2026-10-18', end: '2026-10-24' });
});

test('dates: weeks are padded with null and cover every day once', () => {
	const range = rangeFor('month', T, T, 1); // Oct 2026 starts Thursday
	const weeks = weeksOf(range, 1);
	assert.deepEqual(weeks[0].slice(0, 4), [null, null, null, '2026-10-01']);
	assert.equal(weeks.flat().filter(Boolean).length, 31);
	const yearWeeks = weeksOf(rangeFor('year', T, T, 0), 0);
	assert.equal(yearWeeks.flat().filter(Boolean).length, 365);
	assert.ok(yearWeeks.every((w) => w.length === 7));
	assert.equal(eachDay(rangeFor('year', '2028-01-01', T, 0)).length, 366);
});

test('values: booleans, numbers, words, units, junk', () => {
	assert.equal(parseHabitValue(true), 1);
	assert.equal(parseHabitValue(false), 0);
	assert.equal(parseHabitValue(7), 7);
	assert.equal(parseHabitValue('12'), 12);
	assert.equal(parseHabitValue('1.5h'), 1.5);
	assert.equal(parseHabitValue('30 min'), 30);
	assert.equal(parseHabitValue('2,5'), 2.5);
	assert.equal(parseHabitValue('Yes'), 1);
	assert.equal(parseHabitValue('✅'), 1);
	assert.equal(parseHabitValue('done'), 1);
	assert.equal(parseHabitValue('no'), 0);
	assert.equal(parseHabitValue(''), 0);
	assert.equal(parseHabitValue(null), null);
	assert.equal(parseHabitValue('banana'), null);
	assert.equal(parseHabitValue(['a']), null);
	assert.equal(parseHabitValue(Number.NaN), null);
});

test('values: frontmatter keys are case-insensitive', () => {
	assert.equal(readHabit({ Run: true }, 'run'), 1);
	assert.equal(readHabit({ run: 3 }, 'run'), 3);
	assert.equal(readHabit({}, 'run'), null);
	assert.equal(readHabit(undefined, 'run'), null);
});

test('scale: levels 0..4', () => {
	assert.equal(scaleMax([1, 5, 3]), 5);
	assert.equal(scaleMax([1, 5], 10), 10);
	assert.equal(intensityLevel(0, 5), 0);
	assert.equal(intensityLevel(null, 5), 0);
	assert.equal(intensityLevel(-2, 5), 0);
	assert.equal(intensityLevel(0.1, 5), 1);
	assert.equal(intensityLevel(2.5, 5), 2);
	assert.equal(intensityLevel(5, 5), 4);
	assert.equal(intensityLevel(50, 5), 4);
	assert.equal(intensityLevel(1, 1), 4); // boolean habits are full colour
});

test('streaks: current, longest, today not yet logged', () => {
	const v = new Map<string, number>([
		['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-03', 1], ['2026-10-04', 1], // 4 run
		['2026-10-18', 1], ['2026-10-19', 2], ['2026-10-20', 1], // current (today empty)
	]);
	const s = computeStats(v, rangeFor('month', T, T, 1), T);
	assert.equal(s.currentStreak, 3);
	assert.equal(s.longestStreak, 4);
	assert.equal(s.doneDays, 7);
	assert.equal(s.elapsedDays, 21);
	assert.equal(s.total, 8);
	v.set(T, 1);
	assert.equal(computeStats(v, rangeFor('month', T, T, 1), T).currentStreak, 4);
	v.set('2026-10-20', 0);
	assert.equal(computeStats(v, rangeFor('month', T, T, 1), T).currentStreak, 1);
});

test('streaks: current streak crosses the start of the range', () => {
	const v = new Map([['2026-09-30', 1], ['2026-10-01', 1]]);
	assert.equal(computeStats(v, rangeFor('month', '2026-10-01', '2026-10-01', 1), '2026-10-01').currentStreak, 2);
});

test('block config: parses all options and reports errors', () => {
	const c = parseBlockConfig('habits: run, Read \nview: Month\ndate: 2026-09-15\ncolors: blue\nmax: 10\ntitle: Me\nweekstart: sunday\nbogus: 1\nview: decade\n# comment');
	assert.deepEqual(c.habits, ['run', 'Read']);
	assert.equal(c.view, 'month');
	assert.equal(c.anchor, '2026-09-15');
	assert.equal(c.palette, 'blue');
	assert.equal(c.max, 10);
	assert.equal(c.title, 'Me');
	assert.equal(c.weekStart, 0);
	assert.equal(c.errors.length, 2);
	assert.equal(parseBlockConfig('year: 2025').anchor, '2025-01-01');
	assert.equal(parseBlockConfig('').view, 'year');
});

test('free limits: yearly single habit only; Pro unchanged', () => {
	const c = parseBlockConfig('habits: a, b\nview: ytd');
	const free = applyFreeLimits(c, false);
	assert.equal(free.config.view, 'year');
	assert.deepEqual(free.config.habits, ['a']);
	assert.deepEqual(free.locked, ['Year-to-date view', 'Multiple habits']);
	assert.deepEqual(applyFreeLimits(parseBlockConfig('view: month'), false).locked, ['Month view']);
	const pro = applyFreeLimits(c, true);
	assert.equal(pro.config.view, 'ytd');
	assert.deepEqual(pro.locked, []);
	assert.deepEqual(applyFreeLimits(parseBlockConfig('habit: a'), false).locked, []);
});

test('model: levels, missing days, future flag, per-habit max', () => {
	const data = new Map([
		['run', new Map([['2026-10-20', 5], ['2026-10-21', 10]])],
		['read', new Map([['2026-10-19', true ? 1 : 0]])],
	]);
	const m = buildHeatmapModel({ view: 'week', anchor: T, today: T, weekStart: 1, habits: ['run', 'read'], data });
	assert.equal(m.habits.length, 2);
	const run = m.habits[0].weeks[0];
	assert.equal(run[0]?.value, null); // Mon 19 no data
	assert.equal(run[1]?.level, 2);    // 5 of 10
	assert.equal(run[2]?.level, 4);
	assert.equal(run[3]?.future, true);
	assert.equal(m.habits[1].weeks[0][0]?.level, 4);
	assert.equal(m.habits[0].stats.currentStreak, 2);
});

test('note dates: moment-style formats incl. nested folders', () => {
	assert.equal(parseDailyNoteDate('2026-10-21', 'YYYY-MM-DD'), '2026-10-21');
	assert.equal(parseDailyNoteDate('2026/10/2026-10-21', 'YYYY/MM/YYYY-MM-DD'), '2026-10-21');
	assert.equal(parseDailyNoteDate('20261021', 'YYYYMMDD'), '2026-10-21');
	assert.equal(parseDailyNoteDate('21.10.2026', 'DD.MM.YYYY'), '2026-10-21');
	assert.equal(parseDailyNoteDate('2026-10-21 Wednesday', 'YYYY-MM-DD dddd'), '2026-10-21');
	assert.equal(parseDailyNoteDate('2026-02-30', 'YYYY-MM-DD'), null);
	assert.equal(parseDailyNoteDate('meeting notes', 'YYYY-MM-DD'), null);
	assert.equal(parseDailyNoteDate('2026-10-21-extra', 'YYYY-MM-DD'), null);
});
