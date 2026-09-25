import { db, ref, set, onValue, update } from './match-transport.js';
import { renderTeamName } from './team-name.js';
import { KimberlyClient, selectRelevantGame } from './kimberly-client.js';
import { MATCH_MODES, applyKimberlyState, detectNewGoalEvents, normalizeKimberlyGame } from './match-mode.js';
import { controlPolicy, sourceLabel } from './source-policy.js';
import { normalizeRoster, parseRosterCsv } from './roster.js';
import { sanitizeRemoteState } from './state-schema.js';
import { timerForPeriodTransition } from './timer-transition.js';

const firebaseConfig = {
  apiKey: "AIzaSyAFb-yJaI7WJFcTx_wAFmSngupHqUNai1I",
  authDomain: "scoreboard-6d34c.firebaseapp.com",
  databaseURL: "https://scoreboard-6d34c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "scoreboard-6d34c",
  storageBucket: "scoreboard-6d34c.firebasestorage.app",
  messagingSenderId: "11785107743",
  appId: "1:11785107743:web:a8faa98d6aaf4462dd582a"
};

const LEGION_LOGO = "./data/legion-logo.svg";
const DEFAULT_OPPONENT_LOGO = "./data/default-opponent.svg";
const DB_KEY = 'legion_match_v1';
const ADMIN = new URLSearchParams(window.location.search).get('admin') === 'true';
const DEBUG = new URLSearchParams(window.location.search).get('debug') === 'true';
const PREVIEW = new URLSearchParams(window.location.search).get('preview');
const VERSION = "4.0.0";
const DEFAULT_TEAM_ID = 17509;
const DISCOVERY_INTERVAL_MS = 30_000;
const ACTIVE_SYNC_INTERVAL_MS = 2_000;
const ADMIN_THEME_KEY = 'legion-admin-theme';

function applyAdminTheme(theme) {
  const isLight = theme === 'light';
  const admin = document.getElementById('admin');
  const toggle = document.getElementById('admin-theme-toggle');
  const label = document.getElementById('admin-theme-label');
  admin?.classList.toggle('admin-light', isLight);
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(isLight));
    toggle.title = isLight ? 'Включить тёмную тему' : 'Включить светлую тему';
  }
  if (label) label.textContent = isLight ? 'Светлая тема' : 'Тёмная тема';
}

function initializeAdminTheme() {
  let theme = 'dark';
  try {
    theme = localStorage.getItem(ADMIN_THEME_KEY) || 'dark';
  } catch {
    // Private browsing may forbid storage; the default theme still works.
  }
  applyAdminTheme(theme);
  document.getElementById('admin-theme-toggle')?.addEventListener('click', () => {
    const nextTheme = document.getElementById('admin')?.classList.contains('admin-light') ? 'dark' : 'light';
    try { localStorage.setItem(ADMIN_THEME_KEY, nextTheme); } catch { /* no persistence available */ }
    applyAdminTheme(nextTheme);
  });
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value, window.location.href);
    return parsed.protocol === 'https:' || parsed.origin === window.location.origin ? parsed.href : '';
  } catch {
    return '';
  }
}

function setImageWithFallback(image, source, fallback = DEFAULT_OPPONENT_LOGO) {
  if (!image) return;
  const target = safeImageUrl(source) || fallback;
  const updatePresentation = () => {
    const ratio = image.naturalWidth && image.naturalHeight
      ? image.naturalWidth / image.naturalHeight
      : 1;
    image.classList.toggle('logo-wide', ratio > 1.25);
    image.classList.toggle('logo-tall', ratio < 0.8);
    image.classList.toggle('logo-placeholder', image.currentSrc.endsWith('default-opponent.svg'));
  };
  image.onload = updatePresentation;
  if (image.getAttribute('src') !== target) image.src = target;
  image.onerror = () => {
    image.onerror = null;
    image.src = fallback;
  };
  if (image.complete) updatePresentation();
}

const kimberlyClient = new KimberlyClient();

let adminAuthorized = false;
let adminInitialized = false;
let kimberlyInterval = null;
let lastKimberlyGame = null;
let timerAnchorMigrationPending = false;
const adminDraft = {
  mode: null,
  scoreDirty: false,
  opponentDirty: false,
  kimberlyDirty: false
};

async function withLock(action) {
  if (!adminAuthorized) {
    toast('Требуется вход администратора', 'error');
    return false;
  }
  try {
    const result = await action();
    return result;
  } catch (error) {
    console.error('Ошибка в withLock:', error);
    toast(error?.message === 'SESSION_EXPIRED'
      ? 'Сессия истекла. Откройте секретную ссылку входа.'
      : 'Не удалось сохранить. Проверьте соединение.', 'error');
    return false;
  }
}

// ===== СОСТОЯНИЕ ПРИЛОЖЕНИЯ =====
let state = {
  opponentName: 'СОПЕРНИК',
  opponentLogo: '',
  legionScore: 0,
  opponentScore: 0,
  timer: { running: false, elapsed: 0, startedAt: null },
  period: '1 ТАЙМ',
  designVariant: 3,
  overlayPosition: 'center',
  colorTheme: 'green',
  customColor: '#185c47',
  goalCardEnabled: true,
  goals: [],
  dataMode: MATCH_MODES.MANUAL,
  manualOverrides: { score: false, opponent: false },
  kimberly: {
    teamId: DEFAULT_TEAM_ID,
    gameId: null,
    status: 'idle',
    lastSyncAt: null,
    error: null
  }
};

let currentTimerSeconds = 0;
let timerUpdateInterval = null;
let players = [];
let loadedRosterTeamId = null;

// ===== ЭЛЕМЕНТЫ DOM =====
const elements = {
  v1: { lh: document.getElementById('v1-lh'), la: document.getElementById('v1-la'), nh: document.getElementById('v1-nh'), na: document.getElementById('v1-na'), sh: document.getElementById('v1-sh'), sa: document.getElementById('v1-sa'), p: document.getElementById('v1-p'), t: document.getElementById('v1-t') },
  v2: { lh: document.getElementById('v2-lh'), la: document.getElementById('v2-la'), nh: document.getElementById('v2-nh'), na: document.getElementById('v2-na'), sh: document.getElementById('v2-sh'), sa: document.getElementById('v2-sa'), p: document.getElementById('v2-p'), t: document.getElementById('v2-t') },
  v3: { lh: document.getElementById('v3-lh'), la: document.getElementById('v3-la'), nh: document.getElementById('v3-nh'), na: document.getElementById('v3-na'), sh: document.getElementById('v3-sh'), sa: document.getElementById('v3-sa'), p: document.getElementById('v3-p'), t: document.getElementById('v3-t') },
  admin: {
    na: document.getElementById('adm-na'),
    la: document.getElementById('adm-la'),
    sh: document.getElementById('adm-sh'),
    sa: document.getElementById('adm-sa'),
    p: document.getElementById('adm-p'),
    goalCardChk: document.getElementById('goal-card-chk'),
    customColor: document.getElementById('custom-color'),
    varBtns: document.querySelectorAll('.var-btn[data-variant]'),
    colBtns: document.querySelectorAll('.col-btn'),
    positionBtns: document.querySelectorAll('.position-btn'),
    tmInd: document.getElementById('tm-ind'),
    tmTxt: document.getElementById('tm-txt')
  },
  sbV1: document.getElementById('sb-v1'),
  sbV2: document.getElementById('sb-v2'),
  sbV3: document.getElementById('sb-v3'),
  toast: document.getElementById('toast'),
  goalCard: document.getElementById('goal-card'),
  goalCardLogo: document.getElementById('goal-card-logo'),
  goalPlayerPhoto: document.getElementById('goal-player-photo'),
  goalLastname: document.getElementById('goal-lastname'),
  goalNumber: document.getElementById('goal-number'),
  goalPosition: document.getElementById('goal-position'),
  goalMinuteDisplay: document.getElementById('goal-minute-display'),
  goalModal: document.getElementById('goal-modal'),
  goalWithoutPlayerBtn: document.getElementById('goal-without-player-btn'),
  scorerButtons: document.getElementById('scorer-buttons'),
  versionDisplay: document.getElementById('version-display'),
  debugInfo: document.getElementById('debug-info'),
  introOverlay: document.getElementById('intro-overlay'),
  introLogoHome: document.getElementById('intro-logo-home'),
  introLogoAway: document.getElementById('intro-logo-away'),
  introNameHome: document.getElementById('intro-name-home'),
  introNameAway: document.getElementById('intro-name-away'),
  introDate: document.getElementById('intro-date'),
  introTime: document.getElementById('intro-time'),
  introPeriod: document.getElementById('intro-period'),
  adminContent: document.getElementById('admin-content'),
  sourceCard: document.getElementById('source-card'),
  modeChoices: document.querySelectorAll('.mode-choice'),
  dataMode: document.getElementById('data-mode'),
  kimberlyTeamId: document.getElementById('kimberly-team-id'),
  saveModeBtn: document.getElementById('save-mode-btn'),
  syncNowBtn: document.getElementById('sync-now-btn'),
  syncStatus: document.getElementById('sync-status'),
  activeModeLabel: document.getElementById('active-mode-label'),
  rosterInput: document.getElementById('roster-file'),
  rosterCount: document.getElementById('roster-count'),
  goalPreviewBtn: document.getElementById('goal-preview-btn')
};

if (elements.versionDisplay) {
  elements.versionDisplay.textContent = `v${VERSION}`;
}

function updateDebugInfo() {
  if (!DEBUG || !elements.debugInfo) return;
  elements.debugInfo.textContent = `v${VERSION} | mode: ${state.dataMode} | timer: ${currentTimerSeconds}s | running: ${state.timer.running} | goals: ${state.goals.length}`;
  elements.debugInfo.classList.add('visible');
}

function updateRealTime() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  if (elements.introDate) elements.introDate.textContent = `${day}.${month}.${year}`;
  if (elements.introTime) elements.introTime.textContent = `${hours}:${minutes}`;
}

// ===== ФУНКЦИЯ ПОКАЗА ЗАСТАВКИ =====
function showIntro(period, duration = 7000) {
  if (!elements.introOverlay) return;
  const overlay = elements.introOverlay;
  if (elements.introNameHome) elements.introNameHome.textContent = 'ЛЕГИОН';
  if (elements.introNameAway) elements.introNameAway.textContent = state.opponentName;
  if (elements.introPeriod) elements.introPeriod.textContent = period;
  elements.introLogoHome.src = LEGION_LOGO;
  setImageWithFallback(elements.introLogoAway, state.opponentLogo);
  updateRealTime();
  overlay.classList.remove('show');
  void overlay.offsetWidth;
  overlay.classList.add('show');
  if (window.introTimeout) clearTimeout(window.introTimeout);
  window.introTimeout = null;
  if (Number.isFinite(duration) && duration > 0) {
    window.introTimeout = setTimeout(() => {
      overlay.classList.remove('show');
      window.introTimeout = null;
    }, duration);
  }
}

function hideIntro() {
  if (window.introTimeout) clearTimeout(window.introTimeout);
  window.introTimeout = null;
  elements.introOverlay?.classList.remove('show');
}

// ===== ЗАГРУЗКА ИГРОКОВ =====
async function loadPlayers() {
  try {
    const teamId = Number(state.kimberly?.teamId) || 17986;
    const stored = localStorage.getItem(`legion-roster-v1-${teamId}`);
    if (stored) {
      players = normalizeRoster(JSON.parse(stored));
    } else {
      const response = await fetch('./data/legion-2017-rosters.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Встроенный состав недоступен');
      const rosterBook = await response.json();
      const builtIn = rosterBook?.teams?.[String(teamId)] || [];
      const legacy = localStorage.getItem('legion-roster-v1');
      players = normalizeRoster(builtIn.length ? builtIn : legacy ? JSON.parse(legacy) : []);
    }
    loadedRosterTeamId = teamId;
    const positionOrder = { 'ЛН':1, 'ЦН':2, 'ПН':3, 'ПЗ':4, 'ЦП':5, 'ЛЗ':6, 'ЦЗ':7, 'ГК':8 };
    players.sort((a, b) => {
      const orderA = positionOrder[a.position] || 99;
      const orderB = positionOrder[b.position] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.number - b.number;
    });
    if (elements.rosterCount) elements.rosterCount.textContent = players.length ? `${players.length} игроков` : 'Не загружен';
  } catch (e) {
    console.error('❌ Ошибка загрузки игроков:', e);
    players = []; // fallback
    toast('❌ Ошибка загрузки игроков', 'error');
  }
}

function openGoalModal() {
  if (!players.length) {
    if (state.dataMode === MATCH_MODES.KIMBERLY_FULL) {
      toast('Состав выбранной команды недоступен', 'error');
      return;
    }
    goalWithoutPlayerFromModal();
    return;
  }
  if (!elements.goalModal.classList.contains('hidden')) return;
  elements.goalModal.classList.remove('hidden');
}

function selectScorerAndGoal(player) {
  withLock(async () => {
    const scoreIsManual = state.dataMode === MATCH_MODES.MANUAL;
    if (scoreIsManual) state.legionScore++;
    if (elements.admin.sh) elements.admin.sh.value = state.legionScore;
    if (!state.goals) state.goals = [];
    const goalData = {
      team: 'legion',
      number: player.number,
      lastName: player.lastName.toUpperCase(),
      minute: Math.floor(currentTimerSeconds / 60)
    };
    state.goals.push(goalData);
    const patch = { goals: state.goals };
    if (scoreIsManual) patch.legionScore = state.legionScore;
    await update(ref(db, DB_KEY), patch);
    const liveGoalData = {
        team: 'legion',
        scorer: {
          lastName: player.lastName,
          number: player.number,
          position: player.position,
          photoUrl: player.photoUrl || '',
          photoPosition: player.photoPosition || '50% 16%'
        },
        minute: Math.floor(currentTimerSeconds / 60),
        timestamp: Date.now()
      };
    await set(ref(db, 'live_goal'), liveGoalData);
    setTimeout(() => set(ref(db, 'live_goal'), null).catch(console.error), 8000);
    elements.goalModal.classList.add('hidden');
    toast('⚽ Гол!');
  });
}

function goalWithoutPlayerFromModal() {
  withLock(async () => {
    if (state.dataMode === MATCH_MODES.KIMBERLY_FULL) return;
    const scoreIsManual = state.dataMode === MATCH_MODES.MANUAL;
    if (scoreIsManual) state.legionScore++;
    if (elements.admin.sh) elements.admin.sh.value = state.legionScore;
    if (!state.goals) state.goals = [];
    state.goals.push({
      team: 'legion',
      minute: Math.floor(currentTimerSeconds / 60)
    });
    const patch = { goals: state.goals };
    if (scoreIsManual) patch.legionScore = state.legionScore;
    await update(ref(db, DB_KEY), patch);
    // Без состава нельзя определить автора и показать его карточку, но счёт
    // обязан обновляться — это основной быстрый сценарий ближайших матчей.
    elements.goalModal?.classList.add('hidden');
    toast('⚽ Гол!');
  });
}

function renderPlayerButtons() {
  if (!elements.scorerButtons) return;
  elements.scorerButtons.innerHTML = '';
  players.forEach(player => {
    const btn = document.createElement('button');
    btn.className = 'player-btn';
    const number = document.createElement('span');
    number.className = 'player-number-badge';
    number.textContent = String(player.number ?? '-');
    const name = document.createElement('span');
    name.textContent = String(player.shortName || player.lastName || 'Игрок');
    btn.append(number, name);
    btn.addEventListener('click', () => selectScorerAndGoal(player));
    elements.scorerButtons.appendChild(btn);
  });
}

// ===== СЛУШАТЕЛЬ ИЗМЕНЕНИЙ В FIREBASE =====
const dataRef = ref(db, DB_KEY);
onValue(dataRef, (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  state = { ...state, ...sanitizeRemoteState(data, state) };

  // Old versions persisted a new elapsed value every second. Give an already
  // running legacy timer one shared anchor once, so it keeps moving after an
  // upgrade without asking the operator to pause and start it again.
  const kimberlyOwnsClock = state.dataMode === MATCH_MODES.KIMBERLY_FULL && state.kimberly?.clockAvailable;
  if (ADMIN && adminAuthorized && state.timer.running && !state.timer.startedAt && !kimberlyOwnsClock && !timerAnchorMigrationPending) {
    timerAnchorMigrationPending = true;
    update(ref(db, DB_KEY), {
      timer: { running: true, elapsed: state.timer.elapsed, startedAt: Date.now() }
    }).catch(error => console.error('Timer anchor migration failed', error))
      .finally(() => { timerAnchorMigrationPending = false; });
  }

  currentTimerSeconds = getTimerElapsed();

  if (!ADMIN) {
    updateAllVariants();
    updateVisibility();
    applyColorTheme();
    applyOverlayPosition();
    updateAnimCheckbox();
  } else {
    updateAdminPanel();
  }
  if (state.timer.running && !timerUpdateInterval) startTimerUpdate();
  else if (!state.timer.running && timerUpdateInterval) stopTimerUpdate();
  updateTimerDisplay();
  updateDebugInfo();
}, (error) => {
  console.error('Firebase subscription failed', error);
});

// ===== ОБНОВЛЕНИЕ ВСЕХ ВАРИАНТОВ ТАБЛО =====
function updateAllVariants() {
  const opponentLogoSrc = state.opponentLogo || DEFAULT_OPPONENT_LOGO;
  ['v1', 'v2', 'v3'].forEach(v => {
    if (elements[v].lh) elements[v].lh.src = LEGION_LOGO;
    setImageWithFallback(elements[v].la, opponentLogoSrc);
    if (elements[v].nh) elements[v].nh.textContent = 'ЛЕГИОН';
    if (elements[v].na) renderTeamName(elements[v].na, state.opponentName);
    if (elements[v].sh) elements[v].sh.textContent = state.legionScore;
    if (elements[v].sa) elements[v].sa.textContent = state.opponentScore;
    if (elements[v].p) elements[v].p.textContent = state.period;
    // Не устанавливаем здесь время – только в updateTimerDisplay
  });

  if (state.opponentLogo === '') {
    if (elements.v1.la) elements.v1.la.classList.add('away');
    if (elements.v2.la) elements.v2.la.classList.add('away');
  } else {
    if (elements.v1.la) elements.v1.la.classList.remove('away');
    if (elements.v2.la) elements.v2.la.classList.remove('away');
  }

  if (state.opponentLogo === '') {
    if (elements.v3.la) elements.v3.la.classList.add('default-logo');
  } else {
    if (elements.v3.la) elements.v3.la.classList.remove('default-logo');
  }

  updateTimerDisplay(); // вызовем после обновления счёта
  updateV3Width();
}

function updateV3Width() {
  const maxLen = Math.max(7, state.opponentName.length);
  const stripWidth = Math.min(Math.max(maxLen * 13 + 30, 140), 220);
  if (elements.sbV3) elements.sbV3.style.setProperty('--strip-width', stripWidth + 'px');
}

function updateTimerDisplay() {
  const m = Math.floor(currentTimerSeconds / 60);
  const s = currentTimerSeconds % 60;
  const timeStr = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  if (elements.v1.t) elements.v1.t.textContent = timeStr;
  if (elements.v2.t) elements.v2.t.textContent = timeStr;
  if (elements.v3.t) elements.v3.t.textContent = timeStr;

  const paused = !state.timer.running;
  if (elements.v1.t) elements.v1.t.classList.toggle('paused', paused);
  if (elements.v2.t) elements.v2.t.classList.toggle('paused', paused);
  if (elements.v3.t) elements.v3.t.classList.toggle('paused', paused);
}

function updateVisibility() {
  if (elements.sbV1) elements.sbV1.classList.toggle('hide', state.designVariant !== 1);
  if (elements.sbV2) elements.sbV2.classList.toggle('hide', state.designVariant !== 2);
  if (elements.sbV3) elements.sbV3.classList.toggle('hide', state.designVariant !== 3);
}

function applyColorTheme() {
  document.body.classList.forEach(cls => {
    if (cls.startsWith('theme-')) document.body.classList.remove(cls);
  });
  document.body.classList.add('theme-' + state.colorTheme);
  document.body.style.setProperty('--custom-color', state.customColor || '#185c47');
  if (elements.sbV3) {
    elements.sbV3.className = elements.sbV3.className.replace(/theme-\w+/, '').trim();
    elements.sbV3.classList.add('theme-' + state.colorTheme);
  }
}

function getTimerElapsed(now = Date.now()) {
  const elapsed = Number.isFinite(state.timer?.elapsed) ? state.timer.elapsed : 0;
  const startedAt = state.timer?.startedAt;
  if (!state.timer?.running || !Number.isFinite(startedAt) || startedAt > now) return elapsed;
  return elapsed + Math.floor((now - startedAt) / 1000);
}

async function importRoster(file) {
  if (!file) return;
  try {
    const contents = await file.text();
    const imported = file.name.toLowerCase().endsWith('.csv')
      ? parseRosterCsv(contents)
      : normalizeRoster(JSON.parse(contents));
    if (!imported.length) throw new Error('В файле нет игроков');
    players = imported;
    const teamId = Number(state.kimberly?.teamId) || 17986;
    localStorage.setItem(`legion-roster-v1-${teamId}`, JSON.stringify(imported));
    renderPlayerButtons();
    updateGoalCardAvailability();
    if (elements.rosterCount) elements.rosterCount.textContent = `${players.length} игроков`;
    toast(`Состав импортирован: ${players.length}`);
  } catch (error) {
    toast(`❌ ${error.message || 'Не удалось импортировать состав'}`, 'error');
  } finally {
    if (elements.rosterInput) elements.rosterInput.value = '';
  }
}

function applyOverlayPosition() {
  document.body.classList.toggle('overlay-left', state.overlayPosition === 'left');
}

function renderModeSelection(mode) {
  const selectedMode = Object.values(MATCH_MODES).includes(mode) ? mode : MATCH_MODES.MANUAL;
  if (elements.sourceCard) elements.sourceCard.dataset.sourceMode = selectedMode;
  elements.modeChoices?.forEach(button => {
    button.classList.toggle('act', button.dataset.mode === selectedMode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === selectedMode));
  });
  if (elements.saveModeBtn) {
    const changed = (adminDraft.mode !== null && adminDraft.mode !== state.dataMode) || adminDraft.kimberlyDirty;
    elements.saveModeBtn.textContent = changed ? 'Включить выбранный режим' : 'Режим включён';
    elements.saveModeBtn.classList.toggle('is-pending', changed);
    elements.saveModeBtn.disabled = !changed;
  }
}

function updateGoalCardAvailability() {
  const checkbox = elements.admin.goalCardChk;
  const hasRoster = players.length > 0 || state.dataMode === MATCH_MODES.KIMBERLY_FULL;
  let hint = document.getElementById('goal-card-hint');
  if (!hint && checkbox) {
    hint = document.createElement('p'); hint.id = 'goal-card-hint'; hint.className = 'mode-help';
    checkbox.closest('.preview-row').after(hint);
    checkbox.setAttribute('aria-describedby', hint.id);
  }
  if (hint) { hint.hidden = hasRoster; hint.textContent = 'Для ручной карточки гола импортируйте игроков во вкладке «Состав».'; }
  if (checkbox) {
    checkbox.disabled = !hasRoster;
    // The stored preference may be on, but a card cannot be created without
    // a local player list and its portrait data.
    if (!hasRoster) checkbox.checked = false;
    checkbox.closest('.switch')?.classList.toggle('is-disabled', !hasRoster);
    checkbox.closest('.switch')?.setAttribute('title', hasRoster ? '' : 'Сначала импортируйте состав');
  }
  if (elements.goalPreviewBtn) {
    elements.goalPreviewBtn.disabled = !hasRoster;
    elements.goalPreviewBtn.title = hasRoster ? '' : 'Предпросмотр доступен после импорта состава';
  }
}

function updateAdminPanel() {
  // Firebase may update every second while the operator is editing. Draft fields
  // are never overwritten until they are explicitly saved.
  if (!adminDraft.opponentDirty && document.activeElement !== elements.admin.na && elements.admin.na) {
    elements.admin.na.value = state.opponentName;
  }
  if (!adminDraft.opponentDirty && document.activeElement !== elements.admin.la && elements.admin.la) {
    elements.admin.la.value = state.opponentLogo;
  }
  if (document.activeElement !== elements.admin.p && elements.admin.p) {
    elements.admin.p.value = state.period;
  }
  if (!adminDraft.scoreDirty && elements.admin.sh) elements.admin.sh.value = state.legionScore;
  if (!adminDraft.scoreDirty && elements.admin.sa) elements.admin.sa.value = state.opponentScore;
  if (elements.admin.goalCardChk) elements.admin.goalCardChk.checked = state.goalCardEnabled;
  updateGoalCardAvailability();
  if (elements.admin.customColor && document.activeElement !== elements.admin.customColor) {
    elements.admin.customColor.value = state.customColor || '#185c47';
  }
  if (adminDraft.mode === null && elements.dataMode) elements.dataMode.value = state.dataMode;
  renderModeSelection(adminDraft.mode || state.dataMode);
  if (!adminDraft.kimberlyDirty && elements.kimberlyTeamId && document.activeElement !== elements.kimberlyTeamId) {
    elements.kimberlyTeamId.value = state.kimberly?.teamId || DEFAULT_TEAM_ID;
  }
  if (ADMIN && loadedRosterTeamId !== Number(state.kimberly?.teamId)) {
    loadPlayers().then(() => { renderPlayerButtons(); updateGoalCardAvailability(); }).catch(console.error);
  }
  const policy = controlPolicy(state.dataMode);
  if (state.manualOverrides?.score) policy.score = 'override';
  if (state.manualOverrides?.opponent) policy.opponent = 'override';
  if (elements.adminContent) elements.adminContent.dataset.mode = state.dataMode;
  if (elements.activeModeLabel) {
    elements.activeModeLabel.textContent = state.dataMode === MATCH_MODES.MANUAL
      ? 'Вручную'
      : 'Авто + оператор';
  }
  document.querySelectorAll('[data-source-key]').forEach(badge => {
    const source = policy[badge.dataset.sourceKey] || 'manual';
    badge.textContent = sourceLabel(source);
    badge.dataset.source = source;
  });

  const sourceControlsScore = !['manual','override'].includes(policy.score);
  if (elements.admin.sh) elements.admin.sh.disabled = sourceControlsScore;
  if (elements.admin.sa) elements.admin.sa.disabled = sourceControlsScore;
  const updateScoreButton = document.getElementById('updateScoreBtn');
  const resetScoreButton = document.getElementById('resetScoreBtn');
  if (updateScoreButton) updateScoreButton.disabled = sourceControlsScore;
  if (resetScoreButton) resetScoreButton.disabled = sourceControlsScore;
  const scoreOverrideButton = document.getElementById('scoreOverrideBtn');
  if (scoreOverrideButton) {
    scoreOverrideButton.hidden = state.dataMode === MATCH_MODES.MANUAL;
    scoreOverrideButton.textContent = state.manualOverrides?.score ? 'Вернуть счёт Kimberly' : 'Исправить вручную';
  }
  const opponentOverrideButton = document.getElementById('opponentOverrideBtn');
  if (opponentOverrideButton) {
    opponentOverrideButton.hidden = state.dataMode === MATCH_MODES.MANUAL;
    opponentOverrideButton.textContent = state.manualOverrides?.opponent ? 'Вернуть данные Kimberly' : 'Исправить вручную';
  }
  const opponentOwned = !['manual','override'].includes(policy.opponent);
  if (elements.admin.na) elements.admin.na.disabled = opponentOwned;
  if (elements.admin.la) elements.admin.la.disabled = opponentOwned;
  const saveOpponentButton = document.getElementById('saveOpponentBtn');
  if (saveOpponentButton) saveOpponentButton.disabled = opponentOwned;
  const fullMode = policy.goals === 'kimberly';
  const legionGoalButton = document.getElementById('goalLegionBtn');
  const opponentGoalButton = document.getElementById('goalOpponentBtn');
  if (legionGoalButton) {
    legionGoalButton.disabled = false;
    legionGoalButton.textContent = fullMode ? 'Указать автора вручную' : 'Гол Легион';
  }
  if (opponentGoalButton) opponentGoalButton.disabled = fullMode;
  const goalControls = document.querySelector('[data-control="goals"] .btns');
  if (goalControls) goalControls.hidden = false;
  const clockOwnedByKimberly = policy.clock === 'kimberly';
  ['timerStartBtn', 'timerPauseBtn', 'timerResetBtn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = clockOwnedByKimberly;
  });
  const clockControls = document.querySelector('[data-control="clock"] .btns');
  if (clockControls) clockControls.hidden = clockOwnedByKimberly;
  const periodOwnedByKimberly = policy.period === 'kimberly';
  if (elements.admin.p) {
    elements.admin.p.disabled = periodOwnedByKimberly;
    elements.admin.p.closest('.fld')?.toggleAttribute('hidden', periodOwnedByKimberly);
  }
  const updatePeriodButton = document.getElementById('updatePeriodBtn');
  if (updatePeriodButton) {
    updatePeriodButton.disabled = periodOwnedByKimberly;
    updatePeriodButton.hidden = periodOwnedByKimberly;
  }

  if (elements.admin.varBtns) {
    elements.admin.varBtns.forEach((btn, i) => {
      btn.classList.toggle('act', i + 1 === state.designVariant);
    });
  }
  if (elements.admin.colBtns) {
    elements.admin.colBtns.forEach(btn => {
      btn.classList.toggle('act', btn.dataset.color === state.colorTheme);
    });
  }
  elements.admin.positionBtns?.forEach(btn => {
    btn.classList.toggle('act', btn.dataset.position === state.overlayPosition);
  });

  if (state.timer.running) {
    if (elements.admin.tmInd) elements.admin.tmInd.classList.add('run');
    if (elements.admin.tmTxt) elements.admin.tmTxt.textContent = 'Запущен';
  } else {
    if (elements.admin.tmInd) elements.admin.tmInd.classList.remove('run');
    if (elements.admin.tmTxt) elements.admin.tmTxt.textContent = 'Остановлен';
  }
}

function setSyncStatus(message, type = '') {
  if (!elements.syncStatus) return;
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.remove('ok', 'error');
  if (type) elements.syncStatus.classList.add(type);
}

function stopKimberlySync() {
  if (kimberlyInterval) clearTimeout(kimberlyInterval);
  kimberlyInterval = null;
  lastKimberlyGame = null;
}

function scheduleKimberlySync(delay) {
  if (kimberlyInterval) clearTimeout(kimberlyInterval);
  if (state.dataMode === MATCH_MODES.MANUAL || !adminAuthorized) return;
  kimberlyInterval = setTimeout(() => syncKimberly().catch(console.error), delay);
}

async function publishKimberlyGoal(goal) {
  if (goal.team !== 'legion') return;
  await set(ref(db, 'live_goal'), {
    team: 'legion',
    scorer: goal.playerName ? {
      lastName: goal.lastName || goal.playerName,
      number: goal.number,
      position: goal.position || '',
      photoUrl: goal.photoUrl || ''
    } : null,
    minute: goal.minute,
    timestamp: Date.now()
  });
  setTimeout(() => set(ref(db, 'live_goal'), null).catch(console.error), 8000);
}

async function syncKimberly() {
  setSyncStatus('Kimberly обновляется сервером, пока открыт оверлей.');
}

async function saveDataMode() {
  await withLock(async () => {
    const selected = elements.dataMode?.value || MATCH_MODES.MANUAL;
    const mode = selected === MATCH_MODES.KIMBERLY_SCORE ? MATCH_MODES.KIMBERLY_FULL : selected;
    const teamId = Number.parseInt(elements.kimberlyTeamId?.value, 10);
    if (!Object.values(MATCH_MODES).includes(mode)) throw new Error('Неизвестный режим');
    if (mode !== MATCH_MODES.MANUAL && (!Number.isInteger(teamId) || teamId <= 0)) {
      throw new Error('Укажите корректный Team ID');
    }

    stopKimberlySync();
    state.dataMode = mode;
    state.kimberly = teamId === state.kimberly.teamId
      ? {...state.kimberly, lastSyncAt:null, leaseAt:0, error:null}
      : { teamId: teamId || DEFAULT_TEAM_ID, gameId: null, status: 'idle', lastSyncAt: null, error: null };
    state.manualOverrides = {score:false,opponent:false};
    await update(ref(db, DB_KEY), { dataMode: mode, kimberly: state.kimberly, manualOverrides:state.manualOverrides });
    adminDraft.mode = null;
    adminDraft.kimberlyDirty = false;
    updateAdminPanel();
    if (mode === MATCH_MODES.MANUAL) {
      setSyncStatus('Ручное управление');
      toast('Ручной режим включён');
    } else {
      await syncKimberly();
      toast('Режим Kimberly включён');
    }
  });
}

function updateAnimCheckbox() {
  if (elements.admin.goalCardChk) {
    elements.admin.goalCardChk.checked = state.goalCardEnabled;
  }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function validateImageUrl(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function toast(msg, type = 'success') {
  if (!elements.toast) return;
  if (typeof msg === 'string') elements.toast.textContent = msg;
  elements.toast.classList.remove('error');
  if (type === 'error') elements.toast.classList.add('error');
  elements.toast.classList.add('show');
  setTimeout(() => elements.toast.classList.remove('show'), 2000);
}

// ===== ДЕЙСТВИЯ С БЛОКИРОВКОЙ =====
function setVariant(variant) {
  withLock(async () => {
    if (state.designVariant === variant) return;
    state.designVariant = variant;
    await update(ref(db, DB_KEY), { designVariant: variant });
    toast('Вариант изменён');
  });
}

function setColor(color) {
  withLock(async () => {
    if (state.colorTheme === color) return;
    state.colorTheme = color;
    await update(ref(db, DB_KEY), { colorTheme: color });
    toast('Тема изменена');
  });
}

function setOverlayPosition(position) {
  if (!['left', 'center'].includes(position)) return;
  withLock(async () => {
    if (state.overlayPosition === position) return;
    state.overlayPosition = position;
    applyOverlayPosition();
    await update(ref(db, DB_KEY), { overlayPosition: position });
    toast(position === 'left' ? 'Плашка слева' : 'Плашка по центру');
  });
}

function toggleGoalCard() {
  if (!players.length && state.dataMode !== MATCH_MODES.KIMBERLY_FULL) {
    if (elements.admin.goalCardChk) elements.admin.goalCardChk.checked = false;
    toast('Сначала импортируйте состав для карточки гола', 'error');
    return;
  }
  withLock(async () => {
    state.goalCardEnabled = elements.admin.goalCardChk.checked;
    await update(ref(db, DB_KEY), { goalCardEnabled: state.goalCardEnabled });
    toast('Карточка гола ' + (state.goalCardEnabled ? 'включена' : 'выключена'));
  });
}

function setCustomColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  withLock(async () => {
    state.colorTheme = 'custom';
    state.customColor = color;
    applyColorTheme();
    await update(ref(db, DB_KEY), { colorTheme: 'custom', customColor: color });
    updateAdminPanel();
  });
}

async function saveOpponent() {
  const newName = elements.admin.na.value || 'СОПЕРНИК';
  const newLogo = elements.admin.la.value;

  if (newLogo) {
    const valid = await validateImageUrl(newLogo);
    if (!valid) {
      toast('Неверный URL логотипа', 'error');
      return;
    }
  }

  await withLock(async () => {
    state.opponentName = newName;
    state.opponentLogo = newLogo || '';
    await update(ref(db, DB_KEY), { opponentName: newName, opponentLogo: newLogo || '' });
    adminDraft.opponentDirty = false;
    toast('Соперник сохранён');
  });
}

function toggleManualOverride(field) {
  if (!['score','opponent'].includes(field) || state.dataMode === MATCH_MODES.MANUAL) return;
  withLock(async () => {
    state.manualOverrides = {...(state.manualOverrides || {}), [field]: !state.manualOverrides?.[field]};
    await update(ref(db, DB_KEY), { manualOverrides: state.manualOverrides });
    adminDraft.scoreDirty = false;
    adminDraft.opponentDirty = false;
    updateAdminPanel();
    toast(state.manualOverrides[field] ? 'Ручная коррекция включена' : 'Данные снова поступают из Kimberly');
  });
}

function updateScore() {
  withLock(async () => {
    state.legionScore = Math.max(0, parseInt(elements.admin.sh.value) || 0);
    state.opponentScore = Math.max(0, parseInt(elements.admin.sa.value) || 0);
    if (elements.admin.sh) elements.admin.sh.value = state.legionScore;
    if (elements.admin.sa) elements.admin.sa.value = state.opponentScore;
    await update(ref(db, DB_KEY), { legionScore: state.legionScore, opponentScore: state.opponentScore });
    adminDraft.scoreDirty = false;
    toast('Счёт обновлён');
  });
}

function adjustScore(side, delta) {
  if (controlPolicy(state.dataMode).score !== 'manual') {
    toast('Счёт сейчас ведёт Kimberly', 'error');
    return;
  }
  const input = side === 'legion' ? elements.admin.sh : elements.admin.sa;
  if (!input) return;
  input.value = String(Math.max(0, (Number.parseInt(input.value, 10) || 0) + delta));
  adminDraft.scoreDirty = true;
  updateScore();
}

function previewGoalCard() {
  const player = players.find(item => Number(item.id) === 56635)
    || players.find(item => item.lastName === 'Лисицин' && item.firstName === 'Даниил')
    || {
      id: 56635,
      firstName: 'Даниил',
      lastName: 'Лисицин',
      number: 35,
      position: 'ПН',
      photoUrl: 'https://api.kimberly-cup.ru/media/67653/1000494812.jpg',
      photoPosition: '50% 18%'
    };
  showGoalCard({
    team: 'legion',
    scorer: {
      lastName: player.lastName || player.shortName || 'Игрок',
      number: player.number,
      position: player.position,
      photoUrl: player.photoUrl || './data/player-placeholder.svg',
      photoPosition: player.photoPosition || '50% 16%'
    },
    minute: Math.floor(currentTimerSeconds / 60)
  }, { preview: true });
}

function resetScore() {
  withLock(async () => {
    state.legionScore = 0;
    state.opponentScore = 0;
    state.goals = [];
    if (elements.admin.sh) elements.admin.sh.value = 0;
    if (elements.admin.sa) elements.admin.sa.value = 0;
    await update(ref(db, DB_KEY), { legionScore: 0, opponentScore: 0, goals: [] });
    toast('Счёт сброшен');
  });
}

function quickGoal(team) {
  if (team === 'legion') {
    if (players.length) openGoalModal();
    else goalWithoutPlayerFromModal();
  } else {
    if (state.dataMode === MATCH_MODES.KIMBERLY_FULL) {
      toast('Гол соперника поступает из Kimberly', 'error');
      return;
    }
    withLock(async () => {
      const scoreIsManual = state.dataMode === MATCH_MODES.MANUAL;
      if (scoreIsManual) state.opponentScore++;
      if (elements.admin.sa) elements.admin.sa.value = state.opponentScore;
      if (scoreIsManual) await update(ref(db, DB_KEY), { opponentScore: state.opponentScore });
      toast('Гол соперника');
    });
  }
}

function startTimerUpdate() {
  if (timerUpdateInterval) clearInterval(timerUpdateInterval);
  timerUpdateInterval = setInterval(() => {
    currentTimerSeconds = getTimerElapsed();
    updateTimerDisplay();
  }, 250);
}

function stopTimerUpdate() {
  if (timerUpdateInterval) {
    clearInterval(timerUpdateInterval);
    timerUpdateInterval = null;
  }
}

function timerPause() {
  withLock(async () => {
    if (!state.timer.running) return;
    stopTimerUpdate();
    const elapsed = getTimerElapsed();
    state.timer = { running: false, elapsed, startedAt: null };
    currentTimerSeconds = elapsed;
    await update(ref(db, DB_KEY), { timer: state.timer });
    toast('Таймер остановлен');
  });
}

function timerStart() {
  withLock(async () => {
    if (state.timer.running) return;
    const startedAt = Date.now();
    state.timer = { running: true, elapsed: getTimerElapsed(), startedAt };
    currentTimerSeconds = state.timer.elapsed;
    startTimerUpdate();
    await update(ref(db), {
      [`${DB_KEY}/timer`]: state.timer,
      intro_trigger: { visible: false, time: Date.now() }
    });
    toast('Таймер запущен');
  });
}

function timerReset() {
  withLock(async () => {
    stopTimerUpdate();
    state.timer = { running: false, elapsed: 0, startedAt: null };
    currentTimerSeconds = 0;
    await update(ref(db, DB_KEY), { timer: state.timer });
    toast('Таймер сброшен');
  });
}

function updatePeriod() {
  withLock(async () => {
    const newPeriod = elements.admin.p.value;
    const previousPeriod = state.period;
    state.period = newPeriod;
    const transition = timerForPeriodTransition({
      previousPeriod,
      nextPeriod: newPeriod,
      timer: state.timer
    });

    if (transition.changed) {
      state.timer = transition.timer;
      currentTimerSeconds = state.timer.elapsed;
      if (state.timer.running) startTimerUpdate();
      else stopTimerUpdate();
      await update(ref(db, DB_KEY), { period: newPeriod, timer: state.timer });
    } else await update(ref(db, DB_KEY), { period: newPeriod });
    toast('Период обновлён');
  });
}

onValue(ref(db, 'live_goal'), (snapshot) => {
  const goal = snapshot.val();
  if (!goal || ADMIN) return;
  if (!state.goalCardEnabled) return;
  const now = Date.now();
  if (goal.timestamp && now - goal.timestamp > 10000) return;
  showGoalCard(goal);
});

function showGoalCard(goal, { preview = false } = {}) {
  if (!goal || !['legion','opponent'].includes(goal.team)) return;
  const opponentGoal = goal.team === 'opponent';
  // Очищаем предыдущий таймаут
  if (window.goalCardTimeout) {
    clearTimeout(window.goalCardTimeout);
    window.goalCardTimeout = null;
  }
  // Заполняем данные с проверкой наличия scorer
  if (elements.goalLastname) {
    elements.goalLastname.textContent = goal.scorer ? goal.scorer.lastName.toUpperCase() : (opponentGoal ? 'ГОЛ СОПЕРНИКА' : 'ГОЛ ЛЕГИОНА');
  }
  if (elements.goalNumber) {
    elements.goalNumber.textContent = goal.scorer ? goal.scorer.number : '-';
    elements.goalNumber.style.display = goal.scorer ? 'grid' : 'none';
  }
  if (elements.goalPosition) {
    if (goal.scorer && goal.scorer.position) {
      elements.goalPosition.textContent = goal.scorer.position;
      elements.goalPosition.style.display = 'inline-block';
    } else {
      elements.goalPosition.style.display = 'none';
    }
  }
  if (elements.goalMinuteDisplay) {
    elements.goalMinuteDisplay.textContent = goal.minute == null ? '' : `${goal.minute}'`;
  }
  if (elements.goalPlayerPhoto) {
    const photoUrl = safeImageUrl(goal.scorer?.photoUrl);
    elements.goalPlayerPhoto.classList.toggle('hidden', !photoUrl);
    elements.goalCardLogo?.classList.toggle('hidden', Boolean(photoUrl));
    if (photoUrl) {
      elements.goalPlayerPhoto.src = photoUrl;
      elements.goalPlayerPhoto.style.objectPosition = goal.scorer?.photoPosition || '50% 16%';
      elements.goalPlayerPhoto.onerror = () => {
        elements.goalPlayerPhoto.classList.add('hidden');
        elements.goalCardLogo?.classList.remove('hidden');
      };
    } else {
      elements.goalPlayerPhoto.removeAttribute('src');
    }
  }
  if (elements.goalCardLogo) {
    elements.goalCardLogo.src = safeImageUrl(goal.teamLogo) || (opponentGoal ? safeImageUrl(state.opponentLogo) || DEFAULT_OPPONENT_LOGO : LEGION_LOGO);
  }
  if (elements.goalCard) {
    elements.goalCard.classList.toggle('opponent-goal', opponentGoal);
    elements.goalCard.classList.toggle('previewing', preview);
    elements.goalCard.classList.remove('hidden');
    setTimeout(() => elements.goalCard.classList.add('show'), 10);
    window.goalCardTimeout = setTimeout(() => {
      if (elements.goalCard) {
        elements.goalCard.classList.remove('show');
        setTimeout(() => elements.goalCard.classList.add('hidden'), 400);
      }
      window.goalCardTimeout = null;
    }, PREVIEW?.startsWith('goal') ? 60_000 : preview ? 5_000 : 5_000);
  }
}

onValue(ref(db, 'intro_trigger'), (snapshot) => {
  const trigger = snapshot.val();
  if (!trigger || ADMIN) return;
  if (trigger.visible === false) {
    hideIntro();
    return;
  }
  const now = Date.now();
  if (trigger.time && now - trigger.time > 10000) return;
  if (trigger.type === 'first_half') showIntro('1 ТАЙМ', null);
  else if (trigger.type === 'second_half') showIntro('2 ТАЙМ', null);
});

function bindAdminEvents() {
  if (adminInitialized) return;
  adminInitialized = true;
  document.querySelectorAll('.var-btn[data-variant]').forEach(btn => {
    btn.addEventListener('click', () => setVariant(Number.parseInt(btn.dataset.variant, 10)));
  });
  document.querySelectorAll('.col-btn').forEach(btn => {
    btn.addEventListener('click', () => setColor(btn.dataset.color));
  });
  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.addEventListener('click', () => setOverlayPosition(btn.dataset.position));
  });
  elements.modeChoices?.forEach(button => {
    button.addEventListener('click', () => {
      adminDraft.mode = button.dataset.mode;
      if (elements.dataMode) elements.dataMode.value = button.dataset.mode;
      renderModeSelection(button.dataset.mode);
    });
  });
  [elements.kimberlyTeamId].forEach(input => input?.addEventListener('input', () => {
    adminDraft.kimberlyDirty = true;
    renderModeSelection(adminDraft.mode || state.dataMode);
  }));
  [elements.admin.sh, elements.admin.sa].forEach(input => input?.addEventListener('input', () => {
    adminDraft.scoreDirty = true;
  }));
  [elements.admin.na, elements.admin.la].forEach(input => input?.addEventListener('input', () => {
    adminDraft.opponentDirty = true;
  }));
  elements.admin.goalCardChk?.addEventListener('change', toggleGoalCard);
  elements.admin.customColor?.addEventListener('input', event => setCustomColor(event.target.value));
  document.getElementById('saveOpponentBtn')?.addEventListener('click', saveOpponent);
  document.getElementById('opponentOverrideBtn')?.addEventListener('click', () => toggleManualOverride('opponent'));
  document.getElementById('updateScoreBtn')?.addEventListener('click', updateScore);
  document.getElementById('scoreOverrideBtn')?.addEventListener('click', () => toggleManualOverride('score'));
  document.querySelectorAll('[data-score-side][data-score-delta]').forEach(button => {
    button.addEventListener('click', () => adjustScore(button.dataset.scoreSide, Number(button.dataset.scoreDelta)));
  });
  document.getElementById('resetScoreBtn')?.addEventListener('click', resetScore);
  document.getElementById('timerStartBtn')?.addEventListener('click', timerStart);
  document.getElementById('timerPauseBtn')?.addEventListener('click', timerPause);
  document.getElementById('timerResetBtn')?.addEventListener('click', timerReset);
  document.getElementById('updatePeriodBtn')?.addEventListener('click', updatePeriod);
  document.getElementById('goalLegionBtn')?.addEventListener('click', () => quickGoal('legion'));
  document.getElementById('goalOpponentBtn')?.addEventListener('click', () => quickGoal('opponent'));
  elements.goalWithoutPlayerBtn?.addEventListener('click', goalWithoutPlayerFromModal);
  elements.saveModeBtn?.addEventListener('click', saveDataMode);
  elements.syncNowBtn?.addEventListener('click', () => syncKimberly());
  elements.rosterInput?.addEventListener('change', event => importRoster(event.target.files?.[0]));
  elements.goalPreviewBtn?.addEventListener('click', previewGoalCard);
  document.getElementById('showIntro1Btn')?.addEventListener('click', () => {
    set(ref(db, 'intro_trigger'), { type: 'first_half', visible: true, time: Date.now() })
      .then(() => toast('Заставка 1 тайма включена'))
      .catch(() => toast('Ошибка отправки', 'error'));
  });
  document.getElementById('showIntro2Btn')?.addEventListener('click', () => {
    set(ref(db, 'intro_trigger'), { type: 'second_half', visible: true, time: Date.now() })
      .then(() => toast('Заставка 2 тайма включена'))
      .catch(() => toast('Ошибка отправки', 'error'));
  });
  document.getElementById('hideIntroBtn')?.addEventListener('click', () => {
    set(ref(db, 'intro_trigger'), { visible: false, time: Date.now() })
      .then(() => toast('Заставка скрыта'))
      .catch(() => toast('Ошибка отправки', 'error'));
  });
  elements.goalModal?.addEventListener('click', event => {
    if (event.target === elements.goalModal) elements.goalModal.classList.add('hidden');
  });
}

async function initializeAuthorizedAdmin() {
  adminAuthorized = true;
  elements.adminContent.hidden = false;
  bindAdminEvents();
  await loadPlayers();
  renderPlayerButtons();
  updateAdminPanel();
  if (state.dataMode !== MATCH_MODES.MANUAL) await syncKimberly();
}

async function connectLocalAdmin() {
  try {
    const response = await fetch('/api/match?session=1', { cache: 'no-store' });
    if (!response.ok) throw new Error('Откройте секретную ссылку входа');
    await initializeAuthorizedAdmin();
  } catch (error) {
    console.error('Local admin connection failed', error);
    elements.adminContent.hidden = false;
    toast('Не удалось подключить управление', 'error');
  }
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
if (ADMIN) {
  document.body.classList.remove('broadcast-output');
  [elements.sbV1, elements.sbV2, elements.sbV3].forEach(element => element?.classList.add('hide'));
  document.getElementById('admin')?.classList.remove('hide');
  initializeAdminTheme();
  connectLocalAdmin();
} else {
  document.body.classList.add('broadcast-output');
  if (elements.goalCard) elements.goalCard.classList.add('hidden');
  updateAllVariants();
  updateVisibility();
  applyColorTheme();
  applyOverlayPosition();
  setInterval(updateRealTime, 60000);
  updateRealTime();
  if (PREVIEW === 'goal') {
    setTimeout(() => showGoalCard({
      team: 'legion',
      teamLogo: './data/legion-logo.svg',
      scorer: { lastName: 'Лисицин', number: 35, position: 'ПН', photoUrl: 'https://api.kimberly-cup.ru/media/67653/1000494812.jpg', photoPosition: '50% 18%' },
      minute: 18
    }, { preview: true }), 400);
  } else if (PREVIEW === 'goal-opponent') {
    setTimeout(() => showGoalCard({
      team: 'opponent',
      teamName: 'СОПЕРНИК',
      teamLogo: './data/default-opponent.svg',
      scorer: null,
      minute: 24
    }, { preview: true }), 400);
  } else if (PREVIEW === 'intro') {
    setTimeout(() => showIntro('1 ТАЙМ', 60_000), 400);
  }
}

window.addEventListener('beforeunload', () => {
  if (timerUpdateInterval) clearInterval(timerUpdateInterval);
  stopKimberlySync();
});
