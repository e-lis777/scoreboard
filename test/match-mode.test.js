import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_MODES, applyKimberlyState, deriveKimberlyClock, detectNewGoalEvents, normalizeKimberlyGame } from '../src/match-mode.js';
import { selectRelevantGame } from '../src/kimberly-client.js';

const game = {
  id: 42,
  team_1_id: 99,
  team_2_id: 17509,
  team_1: { name: 'Соперник', school: { avatar: { url: 'https://example.test/logo.png' } } },
  team_2: { name: 'Легион' },
  team_1_goals: '1',
  team_2_goals: '2',
  team_1_players: [],
  team_2_players: [{
    number: 7,
    position: 'ЦП',
    goals: [3, 15],
    player: { id: 5, first_name: 'Иван', last_name: 'Иванов' }
  }],
  status: 'started',
  pauses: []
};

test('normalizes score when Legion is team 2', () => {
  const normalized = normalizeKimberlyGame(game, 17509);
  assert.equal(normalized.legionScore, 2);
  assert.equal(normalized.opponentScore, 1);
  assert.equal(normalized.opponentName, 'Соперник');
  assert.equal(normalized.goals[0].team, 'legion');
  assert.equal(normalized.goals[0].minute, 3);
});

test('score-only mode does not replace local goal history', () => {
  const current = { goals: [{ minute: 4 }], opponentLogo: '' };
  const normalized = normalizeKimberlyGame(game, 17509);
  const next = applyKimberlyState(current, normalized, MATCH_MODES.KIMBERLY_SCORE);
  assert.deepEqual(next.goals, current.goals);
  assert.equal(next.legionScore, 2);
});

test('detects detailed Kimberly goal', () => {
  const current = normalizeKimberlyGame(game, 17509);
  const previous = { ...current, goals: current.goals.slice(0, 1), legionScore: 1 };
  const events = detectNewGoalEvents(previous, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].minute, 15);
});

test('does not infer an own goal when Kimberly has no player', () => {
  const noRosterGame = {
    ...game,
    team_2_goals: '3',
    team_2_players: [{ id: 1232905, goals: [1, 5, 13], player: null }]
  };
  const normalized = normalizeKimberlyGame(noRosterGame, 17509);
  assert.equal(normalized.goals.length, 0);
});

test('uses the player thumbnail for the goal card', () => {
  const gameWithPhoto = structuredClone(game);
  gameWithPhoto.team_2_players[0].player.avatar = {
    url: 'https://example.test/full.jpg',
    conversion: 'https://example.test/thumb.jpg'
  };
  const normalized = normalizeKimberlyGame(gameWithPhoto, 17509);
  assert.equal(normalized.goals[0].photoUrl, 'https://example.test/thumb.jpg');
});

test('prefers an active game over future fixtures', () => {
  const selected = selectRelevantGame([
    { id: 1, status: 'not_started', started_at: '2026-09-03 10:00:00' },
    { id: 2, status: 'started', started_at: '2026-09-02 10:00:00' }
  ], new Date('2026-09-02T10:05:00'));
  assert.equal(selected.id, 2);
});

test('derives a live clock from Kimberly start time and pauses', () => {
  const clock = deriveKimberlyClock({
    status: 'started',
    actual_start_time: '2026-09-03T10:00:00Z',
    pauses: [{ started_at: '2026-09-03T10:10:00Z', finished_at: '2026-09-03T10:12:00Z' }]
  }, Date.parse('2026-09-03T10:20:00Z'));
  assert.deepEqual(clock, { available: true, elapsed: 1080, running: true });
});
