// Presentation only. Existing controls retain their real match handlers.
import {db,ref,onValue} from './match-transport.js';
import {mountMatchPicker} from './match-picker.js';
if (new URLSearchParams(location.search).get('admin') === 'true') {
  const admin = document.getElementById('admin');
  const connection = document.createElement('p');
  connection.className='operator-connection';
  connection.setAttribute('role','status');
  connection.textContent='Подключение…';
  admin.querySelector('.admin-head').after(connection);
  window.addEventListener('match-connection',event=>connection.textContent=event.detail==='На связи'?'Сервер подключён':event.detail);
  let wakeLock;
  async function keepAwake() {
    if(document.visibilityState==='visible' && navigator.wakeLock) {
      try { wakeLock=await navigator.wakeLock.request('screen'); } catch {}
    }
  }
  keepAwake();
  document.addEventListener('visibilitychange',keepAwake);
  const content = document.getElementById('admin-content');
  const grid = content.querySelector('.admin-grid');
  const panels = {};
  for (const name of ['match', 'appearance', 'roster', 'settings']) {
    const panel = document.createElement('section');
    panel.className = 'operator-page';
    panel.dataset.page = name;
    panel.hidden = name !== 'match';
    content.append(panel);
    panels[name] = panel;
  }
  const groups = {
    match: ['.score-card', '.clock-card', '.period-card', '.goal-control-card', '.intro-settings'],
    appearance: ['.appearance-card'], roster: ['.roster-settings'],
    settings: ['.source-card', '.opponent-card']
  };
  for (const [name, selectors] of Object.entries(groups)) {
    for (const selector of selectors) {
      const card = content.querySelector(selector);
      if (card) { panels[name].append(card); if (card.tagName === 'DETAILS') card.open = name !== 'match'; }
    }
  }
  grid.remove();
  mountMatchPicker(panels.match);
  const heading = document.createElement('h2');
  heading.className = 'operator-heading';
  heading.hidden = true;
  content.prepend(heading);
  const nav = document.createElement('nav');
  nav.className = 'operator-nav';
  nav.setAttribute('aria-label', 'Разделы управления');
  const names = { match: 'Матч', appearance: 'Оформление', roster: 'Состав', settings: 'Настройки' };
  function select(name) {
    Object.entries(panels).forEach(([key, panel]) => panel.hidden = key !== name);
    nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.page === name ? 'page' : 'false'));
    heading.hidden = name === 'match';
    heading.textContent = names[name];
    admin.scrollTop = 0;
  }
  for (const name of ['match', 'appearance', 'roster']) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.page = name; button.textContent = names[name];
    button.addEventListener('click', () => select(name)); nav.append(button);
  }
  admin.append(nav);
  const settings = document.createElement('button');
  settings.type = 'button'; settings.className = 'operator-settings'; settings.textContent = '⚙';
  settings.setAttribute('aria-label', 'Настройки матча');
  settings.addEventListener('click', () => select('settings'));
  admin.querySelector('.admin-toolbar').append(settings);
  const reconnect=document.createElement('button');
  reconnect.className='btn btn-quiet'; reconnect.type='button'; reconnect.textContent='Переподключить управление';
  reconnect.addEventListener('click',()=>{
    if(navigator.userAgent.includes('LegionAdmin/')) location.href='/native-reconnect';
    else location.reload();
  });
  panels.settings.append(reconnect);
  const matchStatus=document.createElement('p');matchStatus.className='operator-match-status';
  panels.match.querySelector('.score-card').append(matchStatus);
  onValue(ref(db,'legion_match_v1'),snapshot=>{
    const state=snapshot.val()||{}, k=state.kimberly||{};
    const labels=panels.match.querySelectorAll('.score-team > label');
    if(labels[1]) labels[1].textContent=state.opponentName||'Соперник';
    matchStatus.textContent=state.dataMode==='manual'?'Ручное управление':k.error?'Kimberly недоступна · показаны последние данные':!k.gameId?'Kimberly · матч ещё не найден':({started:'Kimberly · матч идёт',paused:'Kimberly · пауза',not_started:'Kimberly · матч ещё не начался',finished:'Kimberly · матч завершён'}[k.status]||'Kimberly · ожидание данных');
  });
  const clock = document.createElement('output'); clock.className = 'operator-clock';
  panels.match.querySelector('.clock-card .card-title').after(clock);
  const clockSource = document.getElementById('v1-t');
  const refreshClock = () => clock.textContent = clockSource.textContent || '00:00';
  new MutationObserver(refreshClock).observe(clockSource, { childList: true, subtree: true, characterData: true });
  refreshClock();
  const score = panels.match.querySelector('.score-card');
  const imgs = ['v1-lh', 'v1-la'];
  score.querySelectorAll('.score-team').forEach((team, index) => {
    const img = document.createElement('img'); img.className = 'operator-crest'; img.alt = index ? 'Соперник' : 'Легион';
    const source = document.getElementById(imgs[index]);
    const refresh = () => img.src = source.src;
    new MutationObserver(refresh).observe(source, { attributes: true, attributeFilter: ['src'] });
    refresh(); team.prepend(img);
  });
  select('match');
}
