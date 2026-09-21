import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterCsv } from '../src/roster.js';

test('imports a semicolon-separated school roster', () => {
  const players = parseRosterCsv('Номер;Имя;Фамилия;Позиция;Фото\n10;Иван;Иванов;ЦН;https://example.com/10.jpg');
  assert.deepEqual(players[0], {
    id: 'local-1',
    number: 10,
    firstName: 'Иван',
    lastName: 'Иванов',
    shortName: 'Иван',
    position: 'ЦН',
    photoUrl: 'https://example.com/10.jpg',
    photoPosition: '50% 16%'
  });
});

test('supports quoted comma-separated values', () => {
  const players = parseRosterCsv('number,first_name,last_name,position\n7,"Пётр, Павел",Сидоров,ПЗ');
  assert.equal(players[0].firstName, 'Пётр, Павел');
  assert.equal(players[0].number, 7);
});
