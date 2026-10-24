import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayCount } from '../src/core/plural';

test('m-02: day / days', () => {
	assert.equal(dayCount(1), '1 day');
	assert.equal(dayCount(2), '2 days');
	assert.equal(dayCount(7), '7 days');
	assert.equal(dayCount(0), '0 days');
});
