import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const API_BASE_URL = 'https://api.shotstack.io/edit/stage';
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;
const apiKey = process.env.SHOTSTACK_API_KEY;

if (!apiKey) {
  throw new Error('Set the SHOTSTACK_API_KEY environment variable first.');
}

async function shotstackRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey,
      ...options.headers,
    },
  });

  const responseText = await response.text();
  let body = null;

  try {
    body = JSON.parse(responseText);
  } catch {
    // The error below includes the raw body when Shotstack does not return JSON.
  }

  if (!response.ok) {
    const details = body ? JSON.stringify(body) : responseText;
    throw new Error(
      `Shotstack returned ${response.status} ${response.statusText}: ${details}`,
    );
  }

  if (!body) {
    throw new Error('Shotstack returned an unexpected non-JSON response.');
  }

  return body;
}

async function submitRender(edit) {
  const result = await shotstackRequest('/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit),
  });

  const renderId = result?.response?.id;

  if (!renderId) {
    throw new Error(
      `The response did not contain a render ID: ${JSON.stringify(result)}`,
    );
  }

  return renderId;
}

async function waitForRender(renderId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await shotstackRequest(`/render/${renderId}`);
    const render = result?.response;

    if (!render?.status) {
      throw new Error(`Unexpected status response: ${JSON.stringify(result)}`);
    }

    console.log(`Render status: ${render.status}`);

    if (render.status === 'done') {
      return render;
    }

    if (render.status === 'failed') {
      throw new Error(
        render.error || 'The render failed without an error message.',
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Render ${renderId} did not finish within 10 minutes.`);
}

try {
  const edit = JSON.parse(
    await readFile(new URL('./edit.json', import.meta.url), 'utf8'),
  );
  const renderId = await submitRender(edit);

  console.log(`Queued render: ${renderId}`);

  const render = await waitForRender(renderId);
  console.log(`Temporary output URL: ${render.url}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
