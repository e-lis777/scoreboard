export const MATCH_MODES = Object.freeze({
  MANUAL: 'manual',
  KIMBERLY_FULL: 'kimberly_full',
  KIMBERLY_SCORE: 'kimberly_score'
});

const ACTIVE_STATUSES = new Set(['started', 'paused']);

function asNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function teamLogo(team) {
  // Kimberly thumbnails are often square-cropped and cut wide crests.
  // Prefer the original asset and let the overlay contain it safely.
  return team?.school?.avatar?.url || team?.school?.avatar?.conversion || '';
}

function teamName(team) {
  return String(team?.name || team?.school?.name || 'СОПЕРНИК').trim();
}

function scorerName(player) {
  if (!player) return '';
  return [player.first_name, player.last_name].filter(Boolean).join(' ').trim();
}

function timestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value).replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveKimberlyClock(game, now = Date.now()) {
  const start = timestamp(game?.actual_start_time);
  if (!start) return { available: false, elapsed: 0, running: false };
  const finish = timestamp(game?.actual_finish_time);
  const end = finish || now;
  let pausedMs = 0;
  for (const pause of Array.isArray(game?.pauses) ? game.pauses : []) {
    const pauseStart = timestamp(pause?.started_at || pause?.start || pause?.created_at);
    const pauseEnd = timestamp(pause?.finished_at || pause?.end || pause?.updated_at) || end;
    if (pauseStart && pauseEnd > pauseStart) pausedMs += pauseEnd - pauseStart;
  }
  return {
    available: true,
    elapsed: Math.max(0, Math.floor((end - start - pausedMs) / 1000)),
    running: !finish && String(game?.status || '') === 'started'
  };
}

function gamePeriod(game) {
  const raw = String(game?.period || game?.half || '').toLowerCase();
  if (['1', 'first', 'first_half', '1_half'].includes(raw)) return '1 ТАЙМ';
  if (['2', 'second', 'second_half', '2_half'].includes(raw)) return '2 ТАЙМ';
  if (String(game?.status || '') === 'paused') return 'ПЕРЕРЫВ';
  return null;
}

function flattenGoals(players, side) {
  const result = [];
  for (const entry of Array.isArray(players) ? players : []) {
    if (!entry?.player || !Array.isArray(entry.goals)) continue;
    const occurrences = new Map();
    for (const rawMinute of entry.goals) {
      const minute = asNonNegativeInteger(rawMinute);
      const occurrence = (occurrences.get(minute) || 0) + 1;
      occurrences.set(minute, occurrence);
      const player = entry.player;
      result.push({
        key: `${side}:${player.id}:${minute}:${occurrence}`,
        side,
        playerId: player.id,
        playerName: scorerName(player),
        lastName: String(player.last_name || '').trim(),
        number: entry.number ?? null,
        position: entry.position || '',
        photoUrl: player?.avatar?.conversion || player?.avatar?.url || '',
        minute
      });
    }
  }
  return result.sort((a, b) => a.minute - b.minute || a.key.localeCompare(b.key));
}

export function normalizeKimberlyGame(game, trackedTeamId) {
  const teamId = asNonNegativeInteger(trackedTeamId);
  if (!game || !teamId) throw new TypeError('Game and a numeric team id are required');

  const trackedIsTeam1 = asNonNegativeInteger(game.team_1_id) === teamId;
  const trackedIsTeam2 = asNonNegativeInteger(game.team_2_id) === teamId;
  if (!trackedIsTeam1 && !trackedIsTeam2) {
    throw new RangeError(`Team ${teamId} does not participate in game ${game.id}`);
  }

  const trackedSide = trackedIsTeam1 ? 'team_1' : 'team_2';
  const opponentSide = trackedIsTeam1 ? 'team_2' : 'team_1';
  const allGoals = [
    ...flattenGoals(game.team_1_players, 'team_1'),
    ...flattenGoals(game.team_2_players, 'team_2')
  ];

  return {
    gameId: asNonNegativeInteger(game.id),
    status: String(game.status || 'unknown'),
    scheduledAt: game.started_at || null,
    actualStartTime: game.actual_start_time || null,
    actualFinishTime: game.actual_finish_time || null,
    pauses: Array.isArray(game.pauses) ? game.pauses : [],
    clock: deriveKimberlyClock(game),
    period: gamePeriod(game),
    trackedSide,
    opponentSide,
    legionScore: asNonNegativeInteger(game[`${trackedSide}_goals`]),
    opponentScore: asNonNegativeInteger(game[`${opponentSide}_goals`]),
    legionTeam: game[trackedSide] || null,
    opponentTeam: game[opponentSide] || null,
    opponentName: teamName(game[opponentSide]),
    opponentLogo: teamLogo(game[opponentSide]),
    legionTeamName: teamName(game[trackedSide]),
    tournamentName: String(game?.tournament?.name || '').trim(),
    leagueName: String(game?.league?.name || '').trim(),
    divisionName: String(game?.division?.name || game?.[trackedSide]?.division?.name || '').trim(),
    venueName: String(game?.stadium?.title || '').trim(),
    venueAddress: String(game?.stadium?.address || '').trim(),
    goals: allGoals.map(goal => ({
      ...goal,
      team: goal.side === trackedSide ? 'legion' : 'opponent'
    })),
    hasLegionRoster: Array.isArray(game[`${trackedSide}_players`]) &&
      game[`${trackedSide}_players`].some(item => item?.player),
    isActive: ACTIVE_STATUSES.has(String(game.status || '')),
    raw: game
  };
}

export function detectNewGoalEvents(previous, current) {
  if (!current) return [];
  const previousKeys = new Set(previous?.goals?.map(goal => goal.key) || []);
  const detailed = current.goals.filter(goal => !previousKeys.has(goal.key));
  if (detailed.length) return detailed;

  const events = [];
  const legionDelta = Math.max(0, current.legionScore - (previous?.legionScore ?? current.legionScore));
  const opponentDelta = Math.max(0, current.opponentScore - (previous?.opponentScore ?? current.opponentScore));
  for (let index = 0; index < legionDelta; index += 1) {
    events.push({ key: `legion-score-${current.legionScore}-${index}`, team: 'legion', minute: null });
  }
  for (let index = 0; index < opponentDelta; index += 1) {
    events.push({ key: `opponent-score-${current.opponentScore}-${index}`, team: 'opponent', minute: null });
  }
  return events;
}

export function applyKimberlyState(currentState, game, mode) {
  if (mode === MATCH_MODES.MANUAL) return { ...currentState };
  if (![MATCH_MODES.KIMBERLY_FULL, MATCH_MODES.KIMBERLY_SCORE].includes(mode)) {
    throw new RangeError(`Unknown match mode: ${mode}`);
  }

  const next = {
    ...currentState,
    legionScore: currentState.manualOverrides?.score ? currentState.legionScore : game.legionScore,
    opponentScore: currentState.manualOverrides?.score ? currentState.opponentScore : game.opponentScore,
    opponentName: currentState.manualOverrides?.opponent ? currentState.opponentName : game.opponentName,
    opponentLogo: currentState.manualOverrides?.opponent ? currentState.opponentLogo : (game.opponentLogo || currentState.opponentLogo || ''),
    dataMode: mode,
    kimberly: {
      ...(currentState.kimberly || {}),
      gameId: game.gameId,
      status: game.status,
      scheduledAt: game.scheduledAt,
      legionTeamName: game.legionTeamName,
      tournamentName: game.tournamentName,
      leagueName: game.leagueName,
      divisionName: game.divisionName,
      venueName: game.venueName,
      venueAddress: game.venueAddress,
      lastSyncAt: Date.now(),
      error: null
    }
  };

  if (mode === MATCH_MODES.KIMBERLY_FULL) {
    next.kimberly.hasLegionRoster = game.hasLegionRoster;
    next.kimberly.goals = game.goals.map(({ raw, ...goal }) => goal);
    next.kimberly.clockAvailable = game.clock?.available === true;
    next.kimberly.periodAvailable = Boolean(game.period);
    // The operator always owns clock and period. Kimberly frequently omits or
    // updates these fields late, so they are metadata rather than controls.
  }
  return next;
}
