import {larixView,formatCountdown} from './larix-model.js';
const params=new URLSearchParams(location.search);const mode=params.get('mode')==='pause'?'pause':'standby';
const el=id=>document.getElementById(id);let latest=null,serverOffset=0;
function image(node,src,fallback){
  const next=src||fallback;
  if(node.getAttribute('src')===next)return;
  node.onerror=()=>{node.onerror=null;node.src=fallback};node.src=next;
}
function render(){
  if(!latest)return;const view=larixView(latest,mode,Date.now()+serverOffset);
  document.body.dataset.mode=mode;document.body.dataset.score=String(view.showScore);
  el('status').textContent=view.heading;el('substatus').textContent=view.subheading;
  el('home-name').textContent=view.legionName;el('away-name').textContent=view.opponentName;
  el('home-score').textContent=view.legionScore;el('away-score').textContent=view.opponentScore;
  el('competition').textContent=view.competition;el('competition').hidden=!view.competition;
  el('match-date').textContent=view.date;el('match-date').hidden=!view.date;
  el('venue').textContent=view.venue;el('venue').hidden=!view.venue;
  el('period').textContent=view.period;el('period').hidden=!view.showScore||!view.period;
  const countdown=el('countdown');countdown.textContent=view.remaining?formatCountdown(view.remaining):'';countdown.hidden=!view.remaining||mode==='pause';
  image(el('home-logo'),'./data/legion-logo.svg','./data/default-opponent.svg');image(el('away-logo'),view.opponentLogo,'./data/default-opponent.svg');
}
async function poll(){
  try{const response=await fetch('/api/match',{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error();const data=await response.json();latest=data.legion_match_v1||{};serverOffset=Number(data.serverTime||Date.now())-Date.now();render();el('connection').hidden=true;document.body.classList.add('ready');}
  catch{document.body.classList.add('ready');el('connection').hidden=false;}
  setTimeout(poll,2000);
}
setInterval(render,1000);poll();
