/**
 * Render proxy.
 *
 * Four jobs, in order of importance:
 *   1. Hold the API key server-side. The browser never sees it.
 *   2. Persist render_id -> user_id. There is no endpoint that lists renders,
 *      so without this you can never build "show me my videos".
 *   3. Validate user-supplied URLs before they reach the render API.
 *   4. Rate limit per user, so one account can't drain the render budget.
 *
 *   POST /api/render      { edit } or { merge }  -> { id }
 *   GET  /api/render/:id                         -> { status, url, error }
 *   GET  /api/renders                            -> this user's renders
 *   POST /hooks/render                           -> 200 (webhook receiver)
 *
 * Usage:
 *   export SHOTSTACK_API_KEY=your_sandbox_key
 *   node server.js                 # creates the form template on first render
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';

const PORT = Number(process.env.PORT ?? 8787);
const ENV = process.env.SHOTSTACK_ENV ?? 'stage';
const API = `https://api.shotstack.io/edit/${ENV}`;
const API_KEY = process.env.SHOTSTACK_API_KEY;

/**
 * Per-user render cap per window. Credits are account-level; this is yours.
 *
 * Note the check-then-record shape below: the count is written after a submit
 * succeeds, so a batch of simultaneous requests can all pass the check before
 * any of them records. Fine for a demo, not for production. There you would
 * want an atomic increment in Redis or your database.
 */
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 10);
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Largest asset we'll let a user point us at. */
const MAX_ASSET_BYTES = 100 * 1024 * 1024;

if (!API_KEY) {
  console.error(
    'SHOTSTACK_API_KEY is not set. Get a free sandbox key at dashboard.shotstack.io'
  );
  process.exit(1);
}

if (!['stage', 'v1'].includes(ENV)) {
  console.error('SHOTSTACK_ENV must be stage or v1.');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY
};

/** Stand-in for your database. */
const renders = []; // { renderId, userId, status, url, createdAt }
const rateLog = new Map(); // userId -> timestamps

let templateId = process.env.SHOTSTACK_TEMPLATE_ID ?? null;

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = req =>
  new Promise(resolve => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
  });

/** Reduce an API error response to one line the user can act on. */
async function apiError(res) {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return (
      body.errors?.[0]?.detail ??
      body.response?.error ??
      body.response?.message ??
      body.message ??
      text
    );
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Template bootstrap, so the form path works on a fresh clone
// ---------------------------------------------------------------------------

async function ensureTemplate() {
  if (templateId) return templateId;

  const template = JSON.parse(
    await readFile(new URL('./template.json', import.meta.url), 'utf8')
  );

  const res = await fetch(`${API}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(template)
  });

  if (!res.ok)
    throw new Error(`could not create template: ${await apiError(res)}`);

  const { response } = await res.json();
  templateId = response.id;
  console.log(`Form template created: ${templateId}`);
  return templateId;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function withinRateLimit(userId) {
  const now = Date.now();
  const recent = (rateLog.get(userId) ?? []).filter(
    t => now - t < RATE_WINDOW_MS
  );
  rateLog.set(userId, recent);
  return recent.length < RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// URL validation
//
// Shotstack fetches assets server-side, but accepting arbitrary user URLs is
// still your problem. Reject anything that isn't https on a public host, then
// HEAD it to check type and size before spending a render on it.
//
// Both render paths go through this: the merge values from the form, and every
// asset src inside a submitted edit. The endpoint is plain HTTP, so treat
// everything that arrives on it as user-supplied, whichever tab sent it.
//
// One known gap: the DNS record can change between the lookup check and the
// HEAD request. Production code should pin the resolved address for the
// request instead of resolving twice.
// ---------------------------------------------------------------------------

const PRIVATE_V4 =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

async function validateAssetUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'must be https' };

  // Resolve and check the address, not just the hostname. A public name can
  // point at a private address.
  try {
    const { address } = await lookup(url.hostname);
    if (
      PRIVATE_V4.test(address) ||
      address === '::1' ||
      address.startsWith('fd')
    ) {
      return { ok: false, reason: 'resolves to a private address' };
    }
  } catch {
    return { ok: false, reason: 'host does not resolve' };
  }

  let head;
  try {
    head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (!head.ok) return { ok: false, reason: `responded ${head.status}` };

  const size = Number(head.headers.get('content-length') ?? 0);
  if (size > MAX_ASSET_BYTES) {
    return { ok: false, reason: `too large (${Math.round(size / 1e6)} MB)` };
  }

  return { ok: true };
}

/** Collect every URL-shaped string in an edit (asset src values and the like). */
function collectUrls(node, urls = []) {
  if (Array.isArray(node)) {
    node.forEach(n => collectUrls(n, urls));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach(v => collectUrls(v, urls));
  } else if (typeof node === 'string' && /^https?:\/\//i.test(node)) {
    urls.push(node);
  }
  return urls;
}

/** Check every user-supplied URL before submitting. */
async function validateUrls(urls) {
  for (const url of urls) {
    const result = await validateAssetUrl(url);
    if (!result.ok) throw new Error(`${url}: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Render submission
// ---------------------------------------------------------------------------

async function submitRender(payload) {
  if (payload.edit) {
    await validateUrls(collectUrls(payload.edit));

    const res = await fetch(`${API}/render`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload.edit)
    });
    if (!res.ok) throw new Error(await apiError(res));
    return (await res.json()).response.id;
  }

  await validateUrls(collectUrls(payload.merge ?? []));
  const id = await ensureTemplate();

  const res = await fetch(`${API}/templates/render`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, merge: payload.merge })
  });
  if (!res.ok) throw new Error(await apiError(res));
  return (await res.json()).response.id;
}

// ---------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Stand-in for your auth. Never trust a user id from the client in real code.
  const userId = req.headers['x-demo-user'] ?? 'demo-user';

  if (req.method === 'POST' && url.pathname === '/api/render') {
    if (!withinRateLimit(userId)) {
      return json(res, 429, {
        error: `Limit of ${RATE_LIMIT} renders per hour reached`
      });
    }

    try {
      const id = await submitRender(JSON.parse(await readBody(req)));

      // Persist BEFORE responding. There is no endpoint that lists renders, so
      // this row is the only record that this render belongs to this user.
      renders.push({
        renderId: id,
        userId,
        status: 'queued',
        url: null,
        createdAt: new Date().toISOString()
      });
      rateLog.set(userId, [...(rateLog.get(userId) ?? []), Date.now()]);

      return json(res, 200, { id });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/renders') {
    return json(
      res,
      200,
      renders.filter(r => r.userId === userId)
    );
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/render/')) {
    const id = url.pathname.split('/').pop();

    // Only surface renders this user owns.
    const row = renders.find(r => r.renderId === id && r.userId === userId);
    if (!row) return json(res, 404, { error: 'not found' });

    const r = await fetch(`${API}/render/${id}`, { headers });
    if (!r.ok) return json(res, 502, { error: await apiError(r) });

    const { response } = await r.json();
    Object.assign(row, { status: response.status, url: response.url ?? null });

    return json(res, 200, {
      status: response.status,
      url: response.url ?? null,
      error: response.error ?? null
    });
  }

  // Nothing here fires in local development: Shotstack can't reach localhost,
  // and none of the demo's renders set a `callback`, so the app polls instead.
  // Expose this endpoint through a tunnel (ngrok, Cloudflare) and add
  // `callback: "<public-url>/hooks/render"` to a render to exercise it.
  //
  // Respond within 10 seconds or Shotstack retries. Do the work afterwards.
  if (req.method === 'POST' && url.pathname === '/hooks/render') {
    const body = await readBody(req);
    json(res, 200, { received: true });

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }
    const row = renders.find(r => r.renderId === payload.id);

    // Failures fire this hook too. Branch on status, don't assume a url.
    if (payload.status === 'failed') {
      if (row) row.status = 'failed';
      console.error(`render ${payload.id} failed: ${payload.error}`);
    } else {
      if (row) Object.assign(row, { status: payload.status, url: payload.url });
      console.log(`render ${payload.id} done: ${payload.url}`);
    }
    return;
  }

  json(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err.message);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`Render proxy on http://localhost:${PORT}`);
});
