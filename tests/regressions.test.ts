// Regression tests for QA report items (qa-streakwise/REPORT.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHabitValue } from '../src/core/values';
import { dedupeByDay, relativeDailyPath } from '../src/core/dailyEntries';
import { parseDailyNoteDate } from '../src/core/noteDates';
import { intensityLevel } from '../src/core/scale';
import { rangeFor } from '../src/core/dates';

test('S-02: same-named note outside the daily folder is not a daily note', () => {
	assert.equal(relativeDailyPath('Daily/2026-10-17.md', 'Daily'), '2026-10-17');
	assert.equal(relativeDailyPath('Archive/2026-10-17.md', 'Daily'), null);
	assert.equal(relativeDailyPath('Daily.md', 'Daily'), null);
	assert.equal(relativeDailyPath('Daily/2026-10-17.canvas', 'Daily'), null);
});

test('S-02: relative path keeps subfolders (file-name fallback is in matchDailyNote, S-13)', () => {
	const rel = relativeDailyPath('Archive/2026-10-17.md', '');
	assert.equal(rel, 'Archive/2026-10-17');
	assert.equal(parseDailyNoteDate(rel ?? '', 'YYYY-MM-DD'), null);
	assert.equal(parseDailyNoteDate(relativeDailyPath('2026-10-17.md', '') ?? '', 'YYYY-MM-DD'), '2026-10-17');
});

test('S-02: duplicate days resolved independent of listing order', () => {
	const a = { path: 'Daily/2026-10-17.md', day: '2026-10-17', frontmatter: { run: false } };
	const b = { path: 'Daily/2026/2026-10-17.md', day: '2026-10-17', frontmatter: { run: true } };
	const c = { path: 'Daily/2026-10-18.md', day: '2026-10-18', frontmatter: {} };
	for (const order of [[a, b, c], [b, c, a], [c, b, a]]) {
		const r = dedupeByDay(order);
		assert.equal(r.byDay.get('2026-10-17')?.path, a.path);
		assert.deepEqual(r.duplicates, [{ day: '2026-10-17', used: a.path, ignored: [b.path] }]);
		assert.equal(r.byDay.size, 2);
	}
});

test('S-02: equal-length paths tie-break by string order', () => {
	const x = { path: 'D/b.md', day: '2026-01-01', frontmatter: {} };
	const y = { path: 'D/a.md', day: '2026-01-01', frontmatter: {} };
	assert.equal(dedupeByDay([x, y]).byDay.get('2026-01-01')?.path, 'D/a.md');
});

test('S-03: negative strings stay negative and count as not done', () => {
	assert.equal(parseHabitValue('-5'), -5);
	assert.equal(parseHabitValue('-5 min'), -5);
	assert.equal(parseHabitValue('+3'), 3);
	assert.equal(parseHabitValue('-.5'), -0.5);
	assert.equal(intensityLevel(parseHabitValue('-5'), 10), 0);
});

test('S-04: thousands separator vs decimal comma', () => {
	assert.equal(parseHabitValue('1,000'), 1000);
	assert.equal(parseHabitValue('12,500 steps'), 12500);
	assert.equal(parseHabitValue('1,234,567.5'), 1234567.5);
	assert.equal(parseHabitValue('1,5'), 1.5);
	assert.equal(parseHabitValue('1,5h'), 1.5);
	assert.equal(parseHabitValue('10,25'), 10.25);
	assert.equal(parseHabitValue('1,0000'), 1);
	assert.equal(parseHabitValue('1,50'), 1.5); // QA r2: documented in README (not 3 digits => decimal comma)
});

test('S-05: ytd always shows the current year, ignoring date/year', () => {
	assert.deepEqual(rangeFor('ytd', '2020-06-01', '2026-10-21', 1), { start: '2026-01-01', end: '2026-10-21' });
});

import { matchDailyNote, duplicatesInRange } from '../src/core/dailyEntries';
const parseYmd = (s: string) => parseDailyNoteDate(s, 'YYYY-MM-DD');

test('S-13: notes in subfolders of the daily folder are found by file name', () => {
	assert.equal(matchDailyNote('Daily/2026/2026-10-17.md', 'Daily', parseYmd), '2026-10-17');
	assert.equal(matchDailyNote('Journal/2026/10/2026-10-17.md', 'Journal', parseYmd), '2026-10-17');
	assert.equal(matchDailyNote('2026/2026-10-17.md', '', parseYmd), '2026-10-17'); // vault root
	assert.equal(matchDailyNote('2026-10-17.md', '', parseYmd), '2026-10-17');
});

test('S-13: S-02 still holds — outside the folder never counts', () => {
	assert.equal(matchDailyNote('Archive/2026-10-17.md', 'Daily', parseYmd), null);
	assert.equal(matchDailyNote('DailyOld/2026-10-17.md', 'Daily', parseYmd), null);
});

test('S-13: full-path formats still work and win over the file name', () => {
	const p = (s: string) => parseDailyNoteDate(s, 'YYYY/MM/YYYY-MM-DD');
	assert.equal(matchDailyNote('Daily/2026/10/2026-10-17.md', 'Daily', p), '2026-10-17');
	assert.equal(matchDailyNote('Daily/notes/meeting.md', 'Daily', parseYmd), null);
});

test('S-13 + S-02: same day in folder root and a subfolder resolves to the shorter path', () => {
	const entries = ['Daily/2026-10-17.md', 'Daily/2026/2026-10-17.md'].map((path) => ({ path, day: matchDailyNote(path, 'Daily', parseYmd) ?? '', frontmatter: {} }));
	assert.equal(dedupeByDay(entries).byDay.get('2026-10-17')?.path, 'Daily/2026-10-17.md');
});

test('S-14: duplicate notice only for days inside the block range', () => {
	const dups = [{ day: '2026-03-02', used: 'a', ignored: ['b'] }, { day: '2026-10-20', used: 'c', ignored: ['d'] }];
	assert.deepEqual(duplicatesInRange(dups, { start: '2026-10-19', end: '2026-10-25' }).map((d) => d.day), ['2026-10-20']);
	assert.deepEqual(duplicatesInRange(dups, { start: '2026-04-01', end: '2026-04-30' }), []);
	assert.equal(duplicatesInRange(dups, { start: '2026-01-01', end: '2026-12-31' }).length, 2);
});

import { formatDailyNoteName } from '../src/core/noteDates';
import { isInDailyFolder } from '../src/core/dailyEntries';

test('S-29: [literal] text in date formats is matched and shown without brackets', () => {
	assert.equal(parseDailyNoteDate('none 2026-10-21', '[none] YYYY-MM-DD'), '2026-10-21');
	assert.equal(parseDailyNoteDate('[none] 2026-10-21', '[none] YYYY-MM-DD'), null);
	assert.equal(parseDailyNoteDate('2026/W43 Wed 2026-10-21', 'YYYY/[W43] ddd YYYY-MM-DD'), '2026-10-21');
	assert.equal(formatDailyNoteName('2026-10-21', '[none]'), 'none');
	assert.equal(formatDailyNoteName('2026-10-21', '[Journal] YYYY-MM-DD'), 'Journal 2026-10-21');
	assert.equal(formatDailyNoteName('2026-10-21', 'YYYY/MM/YYYY-MM-DD'), '2026/10/2026-10-21');
	assert.equal(formatDailyNoteName('2026-10-21', 'dddd, MMMM Do YYYY'), 'Wednesday, October 21st 2026');
	assert.equal(formatDailyNoteName('2026-10-21', '[YYYY-MM-DD]'), 'YYYY-MM-DD');
});

test('0.1.1: vault events only count inside the daily-notes folder', () => {
	assert.equal(isInDailyFolder('Daily/2026/2026-10-21.md', 'Daily'), true);
	assert.equal(isInDailyFolder('Daily', 'Daily'), true);
	assert.equal(isInDailyFolder('DailyOld/2026-10-21.md', 'Daily'), false);
	assert.equal(isInDailyFolder('Projects/x.md', 'Daily'), false);
	assert.equal(isInDailyFolder('anything.md', ''), true);
});
