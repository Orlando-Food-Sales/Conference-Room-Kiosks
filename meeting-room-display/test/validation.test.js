import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeTextEqual, validateBooking } from '../src/validation.js';

test('validateBooking normalizes a valid booking', () => {
  const now = new Date('2026-11-05T14:00:00.000Z');
  const booking = validateBooking({
    subject: '  Team sync  ',
    start: '2026-11-05T14:05:00Z',
    end: '2026-11-05T14:35:00Z',
  }, now);
  assert.deepEqual(booking, {
    subject: 'Team sync',
    start: '2026-11-05T14:05:00.000Z',
    end: '2026-11-05T14:35:00.000Z',
  });
});

test('validateBooking rejects invalid durations and unzoned dates', () => {
  const now = new Date('2026-11-05T14:00:00.000Z');
  assert.throws(() => validateBooking({ start: '2026-11-05T14:05:00', end: '2026-11-05T14:35:00Z' }, now), /ISO 8601/);
  assert.throws(() => validateBooking({ start: '2026-11-05T14:05:00Z', end: '2026-11-05T19:05:00Z' }, now), /duration/);
});

test('timingSafeTextEqual compares client-state values', () => {
  assert.equal(timingSafeTextEqual('abc123', 'abc123'), true);
  assert.equal(timingSafeTextEqual('abc123', 'abc124'), false);
  assert.equal(timingSafeTextEqual('short', 'much-longer'), false);
});
