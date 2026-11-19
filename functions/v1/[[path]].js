// Cloudflare Pages Function: forwards every /v1/* request to the API.
// Set API_URL (e.g. https://api.example.com) in the Pages project's
// Settings -> Variables and Secrets.
export async function onRequest({ request, env }) {
  if (!env.API_URL) {
    return new Response(JSON.stringify({ error: 'API_URL is not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.API_URL);
  return fetch(new Request(target, request));
}
