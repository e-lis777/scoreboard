const DEFAULT_TIMEOUT_MS = 35_000;

function numericId(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
}

export class KimberlyClient {
  constructor({ baseUrl = '/api/kimberly', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Kimberly request failed: ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  getTeam(teamId) {
    return this.request(`/teams/${numericId(teamId, 'teamId')}`);
  }

  getTeamSchedule(teamId) {
    return this.request(`/teams/${numericId(teamId, 'teamId')}/schedule`);
  }

  getGame(gameId) {
    return this.request(`/games/${numericId(gameId, 'gameId')}`);
  }
}

export function selectRelevantGame(games, now = new Date()) {
  const list = Array.isArray(games) ? games : [];
  const active = list.filter(game => ['started', 'paused'].includes(game?.status));
  if (active.length) return active.sort((a, b) => Number(b.id) - Number(a.id))[0];

  const nowMs = now.getTime();
  const oldestAllowed = nowMs - 6 * 60 * 60 * 1000;
  const newestAllowed = nowMs + 14 * 24 * 60 * 60 * 1000;
  const upcoming = list
    .filter(game => game?.status === 'not_started')
    .map(game => ({ game, time: Date.parse(String(game.started_at || '').replace(' ', 'T')) }))
    .filter(item => Number.isFinite(item.time) && item.time >= oldestAllowed && item.time <= newestAllowed)
    .sort((a, b) => a.time - b.time);
  return upcoming[0]?.game || null;
}
