import { MATCH_MODES } from './match-mode.js';

export function controlPolicy(mode) {
  if (mode === MATCH_MODES.KIMBERLY_FULL) {
    return {
      score: 'kimberly',
      goals: 'kimberly',
      opponent: 'kimberly',
      clock: 'manual',
      period: 'manual'
    };
  }
  if (mode === MATCH_MODES.KIMBERLY_SCORE) {
    return {
      score: 'kimberly',
      goals: 'manual',
      opponent: 'kimberly',
      clock: 'manual',
      period: 'manual'
    };
  }
  return {
    score: 'manual',
    goals: 'manual',
    opponent: 'manual',
    clock: 'manual',
    period: 'manual'
  };
}

export function sourceLabel(source) {
  if (source === 'kimberly') return 'Авто';
  if (source === 'override') return 'Исправлено';
  return 'Вручную';
}
