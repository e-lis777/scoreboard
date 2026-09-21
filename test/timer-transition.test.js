import test from 'node:test';
import assert from 'node:assert/strict';
import { timerForPeriodTransition } from '../src/timer-transition.js';

const startedTimer = { running: true, elapsed: 95, startedAt: 1_000 };

test('break pauses and keeps the accumulated time', () => {
  const result = timerForPeriodTransition({
    previousPeriod: '1 ТАЙМ', nextPeriod: 'ПЕРЕРЫВ', timer: startedTimer, now: 9_700
  });
  assert.deepEqual(result, { changed: true, timer: { running: false, elapsed: 103, startedAt: null } });
});

for (const period of ['2 ТАЙМ', 'ДОП. ТАЙМ', 'ПЕНАЛЬТИ']) {
  test(`${period} resumes the paused clock after a break`, () => {
    const result = timerForPeriodTransition({
      previousPeriod: 'ПЕРЕРЫВ', nextPeriod: period,
      timer: { running: false, elapsed: 103, startedAt: null }, now: 12_000
    });
    assert.deepEqual(result, { changed: true, timer: { running: true, elapsed: 103, startedAt: 12_000 } });
  });
}

test('a direct change between playing periods leaves the timer untouched', () => {
  const result = timerForPeriodTransition({
    previousPeriod: '1 ТАЙМ', nextPeriod: 'ДОП. ТАЙМ', timer: startedTimer, now: 9_700
  });
  assert.deepEqual(result, { changed: false, timer: null });
});
