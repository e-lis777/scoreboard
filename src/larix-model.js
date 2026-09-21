const FINISHED=new Set(['finished','completed','ended']);
export function parseMoscowDate(value) {
  if(!value)return null;
  const raw=String(value).trim().replace(' ','T');
  const parsed=Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw)?raw:`${raw}+03:00`);
  return Number.isFinite(parsed)?new Date(parsed):null;
}
export function formatMatchDate(value) {
  const date=parseMoscowDate(value);if(!date)return '';
  const day=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(date);
  const time=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/Moscow'}).format(date);
  return `${day.toUpperCase()} · ${time} · МСК`;
}
export function legionLabel(k={}) {
  if(k.teamId===17986)return 'ЛЕГИОН 2017 GREEN';
  if(k.teamId===17987)return 'ЛЕГИОН 2017 BLUE';
  return String(k.legionTeamName||'ЛЕГИОН').replace(/\(Некрасовка\)/i,'').trim().toUpperCase();
}
export function larixView(state={},mode='standby',now=Date.now()) {
  const k=state.kimberly||{},status=String(k.status||'').toLowerCase();
  const finished=FINISHED.has(status),isBreak=state.period==='ПЕРЕРЫВ'||status==='paused';
  const scheduled=parseMoscowDate(k.scheduledAt);const remaining=scheduled?scheduled.getTime()-now:0;
  let heading,subheading,showScore;
  if(finished){heading='МАТЧ ЗАВЕРШЁН';subheading='СПАСИБО ЗА ПРОСМОТР';showScore=true;}
  else if(mode==='pause'&&isBreak){heading='ПЕРЕРЫВ';subheading=state.period==='ПЕРЕРЫВ'?'СКОРО ВТОРОЙ ТАЙМ':'СКОРО ПРОДОЛЖИМ';showScore=true;}
  else if(mode==='pause'){heading='ТЕХНИЧЕСКАЯ ПАУЗА';subheading='СКОРО ВЕРНЁМСЯ';showScore=true;}
  else if(['started','paused'].includes(status)){heading='МАТЧ ИДЁТ';subheading='ТРАНСЛЯЦИЯ ПРОДОЛЖАЕТСЯ';showScore=true;}
  else {heading='ТРАНСЛЯЦИЯ СКОРО НАЧНЁТСЯ';subheading=remaining>0?'ДО НАЧАЛА МАТЧА':'';showScore=false;}
  return {heading,subheading,showScore,remaining:remaining>0?remaining:0,legionName:legionLabel(k),opponentName:String(state.opponentName||'СОПЕРНИК').toUpperCase(),legionScore:Number(state.legionScore)||0,opponentScore:Number(state.opponentScore)||0,date:formatMatchDate(k.scheduledAt),competition:['KIMBERLY',k.leagueName,k.tournamentName].filter(Boolean).join(' · ').toUpperCase(),venue:[k.venueName,k.venueAddress].filter(Boolean).join(' · '),period:String(state.period||''),opponentLogo:state.opponentLogo||'./data/default-opponent.svg'};
}
export function formatCountdown(ms) {
  const seconds=Math.max(0,Math.floor(ms/1000));
  if(seconds>=86400)return `${Math.floor(seconds/86400)} ДН. ${String(Math.floor(seconds%86400/3600)).padStart(2,'0')} Ч.`;
  return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
