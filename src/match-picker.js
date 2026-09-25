import {db,ref,onValue,update} from './match-transport.js';
import {KimberlyClient} from './kimberly-client.js';
import {normalizeKimberlyGame} from './match-mode.js';
const teams=[{id:17986,label:'2017 green'},{id:17987,label:'2017 blue'}];
export function upcomingGames(games,now=Date.now()) {
  return games.filter(g=>['started','paused'].includes(g.status)||g.status==='not_started'&&Date.parse(String(g.started_at).replace(' ','T')+(/[Z+]\d*|Z$/.test(g.started_at)?'':'+03:00'))>=now-6*3600000)
    .sort((a,b)=>Number(['started','paused'].includes(b.status))-Number(['started','paused'].includes(a.status))||String(a.started_at).localeCompare(String(b.started_at)));
}
export function mountMatchPicker(panel) {
  const box=document.createElement('details');box.className='card settings-card match-picker';
  const summary=document.createElement('summary');summary.textContent='Выбрать матч · Легион 2017';box.append(summary);
  const note=document.createElement('p');note.className='mode-help';note.textContent='Green и blue. Выбор включает автоматический счёт; таймер и заставки — вручную.';box.append(note);
  const refresh=document.createElement('button');refresh.type='button';refresh.className='btn btn-quiet';refresh.textContent='Обновить список';box.append(refresh);
  const list=document.createElement('div');list.className='fixture-list';box.append(list);panel.prepend(box);
  const client=new KimberlyClient({timeoutMs:12000});let current={},busy=false,loaded=false;
  onValue(ref(db,'legion_match_v1'),s=>{
    current=s.val()||{};const team=teams.find(t=>t.id===current.kimberly?.teamId);
    summary.textContent=current.kimberly?.pinned&&team?`${team.label} · сменить матч`:'Выбрать матч · Легион 2017';
    for(const button of list.querySelectorAll('[data-game]')) {const selected=Number(button.dataset.game)===current.kimberly?.gameId&&Number(button.dataset.team)===current.kimberly?.teamId;button.setAttribute('aria-pressed',String(selected));}
  });
  async function load() {
    if(busy)return;busy=true;refresh.disabled=true;list.textContent='Загружаем расписание…';
    const results=await Promise.allSettled(teams.map(async team=>({team,games:upcomingGames(await client.getTeamSchedule(team.id))})));
    list.replaceChildren();let count=0;
    const fixtures=[];
    results.forEach((r,i)=>{
      if(r.status==='fulfilled') r.value.games.forEach(game=>fixtures.push({team:r.value.team,game}));
      else {const p=document.createElement('p');p.className='mode-help';p.textContent=`Не удалось загрузить ${teams[i].label}. Повторите обновление.`;list.append(p);}
    });
    fixtures.sort((a,b)=>Number(['started','paused'].includes(b.game.status))-Number(['started','paused'].includes(a.game.status))||String(a.game.started_at).localeCompare(String(b.game.started_at)));
    for(const {team,game} of fixtures) {
      count++;const opponent=Number(game.team_1_id)===team.id?game.team_2:game.team_1;
      const button=document.createElement('button');button.type='button';button.className='btn fixture';button.dataset.game=game.id;button.dataset.team=team.id;
      button.setAttribute('aria-pressed',String(current.kimberly?.gameId===game.id&&current.kimberly?.teamId===team.id));
      const label=document.createElement('strong');label.textContent=`${team.label} — ${opponent?.name||opponent?.school?.name||'Соперник'}`;
      const date=document.createElement('small');date.textContent=`${String(game.started_at||'Время уточняется')} МСК${['started','paused'].includes(game.status)?' · Идёт матч':''}`;
      button.append(label,date);button.addEventListener('click',async()=>{
        if(busy)return;
        if(current.kimberly?.gameId===game.id&&current.kimberly?.teamId===team.id&&current.dataMode==='kimberly_full'){box.open=false;return;}
        if(current.kimberly?.gameId && current.kimberly.gameId!==game.id && !confirm('Переключить эфир на этот матч? Таймер, тайм и список голов будут сброшены.'))return;
        busy=true;refresh.disabled=true;list.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {
          const normalized=normalizeKimberlyGame(await client.getGame(game.id),team.id);
          await update(ref(db,'legion_match_v1'),{dataMode:'kimberly_full',colorTheme:team.id===17987?'blue':'green',manualOverrides:{score:false,opponent:false},opponentName:normalized.opponentName,opponentLogo:normalized.opponentLogo,legionScore:normalized.legionScore,opponentScore:normalized.opponentScore,timer:{running:false,elapsed:0,startedAt:null},period:'1 ТАЙМ',goals:[],kimberly:{teamId:team.id,gameId:game.id,pinned:true,status:normalized.status,scheduledAt:normalized.scheduledAt,legionTeamName:normalized.legionTeamName,tournamentName:normalized.tournamentName,leagueName:normalized.leagueName,divisionName:normalized.divisionName,venueName:normalized.venueName,venueAddress:normalized.venueAddress,lastSyncAt:null,leaseAt:0,error:null}});
          box.open=false;
        } catch {note.textContent='Не удалось выбрать матч. Проверьте связь и повторите.';}
        finally {busy=false;refresh.disabled=false;list.querySelectorAll('button').forEach(b=>b.disabled=false);}
      });list.append(button);
    }
    if(!count&&results.every(r=>r.status==='fulfilled'))list.textContent='Ближайших матчей пока нет в расписании Kimberly.';
    loaded=true;busy=false;refresh.disabled=false;
  }
  refresh.addEventListener('click',load);box.addEventListener('toggle',()=>{if(box.open&&!loaded)load();});
}
