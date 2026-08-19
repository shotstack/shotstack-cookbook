import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// The sandbox environment. The API names it "stage".
const API_BASE_URL = 'https://api.shotstack.io/edit/stage';
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;
const apiKey = process.env.SHOTSTACK_API_KEY;

if (!apiKey) {
  console.error('Set the SHOTSTACK_API_KEY environment variable first.');
  process.exit(1);
}

async function shotstackRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey,
        ...options.headers
      }
    });
  } catch (error) {
    throw new Error(
      'Could not reach the Shotstack API. ' +
        'Check your network connection and try again.',
      { cause: error }
    );
  }

  const responseText = await response.text();
  let body = null;

  try {
    body = JSON.parse(responseText);
  } catch {
    // Handled below: an error response falls back to the raw body text, and
    // a success response that is not JSON gets its own message.
  }

  if (!response.ok) {
    const detail =
      body?.errors?.[0]?.detail || (body ? JSON.stringify(body) : responseText);
    throw new Error(`Shotstack returned ${response.status}: ${detail}`);
  }

  if (!body || typeof body !== 'object') {
    throw new Error(
      `Shotstack returned a non-JSON response with status ${response.status}.`
    );
  }

  return body;
}

async function submitRender(edit) {
  const result = await shotstackRequest('/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(edit)
  });

  const renderId = result.response?.id;

  if (!renderId) {
    throw new Error(
      `The response did not contain a render ID: ${JSON.stringify(result)}`
    );
  }

  return renderId;
}

async function waitForRender(renderId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await shotstackRequest(`/render/${renderId}`);
    const render = result.response || {};

    if (!render.status) {
      throw new Error(`Unexpected status response: ${JSON.stringify(result)}`);
    }

    console.log(`Render status: ${render.status}`);

    if (render.status === 'done') {
      if (!render.url) {
        throw new Error('The render finished without an output URL.');
      }
      return render;
    }

    if (render.status === 'failed') {
      throw new Error(
        render.error || 'The render failed without an error message.'
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Render ${renderId} did not finish within ${MAX_WAIT_MS / 60_000} minutes.`
  );
}

try {
  const edit = JSON.parse(
    await readFile(new URL('./edit.json', import.meta.url), 'utf8')
  );
  const renderId = await submitRender(edit);

  console.log(`Queued render: ${renderId}`);

  const render = await waitForRender(renderId);
  console.log(`Temporary output URL: ${render.url}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
