import { clients, variants, mergeFieldsFor } from './clients.mjs';
import { db } from './db.mjs';

if (!process.env.SHOTSTACK_API_KEY || !process.env.SHOTSTACK_TEMPLATE_ID) {
  console.error(
    'Set SHOTSTACK_API_KEY and SHOTSTACK_TEMPLATE_ID before rendering.'
  );
  process.exit(1);
}

const ENV = process.env.SHOTSTACK_ENV || 'stage'; // '' from .env falls back too
if (!['stage', 'v1'].includes(ENV)) {
  console.error('SHOTSTACK_ENV must be stage or v1.');
  process.exit(1);
}
const API = `https://api.shotstack.io/edit/${ENV}`;

/** Reduce an API error response to one line the user can act on. */
async function apiError(res) {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return (
      body.errors?.[0]?.detail ?? body.response?.error ?? body.message ?? text
    );
  } catch {
    return text;
  }
}

async function renderVariant(clientId, client, variant) {
  let res;
  try {
    res = await fetch(`${API}/templates/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.SHOTSTACK_API_KEY
      },
      body: JSON.stringify({
        id: client.templateId,
        merge: mergeFieldsFor(client, variant)
      }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new Error(
      `${clientId}/${variant.name}: the network request failed. Check your connection and run again.`
    );
  }

  if (res.status === 401 || res.status === 403)
    throw new Error(
      `${clientId}/${variant.name}: the API rejected the key (${res.status}). Check SHOTSTACK_API_KEY and SHOTSTACK_ENV.`
    );

  if (!res.ok)
    throw new Error(
      `${clientId}/${variant.name}: ${res.status} ${await apiError(res)}`
    );

  const { response } = await res.json();

  await db.renders.insert({
    renderId: response.id,
    clientId,
    variant: variant.name,
    submittedAt: new Date().toISOString()
  });

  return response.id;
}

async function renderAll(concurrency = 10) {
  // Every client × every variant, flattened into one work queue.
  const jobs = Object.entries(clients).flatMap(([id, client]) =>
    variants.map(variant => ({ id, client, variant }))
  );

  const results = [];

  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    results.push(
      ...(await Promise.allSettled(
        batch.map(j => renderVariant(j.id, j.client, j.variant))
      ))
    );
  }

  return results;
}

let results;
try {
  results = await renderAll();
} catch (err) {
  // Only db.mjs throws here: renders.jsonl could not be written.
  console.error(err.message);
  process.exit(1);
}

const rejected = results.filter(r => r.status === 'rejected');
for (const r of rejected) console.error(r.reason.message);

console.log(`${results.length - rejected.length}/${results.length} submitted`);

if (rejected.length > 0) process.exitCode = 1;
