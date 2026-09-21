const KIMBERLY_API = 'https://api.kimberly-cup.ru/api';
const ADMIN_COOKIE = 'legion_admin';
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.gstatic.com https://*.firebaseio.com https://*.firebasedatabase.app; connect-src 'self' https://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebaseio.com wss://*.firebasedatabase.app https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}

function hasAdminSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').some((part) => part.trim() === `${ADMIN_COOKIE}=${env.ADMIN_SESSION_TOKEN}`);
}

function isAllowedKimberlyPath(pathname) {
  return /^\/api\/kimberly\/(?:teams\/\d+(?:\/schedule)?|games\/\d+)$/.test(pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/kimberly/')) {
      if (request.method !== 'GET' || !isAllowedKimberlyPath(url.pathname)) return json({ error: 'Not found' }, 404);
      const upstreamPath = url.pathname.replace('/api/kimberly', '');
      try {
        const upstream = await fetch(`${KIMBERLY_API}${upstreamPath}`, { headers: { Accept: 'application/json', 'User-Agent': 'LegionScoreboard/4.0' } });
        return new Response(upstream.body, { status: upstream.status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      } catch {
        return json({ error: 'Kimberly API unavailable' }, 502);
      }
    }

    if (url.pathname === '/api/local-admin-profile') {
      if (request.method !== 'GET' || !hasAdminSession(request, env)) return json({ error: 'Not found' }, 404);
      return json({ email: env.FIREBASE_ADMIN_EMAIL, password: env.FIREBASE_ADMIN_PASSWORD });
    }

    if (url.pathname.startsWith('/control/')) {
      const suppliedToken = url.pathname.slice('/control/'.length);
      if (!suppliedToken || suppliedToken !== env.ADMIN_PATH_TOKEN) return new Response('Not found', { status: 404, headers });
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          Location: '/legion?admin=true',
          'Set-Cookie': `${ADMIN_COOKIE}=${env.ADMIN_SESSION_TOKEN}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`
        }
      });
    }

    if (url.pathname === '/') return Response.redirect(new URL('/legion.html', url), 302);
    return env.ASSETS.fetch(url);
  }
};
