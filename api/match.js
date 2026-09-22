import {database,hasSession} from '../lib/firebase-rest.js';
import {syncMatch} from '../lib/match-sync.js';
const paths=new Set(['legion_match_v1','live_goal','intro_trigger']);
const fields=new Set(['opponentName','opponentLogo','legionScore','opponentScore','timer','period','designVariant','overlayPosition','colorTheme','customColor','goalCardEnabled','larixAudioEnabled','goals','dataMode','kimberly','manualOverrides']);
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method==='GET') {
      if(req.query.session==='1') return res.status(hasSession(req)?200:401).json({authorized:hasSession(req)});
      const state=await syncMatch(await database('legion_match_v1'));
      const events=await Promise.all(['live_goal','intro_trigger'].map(p=>database(p)));
      const manual=events[0].value, automatic=state?.broadcastGoal;
      const goal=(automatic?.timestamp||0)>(manual?.timestamp||0)?automatic:manual;
      return res.json({legion_match_v1:state,live_goal:goal||null,intro_trigger:events[1].value,serverTime:Date.now()});
    }
    if(req.method!=='POST') return res.status(405).end();
    if(!hasSession(req)) return res.status(401).json({error:'SESSION_EXPIRED'});
    if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return res.status(403).end();
    const {path,method,value}=req.body||{};
    if(!paths.has(path)||!['PATCH','PUT'].includes(method)||value===undefined||JSON.stringify(value).length>100000) return res.status(400).end();
    if(path==='legion_match_v1' && (method!=='PATCH'||!value||Object.keys(value).some(k=>!fields.has(k)))) return res.status(400).end();
    await database(path,method,value);
    return res.json({saved:true});
  } catch(error) { return res.status(503).json({error:['SERVER_AUTH','DATABASE_PERMISSION'].includes(error.message)?error.message:'SERVICE_UNAVAILABLE'}); }
}
