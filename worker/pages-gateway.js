// Cloudflare Pages is the public entry point. The Worker behind this service
// binding retains the admin secrets and the read-only Kimberly API proxy.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/') || pathname.startsWith('/control/')) {
      return env.LEGION_BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
