import test from 'node:test';
import assert from 'node:assert/strict';
import {syncMatch} from '../lib/match-sync.js';
import handler from '../api/match.js';

test('server sync keeps manual control and protects concurrent mode changes', async t => {
  const original=globalThis.fetch;
  let state, writes, version, changeMode, gameFixture;
  globalThis.fetch=async(url,options={})=>{
    url=String(url);
    if(url.includes('signInWithPassword')) return Response.json({idToken:'test'});
    if(url.includes('/games/')) {
      if(changeMode) {state.dataMode='manual';version++;}
      return Response.json(gameFixture);
    }
    if(url.includes('legion_match_v1')) {
      if(options.method==='PUT') {
        if(options.headers['if-match']!==String(version)) return new Response('',{status:412});
        state=JSON.parse(options.body);writes++;version++;
      }
      return Response.json(state,{headers:{etag:String(version)}});
    }
    throw new Error('Unexpected URL');
  };
  const reset=mode=>{gameFixture={id:1,team_1_id:17509,team_2_id:8,team_1_goals:2,team_2_goals:1,status:'started',actual_start_time:'2026-09-11T12:00:00Z',team_1_players:[],team_2_players:[],team_1:{name:'Легион'},team_2:{name:'Соперник'}};state={dataMode:mode,legionScore:9,opponentScore:0,timer:{running:true,elapsed:42,startedAt:1000},period:'2 ТАЙМ',goals:[{lastName:'Manual'}],kimberly:{teamId:17509,gameId:1,status:'started'}};writes=0;version=1;changeMode=false;};
  try {
    await t.test('manual mode performs no upstream writes',async()=>{reset('manual');await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(writes,0);assert.equal(state.legionScore,9);});
    await t.test('score-only preserves timer, period and manual goals',async()=>{reset('kimberly_score');await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(state.legionScore,2);assert.equal(state.timer.elapsed,42);assert.equal(state.period,'2 ТАЙМ');assert.equal(state.goals[0].lastName,'Manual');});
    await t.test('automatic mode preserves the operator clock and period',async()=>{reset('kimberly_full');await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(state.legionScore,2);assert.equal(state.timer.elapsed,42);assert.equal(state.timer.startedAt,1000);assert.equal(state.period,'2 ТАЙМ');assert.deepEqual(state.goals,[]);});
    await t.test('manual score correction has priority over Kimberly',async()=>{reset('kimberly_full');state.manualOverrides={score:true,opponent:false};await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(state.legionScore,9);assert.equal(state.opponentScore,0);});
    await t.test('opponent scorer creates an automatic opponent goal card event',async()=>{reset('kimberly_full');state.legionScore=2;state.opponentScore=0;state.kimberly.goals=[];state.kimberly.lastSyncAt=1;gameFixture.team_2_players=[{number:7,position:'ЦН',goals:[12],player:{id:77,first_name:'Петр',last_name:'Петров',avatar:{conversion:'https://example.test/p.jpg'}}}];await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(state.broadcastGoal.team,'opponent');assert.equal(state.broadcastGoal.scorer.lastName,'Петров');});
    await t.test('switching to manual while upstream is in flight wins',async()=>{reset('kimberly_score');changeMode=true;await syncMatch({value:structuredClone(state),etag:'1'});assert.equal(state.dataMode,'manual');assert.equal(state.legionScore,9);});
    await t.test('anonymous writes are rejected before database access',async()=>{let code;const res={setHeader(){},status(c){code=c;return this;},json(){},end(){}};await handler({method:'POST',headers:{},body:{path:'legion_match_v1',method:'PATCH',value:{legionScore:20}}},res);assert.equal(code,401);});
  } finally {globalThis.fetch=original;}
});
