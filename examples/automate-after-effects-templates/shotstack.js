// Small helpers for the Shotstack Edit and Ingest APIs (Node.js 22 or newer, no packages).
const fs = require('fs');
const path = require('path');

const KEY = process.env.SHOTSTACK_API_KEY;
if (!KEY) {
  console.error('Set SHOTSTACK_API_KEY to your Shotstack API key first.');
  process.exit(1);
}

// v1 is the production API.
const ENV = process.env.SHOTSTACK_ENV || 'v1';
if (!['v1', 'stage'].includes(ENV)) {
  console.error('SHOTSTACK_ENV must be v1 or stage.');
  process.exit(1);
}
const EDIT_API = `https://api.shotstack.io/edit/${ENV}`;
const INGEST_API = `https://api.shotstack.io/ingest/${ENV}`;

const REQUEST_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 5 * 1000;
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Turns an API error body into one readable line.
function errorText(text) {
  try {
    const body = JSON.parse(text);
    return (
      body.errors?.[0]?.detail || body.response?.error || body.message || text
    );
  } catch {
    return text;
  }
}

// Calls the API and returns the parsed JSON.
// Retries after a 429 (too many requests). Reads and updates also retry after a dropped
// connection or a server error. Create and render requests (POST) don't, so they're never sent twice.
async function api(method, url, body) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'x-api-key': KEY,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      if (method === 'POST' || attempt >= 4) {
        throw new Error(
          "Can't reach the Shotstack API. Check your network connection and run the script again."
        );
      }
      await sleep(2000 * attempt);
      continue;
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `The API rejected the key (HTTP ${res.status}). Check SHOTSTACK_API_KEY and SHOTSTACK_ENV.`
      );
    }
    if (res.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `${method} ${url} returned a response that isn't JSON.`
        );
      }
    }
    const retry =
      res.status === 429 || (method !== 'POST' && res.status >= 500);
    if (retry && attempt < 4) {
      await sleep(
        Number(res.headers.get('retry-after')) * 1000 || 2000 * attempt
      );
      continue;
    }
    throw new Error(
      `${method} ${url} returned ${res.status}: ${errorText(text).slice(0, 300)}`
    );
  }
}

// Polls a render until it's done or failed.
async function waitForRender(id) {
  for (let waited = 0; waited < RENDER_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    const { response } = await api('GET', `${EDIT_API}/render/${id}`);
    if (response?.status === 'done' || response?.status === 'failed') {
      return response;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Render ${id} didn't finish within ${RENDER_TIMEOUT_MS / 60000} minutes.`
  );
}

// Saves a file from a URL, retrying a dropped connection.
async function download(url, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      if (attempt >= 3) {
        throw new Error(`Downloading ${url} failed: ${err.message}`);
      }
      await sleep(2000 * attempt);
    }
  }
}

// Reads a file an earlier step wrote, or says which step to run first.
function readStep(dir, file, step) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Can't find ${file}. Run node ${step} first.`);
  }
  return fs.readFileSync(full, 'utf8');
}

module.exports = {
  ENV,
  EDIT_API,
  INGEST_API,
  api,
  waitForRender,
  download,
  readStep,
  sleep
};
