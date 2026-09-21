import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import matchHandler from '../api/match.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = process.env.SCOREBOARD_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.SCOREBOARD_PORT || '4173', 10);
const upstream = 'https://api.kimberly-cup.ru/api';
const requestBuckets = new Map();
const localAuthPath = resolve(root, 'server', 'local-auth.json');
const localSession = randomUUID();
if (existsSync(localAuthPath)) {
  const profile = JSON.parse(readFileSync(localAuthPath, 'utf8'));
  process.env.FIREBASE_ADMIN_EMAIL ||= profile.email;
  process.env.FIREBASE_ADMIN_PASSWORD ||= profile.password;
}
process.env.ADMIN_SESSION_TOKEN = localSession;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://www.gstatic.com https://*.firebaseio.com https://*.firebasedatabase.app; connect-src 'self' https://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebaseio.com wss://*.firebasedatabase.app https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src https://scoreboard-6d34c.firebaseapp.com https://accounts.google.com https://*.firebaseio.com https://*.firebasedatabase.app; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:"
  );
}

function json(response, status, body) {
  securityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function isRateLimited(address) {
  const now = Date.now();
  const current = requestBuckets.get(address) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= 60_000) {
    current.startedAt = now;
    current.count = 0;
  }
  current.count += 1;
  requestBuckets.set(address, current);
  return current.count > 120;
}

function upstreamPath(pathname) {
  const patterns = [
    /^\/api\/kimberly\/teams\/(\d+)$/,
    /^\/api\/kimberly\/teams\/(\d+)\/schedule$/,
    /^\/api\/kimberly\/games\/(\d+)$/
  ];
  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match) return pathname.replace('/api/kimberly', '');
  }
  return null;
}

function localAdminProfile(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  if (!existsSync(localAuthPath)) return json(response, 503, { error: 'Local admin profile is not configured' });
  try {
    const profile = JSON.parse(readFileSync(localAuthPath, 'utf8'));
    if (!profile.email || !profile.password) throw new Error('Invalid local profile');
    return json(response, 200, { authorized: true });
  } catch {
    return json(response, 503, { error: 'Local admin profile is invalid' });
  }
}

async function proxyKimberly(request, response, pathname) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  if (isRateLimited(request.socket.remoteAddress || 'local')) {
    return json(response, 429, { error: 'Too many requests' });
  }
  const path = upstreamPath(pathname);
  if (!path) return json(response, 404, { error: 'Unknown Kimberly endpoint' });

  try {
    const upstreamResponse = await fetch(`${upstream}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'LegionScoreboard/4.0' },
      signal: AbortSignal.timeout(30_000)
    });
    const body = await upstreamResponse.text();
    securityHeaders(response);
    response.writeHead(upstreamResponse.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  } catch (error) {
    json(response, 502, { error: 'Kimberly API unavailable', detail: error.name });
  }
}

function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' });
  const requested = pathname === '/' ? '/legion.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return json(response, 400, { error: 'Invalid path' });
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.')) || ['server', 'test'].includes(segments[0])) {
    return json(response, 404, { error: 'Not found' });
  }
  const filePath = resolve(root, `.${decoded}`);
  const extension = extname(filePath).toLowerCase();
  if (!filePath.startsWith(`${root}${sep}`) || !mimeTypes[extension] || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return json(response, 404, { error: 'Not found' });
  }

  securityHeaders(response);
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/match') {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
        (request.headers.origin && request.headers.origin !== url.origin)) return json(response, 403, {error:'LOCAL_ONLY'});
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 100000) return json(response, 413, {error:'PAYLOAD_TOO_LARGE'});
      }
      request.body = body ? JSON.parse(body) : undefined;
      request.query = Object.fromEntries(url.searchParams);
      request.headers.cookie = `legion_admin=${localSession}`;
      response.status = code => { response.statusCode = code; return response; };
      response.json = value => json(response, response.statusCode, value);
      await matchHandler(request, response);
    } catch { json(response, 400, {error:'INVALID_REQUEST'}); }
    return;
  }
  if (url.pathname.startsWith('/api/kimberly/')) {
    await proxyKimberly(request, response, url.pathname);
    return;
  }
  if (url.pathname === '/api/local-admin-profile') {
    localAdminProfile(request, response);
    return;
  }
  serveStatic(request, response, url.pathname);
}).listen(port, host, () => {
  console.log(`Scoreboard: http://${host}:${port}`);
  console.log('Kimberly proxy is local and read-only.');
});
