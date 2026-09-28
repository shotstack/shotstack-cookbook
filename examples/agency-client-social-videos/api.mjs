const API_KEY = process.env.SHOTSTACK_API_KEY;
const ENV = process.env.SHOTSTACK_ENV || 'stage';
const API = `https://api.shotstack.io/edit/${ENV}`;
const TIMEOUT_MS = 30_000;

export function fail(message) {
  console.error(message);
  process.exit(1);
}

export function requireConfig() {
  if (!API_KEY) {
    fail('Set SHOTSTACK_API_KEY before you run this script.');
  }

  if (!['stage', 'v1'].includes(ENV)) {
    fail('SHOTSTACK_ENV must be stage or v1.');
  }
}

// A rejected key or a dead network fails every record the same way. The
// caller stops the batch at the first one instead of printing a line per record.
function stopBatch(message) {
  return Object.assign(new Error(message), { fatal: true });
}

async function apiError(response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text);
    return (
      body.errors?.[0]?.detail ?? body.response?.error ?? body.message ?? text
    );
  } catch {
    return text;
  }
}

async function request(path, options, label) {
  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw stopBatch(
      `${label}: the network request failed. Check your connection and run again.`
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw stopBatch(
      `${label}: the API rejected the key (${response.status}). Check SHOTSTACK_API_KEY and SHOTSTACK_ENV.`
    );
  }

  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${await apiError(response)}`);
  }

  return (await response.json()).response;
}

export async function submitRender(edit, label) {
  const { id } = await request(
    '/render',
    { method: 'POST', body: JSON.stringify(edit) },
    label
  );

  if (!id) {
    throw new Error(`${label}: the render response did not contain an id.`);
  }

  return id;
}

export function getRender(renderId, label) {
  return request(`/render/${renderId}`, { method: 'GET' }, label);
}
