import {database} from './firebase-rest.js';
import {KimberlyClient,selectRelevantGame} from '../src/kimberly-client.js';
import {normalizeKimberlyGame,applyKimberlyState} from '../src/match-mode.js';
const client=new KimberlyClient({baseUrl:'https://api.kimberly-cup.ru/api',timeoutMs:8000});
export async function syncMatch(snapshot) {
  const state=snapshot.value;
  if(!state || state.dataMode==='manual') return state;
  const now=Date.now(); const k=state.kimberly||{};
  const interval=['started','paused'].includes(k.status)?2000:30000;
  if(now-(k.lastSyncAt||0)<interval || now-(k.leaseAt||0)<20000) return state;
  const lease={...state,kimberly:{...k,leaseAt:now}};
  if((await database('legion_match_v1','PUT',lease,snapshot.etag)).conflict) return state;
  let game, failure;
  try {
    let id=k.gameId;
    if(!id || (!k.pinned && !['started','paused','not_started'].includes(k.status))) id=selectRelevantGame(await client.getTeamSchedule(k.teamId||17509))?.id;
    if(id) game=normalizeKimberlyGame(await client.getGame(id),k.teamId||17509);
  } catch { failure='Kimberly временно недоступна'; }
  for(let attempt=0;attempt<3;attempt++) {
    const latest=await database('legion_match_v1'); const current=latest.value;
    if(current?.dataMode!==state.dataMode || current?.kimberly?.teamId!==k.teamId || current?.kimberly?.leaseAt!==now) return current;
    let next=game?applyKimberlyState(current,game,state.dataMode):{...current};
    next.kimberly={...next.kimberly,leaseAt:0,lastSyncAt:Date.now(),error:failure||null};
    if(!game&&!failure) { next.kimberly.status='waiting';next.kimberly.gameId=null; }
    if(game&&state.dataMode==='kimberly_full') {
      next.goals=game.goals.map(g=>({team:g.team,number:g.number,lastName:g.lastName||g.playerName,minute:g.minute}));
      // Event is committed with the score; reconnects must not replay historic goals.
      const oldKeys=new Set(k.goals?.map(g=>g.key)||[]);
      let goal=k.gameId===game.gameId && k.goals ? game.goals.filter(g=>!oldKeys.has(g.key)).at(-1):null;
      if(!goal && !current.manualOverrides?.score && k.gameId===game.gameId && k.lastSyncAt) {
        if(game.legionScore>Number(current.legionScore||0)) goal={team:'legion',minute:null};
        else if(game.opponentScore>Number(current.opponentScore||0)) goal={team:'opponent',minute:null};
      }
      if(goal) next.broadcastGoal={
        team:goal.team,
        timestamp:Date.now(),
        minute:goal.minute,
        teamName:goal.team==='opponent'?game.opponentName:game.legionTeamName,
        teamLogo:goal.team==='opponent'?game.opponentLogo:'./data/legion-logo.svg',
        scorer:goal.playerName?{lastName:goal.lastName||goal.playerName,number:goal.number,position:goal.position,photoUrl:goal.photoUrl}:null
      };
    }
    if(!(await database('legion_match_v1','PUT',next,latest.etag)).conflict) return next;
  }
  return (await database('legion_match_v1')).value;
}
