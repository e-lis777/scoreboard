const KIMBERLY_API = 'https://api.kimberly-cup.ru/api';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const path = String(request.query.path || '').replace(/^\/+|\/+$/g, '');
  if (!/^(?:teams\/\d+(?:\/schedule)?|games\/\d+)$/.test(path)) {
    return response.status(404).json({ error: 'Not found' });
  }

  try {
    const upstream = await fetch(`${KIMBERLY_API}/${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'LegionScoreboard/4.0' }
    });
    const body = await upstream.text();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return response.status(upstream.status).send(body);
  } catch {
    return response.status(502).json({ error: 'Kimberly API unavailable' });
  }
}
