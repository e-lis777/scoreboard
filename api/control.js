export default function handler(request, response) {
  if (request.query.token !== process.env.ADMIN_PATH_TOKEN) return response.status(404).send('Not found');
  response.setHeader('Set-Cookie', `legion_admin=${process.env.ADMIN_SESSION_TOKEN}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`);
  response.setHeader('Cache-Control', 'no-store');
  return response.redirect(302, '/legion.html?admin=true');
}
