import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayCount } from '../src/core/plural';

test('m-02: day / days', () => {
	assert.equal(dayCount(1), '1 day');
	assert.equal(dayCount(2), '2 days');
	assert.equal(dayCount(7), '7 days');
	assert.equal(dayCount(0), '0 days');
});

test('more days: "1 more day", "2 more days"', async () => {
	const { moreDays } = await import('../src/core/plural');
	assert.equal(moreDays(1), '1 more day');
	assert.equal(moreDays(2), '2 more days');
	assert.equal(moreDays(7), '7 more days');
});
