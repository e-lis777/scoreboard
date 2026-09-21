function hasAdminSession(request) {
  const cookie = request.headers.cookie || '';
  return cookie.split(';').some(part => part.trim() === `legion_admin=${process.env.ADMIN_SESSION_TOKEN}`);
}

export default function handler(request, response) {
  if (request.method !== 'GET' || !hasAdminSession(request)) return response.status(404).json({ error: 'Not found' });
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ authorized: true });
}
