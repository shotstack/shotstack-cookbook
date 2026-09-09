import { db } from './db.mjs';

if (!process.env.SHOTSTACK_API_KEY) {
  console.error('Set SHOTSTACK_API_KEY before checking render status.');
  process.exit(1);
}

const ENV = process.env.SHOTSTACK_ENV || 'stage'; // '' from .env falls back too
if (!['stage', 'v1'].includes(ENV)) {
  console.error('SHOTSTACK_ENV must be stage or v1.');
  process.exit(1);
}
const API = `https://api.shotstack.io/edit/${ENV}`;

let rows;
try {
  rows = await db.renders.all();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (rows.length === 0) {
  console.log('No renders recorded yet. Run node render.mjs first.');
  process.exit(0);
}

for (const row of rows) {
  let res;
  try {
    res = await fetch(`${API}/render/${row.renderId}`, {
      headers: { 'x-api-key': process.env.SHOTSTACK_API_KEY },
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    console.error(
      `${row.clientId} ${row.variant ?? ''}: the network request failed. Check your connection and run again.`
    );
    process.exitCode = 1;
    continue;
  }

  if (!res.ok) {
    console.error(
      `${row.clientId} ${row.variant ?? ''}: status check failed (${res.status}). Check SHOTSTACK_API_KEY.`
    );
    process.exitCode = 1;
    continue;
  }

  const { response } = await res.json();
  console.log(`${row.clientId} ${row.variant ?? ''} → ${response.status}`);

  if (response.status === 'done') console.log(`  ${response.url}`);
  if (response.status === 'failed') console.log(`  error: ${response.error}`);
}
