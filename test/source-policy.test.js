import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_MODES } from '../src/match-mode.js';
import { controlPolicy } from '../src/source-policy.js';
import { normalizeRoster } from '../src/roster.js';
import { readFile } from 'node:fs/promises';

test('Kimberly mode owns score and goals while operator owns clock and period', () => {
  assert.deepEqual(controlPolicy(MATCH_MODES.KIMBERLY_FULL), {
    score: 'kimberly', goals: 'kimberly', opponent: 'kimberly', clock: 'manual', period: 'manual'
  });
});

test('score-only mode keeps goal controls manual', () => {
  const policy = controlPolicy(MATCH_MODES.KIMBERLY_SCORE);
  assert.equal(policy.score, 'kimberly');
  assert.equal(policy.goals, 'manual');
  assert.equal(policy.clock, 'manual');
});

test('normalizes a Kimberly school export into the local roster', () => {
  const roster = normalizeRoster({ players: [{ number: '7', position: 'ЦП', player: {
    id: 42, first_name: 'Иван', last_name: 'Иванов', avatar: { conversion: 'https://example.test/42.jpg' }
  } }] });
  assert.deepEqual(roster[0], {
    id: 42, number: 7, firstName: 'Иван', lastName: 'Иванов', shortName: 'Иван', position: 'ЦП', photoUrl: 'https://example.test/42.jpg', photoPosition: '50% 16%'
  });
});

test('bundled Green and Blue rosters are available on every operator device', async () => {
  const book = JSON.parse(await readFile(new URL('../data/legion-2017-rosters.json', import.meta.url), 'utf8'));
  assert.equal(book.teams['17986'].length, 8);
  assert.equal(book.teams['17987'].length, 5);
  assert.equal(book.teams['17986'].find(player => player.id === 56635).lastName, 'Лисицин');
});
