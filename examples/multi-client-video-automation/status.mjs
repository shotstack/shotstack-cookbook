import { db } from './db.mjs';

if (!process.env.SHOTSTACK_API_KEY) {
  console.error('Set SHOTSTACK_API_KEY before checking render status.');
  process.exit(1);
}

const ENV = process.env.SHOTSTACK_ENV ?? 'stage';
if (!['stage', 'v1'].includes(ENV)) {
  console.error('SHOTSTACK_ENV must be stage or v1.');
  process.exit(1);
}
const API = `https://api.shotstack.io/edit/${ENV}`;

for (const row of await db.renders.all()) {
  let res;
  try {
    res = await fetch(`${API}/render/${row.renderId}`, {
      headers: { 'x-api-key': process.env.SHOTSTACK_API_KEY }
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
