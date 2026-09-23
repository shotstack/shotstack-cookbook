import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync
} from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const key = process.env.SHOTSTACK_API_KEY;
const templateId = process.env.SHOTSTACK_TEMPLATE_ID;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
if (!key || !UUID.test(templateId)) {
  console.error('Set SHOTSTACK_API_KEY and SHOTSTACK_TEMPLATE_ID in .env');
  process.exit(1);
}

const NETWORK_ERROR =
  'Network error: could not reach api.shotstack.io. Check the connection and try again';

async function api(service, path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`https://api.shotstack.io/${service}/v1${path}`, {
      method,
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) await sleep(60_000);
    const message = [401, 403].includes(response.status)
      ? 'The API rejected the key. Check SHOTSTACK_API_KEY in .env'
      : `${service}${path}: HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}

async function readFeed() {
  let items;
  if (process.env.FEED_URL) {
    let response;
    try {
      response = await fetch(process.env.FEED_URL, {
        signal: AbortSignal.timeout(30_000)
      });
    } catch {
      throw new Error(
        'Network error: could not fetch FEED_URL. Check the URL and the connection'
      );
    }
    if (!response.ok) throw new Error(`Feed: HTTP ${response.status}`);
    items = await response.json();
  } else {
    items = JSON.parse(readFileSync('feed.json', 'utf8'));
  }
  if (!Array.isArray(items) || items.length > 1000)
    throw new Error('Expected a small array of feed items');
  const ids = new Set();
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 80 ||
      !Array.isArray(item.images) ||
      item.images.length < 1 ||
      item.images.length > 4 ||
      !item.images.every(
        url => typeof url === 'string' && new URL(url).protocol === 'https:'
      )
    ) {
      throw new Error(
        'Each item needs a unique ID, a short title, and one to four HTTPS image URLs'
      );
    }
    ids.add(item.id);
  }
  return items;
}

async function submit(item) {
  const merge = [{ find: 'TITLE', replace: item.title }];
  for (let i = 0; i < 4; i++) {
    // Products with fewer than four photos repeat the last one, so every slot renders.
    const url = item.images[Math.min(i, item.images.length - 1)];
    merge.push({ find: `IMAGE_${i + 1}`, replace: url });
  }
  const result = await api('edit', '/templates/render', 'POST', {
    id: templateId,
    merge
  });
  if (!UUID.test(result.response?.id))
    throw new Error(
      'No render ID returned; check the submission before retrying'
    );
  return result.response.id;
}

async function getResult(renderId) {
  const { response } = await api('edit', `/render/${renderId}?data=false`);
  if (response?.id !== renderId || !response.status)
    throw new Error('Unexpected render response');
  console.log(`render=${renderId} status=${response.status}`);
  if (response.status === 'failed') {
    return { status: 'failed', error: response.error || 'Render failed' };
  }
  if (response.status !== 'done') return { status: 'pending' };

  let assets;
  try {
    assets = await api('serve', `/assets/render/${renderId}`);
  } catch (error) {
    if (error.status === 404) return { status: 'pending' };
    throw error;
  }
  const video = assets.data
    ?.map(asset => asset.attributes)
    .find(
      asset =>
        asset?.renderId === renderId && /\.mp4$/i.test(asset.filename || '')
    );
  if (video?.status === 'failed' || video?.status === 'deleted')
    throw new Error(
      `Hosting status is ${video.status}; investigate this render before doing anything else`
    );
  if (video?.status !== 'ready' || !video.url?.startsWith('https://')) {
    return { status: 'pending' };
  }
  return { status: 'done', url: video.url };
}

function readState() {
  let state;
  try {
    state = JSON.parse(readFileSync('state.json', 'utf8'));
  } catch {
    throw new Error(
      'state.json is missing or not valid JSON. Create it with {} or restore your history'
    );
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Invalid state.json; restore your history');
  }
  for (const entry of Object.values(state)) {
    if (
      !entry ||
      !['unknown', 'pending', 'done', 'failed', 'rejected'].includes(
        entry.status
      ) ||
      (['pending', 'done', 'failed'].includes(entry.status) &&
        !UUID.test(entry.renderId)) ||
      (entry.status === 'pending' && !Number.isFinite(entry.checkedAt))
    ) {
      throw new Error('Invalid state entry; check your saved IDs and statuses');
    }
  }
  return state;
}

function saveState(state) {
  writeFileSync('state.json.tmp', JSON.stringify(state, null, 2) + '\n', {
    mode: 0o600
  });
  renameSync('state.json.tmp', 'state.json');
}

function pendingEntries(state) {
  return Object.entries(state)
    .filter(([, entry]) => entry.status === 'pending')
    .sort((a, b) => a[1].checkedAt - b[1].checkedAt);
}

async function submitNew(item, state) {
  const entry = (state[item.id] = {
    status: 'unknown',
    attemptedAt: new Date().toISOString()
  });
  saveState(state);

  try {
    entry.renderId = await submit(item);
    entry.status = 'pending';
    entry.checkedAt = Date.now();
  } catch (error) {
    entry.status = [400, 401, 403, 404, 422, 429].includes(error.status)
      ? 'rejected'
      : 'unknown';
    entry.error = error.message;
  }
  saveState(state);
  console.log(
    `item=${item.id} status=${entry.status} render=${entry.renderId || 'unknown'}`
  );
  if (entry.status !== 'pending')
    throw new Error(
      entry.error || 'Submission stopped; inspect state.json before retrying'
    );
}

async function checkPending(state, force = false) {
  let checked = 0;
  for (const [id, entry] of pendingEntries(state)) {
    const marker = `inbox/${entry.renderId}`;
    const overdue = Date.now() - entry.checkedAt >= 15 * 60_000;
    if (!force && !existsSync(marker) && !overdue) continue;
    if (checked === 5) break;
    checked++;
    rmSync(marker, { force: true });

    try {
      const result = await getResult(entry.renderId);
      Object.assign(entry, result);
      if (result.status === 'done') {
        delete entry.error;
        console.log(`item=${id} ready ${entry.url}`);
      }
    } catch (error) {
      entry.error = error.message;
      console.error(`item=${id} check deferred: ${error.message}`);
    }
    entry.checkedAt = Date.now();
    saveState(state);
  }
  for (const entry of Object.values(state)) {
    if (entry.renderId && entry.status !== 'pending') {
      rmSync(`inbox/${entry.renderId}`, { force: true });
    }
  }
}

async function main() {
  const state = readState();
  await checkPending(state, process.argv.includes('--now'));
  if (process.argv.includes('--check')) return;

  const items = await readFeed();
  if (process.argv[2] === '--retry') {
    const id = process.argv[3];
    const item = items.find(item => item.id === id);
    const previous = Object.hasOwn(state, id) ? state[id] : null;
    if (
      !item ||
      !previous ||
      !['rejected', 'failed'].includes(previous.status)
    ) {
      throw new Error(
        'Retry requires a corrected feed item and a rejected or failed state entry'
      );
    }
    console.log(
      `item=${id} retrying; previous render=${previous.renderId || 'none'}`
    );
    await submitNew(item, state);
    return;
  }
  let submitted = 0;
  for (const item of items) {
    if (Object.hasOwn(state, item.id)) {
      console.log(`item=${item.id} skipped (${state[item.id].status})`);
      continue;
    }
    if (submitted === 3 || pendingEntries(state).length >= 10) break;
    await submitNew(item, state);
    submitted++;
  }

  if (process.argv.includes('--wait')) {
    const deadline = Date.now() + 5 * 60_000;
    while (pendingEntries(state).length && Date.now() < deadline) {
      await checkPending(state, true);
      if (pendingEntries(state).length) await sleep(5000);
    }
    if (pendingEntries(state).length)
      console.log('Jobs remain pending; check their saved IDs later');
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
