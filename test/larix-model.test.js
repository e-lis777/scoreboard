import test from 'node:test';import assert from 'node:assert/strict';
import {larixView,formatCountdown,formatMatchDate} from '../src/larix-model.js';
const state={opponentName:'СШОР Олимп blue',opponentLogo:'',legionScore:2,opponentScore:1,period:'ПЕРЕРЫВ',kimberly:{teamId:17986,status:'paused',scheduledAt:'2026-09-13 09:00:00',leagueName:'Экстра лига',tournamentName:'Осень/2026',venueName:'Красногвардеец'}};
test('pause shows break and current score',()=>{const v=larixView(state,'pause');assert.equal(v.heading,'ПЕРЕРЫВ');assert.equal(v.showScore,true);assert.equal(v.legionName,'ЛЕГИОН 2017 GREEN')});
test('standby before match hides score',()=>{const v=larixView({...state,period:'1 ТАЙМ',kimberly:{...state.kimberly,status:'not_started'}},'standby',Date.parse('2026-09-13T05:00:00Z'));assert.equal(v.showScore,false);assert.ok(v.remaining>0)});
test('finished screen keeps final score',()=>assert.equal(larixView({...state,kimberly:{...state.kimberly,status:'finished'}},'standby').heading,'МАТЧ ЗАВЕРШЁН'));
test('Larix screens identify Kimberly tournament',()=>assert.match(larixView(state,'standby').competition,/^KIMBERLY(?: · |$)/));
test('formats Moscow time and countdown',()=>{assert.match(formatMatchDate('2026-09-13 09:00:00'),/09:00/);assert.equal(formatCountdown(3661000),'01:01:01')});
