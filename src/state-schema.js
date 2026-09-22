import { MATCH_MODES } from './match-mode.js';

const PERIODS = new Set(['1 ТАЙМ', '2 ТАЙМ', 'ПЕРЕРЫВ', 'ДОП. ТАЙМ', 'ПЕНАЛЬТИ']);
const THEMES = new Set(['blue', 'orange', 'purple', 'silver', 'red', 'green', 'classic1', 'classic2', 'custom']);

function integer(value, fallback = 0, maximum = 99) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : fallback;
}

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 4102444800000 ? Math.floor(parsed) : null;
}

function shortText(value, fallback, maximum = 60) {
  if (typeof value !== 'string') return fallback;
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return result ? result.slice(0, maximum) : fallback;
}

function httpsUrl(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

function goal(value) {
  if (!value || typeof value !== 'object') return null;
  const team = value.team === 'opponent' ? 'opponent' : 'legion';
  return {
    team,
    number: value.number == null ? null : integer(value.number, 0, 999),
    lastName: shortText(value.lastName, '', 80),
    minute: value.minute == null ? null : integer(value.minute, 0, 999)
  };
}

export function sanitizeRemoteState(data, fallback) {
  const source = data && typeof data === 'object' ? data : {};
  const previous = fallback && typeof fallback === 'object' ? fallback : {};
  const legacyTimer = source.timer === undefined && source.timerSeconds !== undefined
    ? { running: source.timerRunning === true, elapsed: source.timerSeconds }
    : source.timer;
  const timer = legacyTimer && typeof legacyTimer === 'object' ? legacyTimer : previous.timer || {};
  const dataMode = source.dataMode === MATCH_MODES.KIMBERLY_SCORE
    ? MATCH_MODES.KIMBERLY_FULL
    : Object.values(MATCH_MODES).includes(source.dataMode) ? source.dataMode : MATCH_MODES.MANUAL;
  const kimberly = source.kimberly && typeof source.kimberly === 'object' ? source.kimberly : {};
  const manualOverrides = source.manualOverrides && typeof source.manualOverrides === 'object' ? source.manualOverrides : {};

  return {
    opponentName: shortText(source.opponentName, 'СОПЕРНИК'),
    opponentLogo: httpsUrl(source.opponentLogo, ''),
    legionScore: integer(source.legionScore),
    opponentScore: integer(source.opponentScore),
    timer: {
      running: timer.running === true,
      elapsed: integer(timer.elapsed, 0, 24 * 60 * 60),
      startedAt: timestamp(timer.startedAt)
    },
    period: PERIODS.has(source.period) ? source.period : '1 ТАЙМ',
    designVariant: [1, 2, 3].includes(Number(source.designVariant)) ? Number(source.designVariant) : 3,
    overlayPosition: source.overlayPosition === 'left' ? 'left' : 'center',
    colorTheme: THEMES.has(source.colorTheme) ? source.colorTheme : 'green',
    customColor: /^#[0-9a-f]{6}$/i.test(source.customColor) ? source.customColor : '#185c47',
    goalCardEnabled: source.goalCardEnabled ?? source.logoAnimEnabled ?? true,
    goals: (Array.isArray(source.goals) ? source.goals : []).slice(-100).map(goal).filter(Boolean),
    dataMode,
    manualOverrides: {
      score: manualOverrides.score === true,
      opponent: manualOverrides.opponent === true
    },
    kimberly: {
      pinned: kimberly.pinned === true,
      teamId: integer(kimberly.teamId, 17509, Number.MAX_SAFE_INTEGER) || 17509,
      gameId: kimberly.gameId == null ? null : integer(kimberly.gameId, 0, Number.MAX_SAFE_INTEGER) || null,
      status: shortText(kimberly.status, 'idle', 30),
      scheduledAt: shortText(kimberly.scheduledAt, '', 40),
      legionTeamName: shortText(kimberly.legionTeamName, '', 80),
      tournamentName: shortText(kimberly.tournamentName, '', 100),
      leagueName: shortText(kimberly.leagueName, '', 100),
      divisionName: shortText(kimberly.divisionName, '', 40),
      venueName: shortText(kimberly.venueName, '', 100),
      venueAddress: shortText(kimberly.venueAddress, '', 160),
      lastSyncAt: kimberly.lastSyncAt == null ? null : integer(kimberly.lastSyncAt, 0, Number.MAX_SAFE_INTEGER),
      error: kimberly.error == null ? null : shortText(kimberly.error, '', 200),
      clockAvailable: kimberly.clockAvailable === true,
      periodAvailable: kimberly.periodAvailable === true,
      hasLegionRoster: kimberly.hasLegionRoster === true
    }
  };
}
