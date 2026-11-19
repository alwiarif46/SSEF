// Cloudflare Pages Function for every /v1/* request.
//
// With API_URL set (Settings -> Variables and Secrets), requests are forwarded
// to the real API. Without it, a small built-in mode answers login, the session
// check and sync so the web app can be signed into and browsed. Nothing is
// saved in that mode.

const DEMO_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Owner',
  role: 'owner',
  phone: '+917006087759',
};
const DEMO_TENANT = { id: '00000000-0000-4000-8000-000000000002', name: 'Seb Orchard' };
// Password stored as sha256(salt + password), never in plain text.
const PW_SALT = '6ac1e86654b8e676d38195c2a7244517';
const PW_HASH = '5bf9f1891a67de0c5b4578f53aca5de53b7dfea873846e13677fe872b9fd0261';
// The session token is sha256('token:' + salt + password); only its hash is stored here.
const TOKEN_HASH = 'abfe781444a04df65e98623cce293433b0e3bfe792f3a84965bab2d18f057bdb';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const digits = (p) => String(p ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function demo(request, path) {
  if (path === '/v1/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const ok = digits(body.phone) === digits(DEMO_USER.phone) &&
      (await sha256Hex(PW_SALT + String(body.password ?? ''))) === PW_HASH;
    if (!ok) return json({ error: 'Invalid mobile number or password' }, 401);
    return json({ token: await sha256Hex('token:' + PW_SALT + String(body.password)), user: DEMO_USER });
  }

  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const authed = bearer !== '' && (await sha256Hex(bearer)) === TOKEN_HASH;
  if (!authed) return json({ error: 'Not signed in' }, 401);

  if (path === '/v1/me') return json({ user: DEMO_USER, tenant: DEMO_TENANT });
  if (path === '/v1/users') return json(request.method === 'GET' ? [DEMO_USER] : { error: 'Adding users needs the API' }, request.method === 'GET' ? 200 : 503);
  if (path === '/v1/user-orchards') return json([]);
  if (path === '/v1/sync') {
    if (request.method === 'GET') return json({ changes: {}, timestamp: Date.now() });
    const { changes = {} } = await request.json().catch(() => ({}));
    const rejected = Object.entries(changes).flatMap(([table, ch]) =>
      [...(ch.created ?? []), ...(ch.updated ?? [])].map((r) => ({ table, id: r.id, reason: 'Saving needs the API server, which is not connected yet' }))
        .concat((ch.deleted ?? []).map((id) => ({ table, id, reason: 'Saving needs the API server, which is not connected yet' }))));
    return json({ ok: rejected.length === 0, rejected, conflicts: [], flags: [] });
  }
  return json({ error: 'This feature needs the API server, which is not connected yet' }, 503);
}

export async function onRequest({ request, env }) {
  const incoming = new URL(request.url);
  if (!env.API_URL) return demo(request, incoming.pathname.replace(/\/+$/, ''));
  const target = new URL(incoming.pathname + incoming.search, env.API_URL);
  return fetch(new Request(target, request));
}
