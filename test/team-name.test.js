import {test} from 'node:test';
import assert from 'node:assert/strict';
import {teamNameLines} from '../src/team-name.js';
test('short name stays on one line',()=>assert.deepEqual(teamNameLines('Сатурн'),['Сатурн']));
test('birth year and colour stay together',()=>assert.deepEqual(teamNameLines('Красногвардеец 2016 red'),['Красногвардеец','2016 red']));
test('long names retain every word in two lines',()=>{const name='Смена Москва yellow';const lines=teamNameLines(name);assert.equal(lines.length,2);assert.equal(lines.join(' '),name);});
