const BREAK_PERIOD = 'ПЕРЕРЫВ';

function normalizedElapsed(timer, now) {
  const elapsed = Math.max(0, Number(timer?.elapsed) || 0);
  if (!timer?.running || !Number.isFinite(timer?.startedAt)) return elapsed;
  return elapsed + Math.max(0, Math.floor((now - timer.startedAt) / 1000));
}

/**
 * Changes only the timer behaviour caused by a period transition.
 * A break pauses and preserves elapsed time. Moving from a break to any
 * playing period resumes from that exact elapsed time.
 */
export function timerForPeriodTransition({ previousPeriod, nextPeriod, timer, now = Date.now() }) {
  const elapsed = normalizedElapsed(timer, now);

  if (nextPeriod === BREAK_PERIOD && timer?.running) {
    return { changed: true, timer: { running: false, elapsed, startedAt: null } };
  }

  if (previousPeriod === BREAK_PERIOD && nextPeriod !== BREAK_PERIOD && !timer?.running) {
    return { changed: true, timer: { running: true, elapsed, startedAt: now } };
  }

  return { changed: false, timer: null };
}
