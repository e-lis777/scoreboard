import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRemoteState } from '../src/state-schema.js';

test('sanitizes values received from the public overlay state', () => {
  const state = sanitizeRemoteState({
    opponentName: '  Команда\u0000<script>  ',
    opponentLogo: 'javascript:alert(1)',
    legionScore: -50,
    opponentScore: 1000,
    designVariant: 99,
    colorTheme: 'green evil',
    timer: { running: 'yes', elapsed: -1 },
    goals: [{ team: 'opponent', lastName: 42, minute: '12' }]
  }, {});
  assert.equal(state.opponentName, 'Команда<script>');
  assert.equal(state.opponentLogo, '');
  assert.equal(state.legionScore, 0);
  assert.equal(state.opponentScore, 99);
  assert.equal(state.designVariant, 3);
  assert.equal(state.colorTheme, 'green');
  assert.equal(state.timer.running, false);
  assert.equal(state.larixAudioEnabled, true);
  assert.equal(state.goals[0].minute, 12);
});

test('allows Larix overlay music to be disabled', () => {
  assert.equal(sanitizeRemoteState({ larixAudioEnabled: false }, {}).larixAudioEnabled, false);
});

test('migrates the legacy timer shape', () => {
  const state = sanitizeRemoteState({ timerSeconds: 90, timerRunning: true }, {});
  assert.deepEqual(state.timer, { elapsed: 90, running: true, startedAt: null });
});

test('keeps a valid shared timer anchor', () => {
  const state = sanitizeRemoteState({ timer: { running: true, elapsed: 90, startedAt: 1_700_000_000_000 } }, {});
  assert.deepEqual(state.timer, { elapsed: 90, running: true, startedAt: 1_700_000_000_000 });
});
