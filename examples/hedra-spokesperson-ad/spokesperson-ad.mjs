import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

// The production environment. For free watermarked test renders, set
// SHOTSTACK_ENV=stage in .env and use your sandbox API key.
const STAGE = process.env.SHOTSTACK_ENV === 'stage' ? 'stage' : 'v1';
const EDIT_URL = `https://api.shotstack.io/edit/${STAGE}`;
const INGEST_URL = `https://api.shotstack.io/ingest/${STAGE}`;
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

function requireEnv(name, hint) {
  const value = process.env[name];

  if (!value) {
    console.error(`Set the ${name} environment variable first. ${hint}`);
    process.exit(1);
  }

  return value;
}

async function request(url, options, service) {
  let response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
      ...options
    });
  } catch (error) {
    throw new Error(
      `Could not reach the ${service} API. ` +
        'Check your network connection and try again.',
      { cause: error }
    );
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${service} returned ${response.status}: ${detail}`);
  }

  return response;
}

// A small CSV reader. It accepts quoted fields and commas inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (field !== '' || row.length > 0) {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
      }
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  const header = rows.shift();

  if (!header) {
    throw new Error('The input file is empty.');
  }

  return rows.map(cells =>
    Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
  );
}

function fingerprint(value) {
  return createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 12);
}

// The manifest makes the script resumable. Work already done is skipped, and
// media already generated is reused, so a second run costs nothing.
async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { jobs: {}, cache: {} };
  }
}

async function writeManifest(path, manifest) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function uploadToShotstack(key, body, contentType, label) {
  const signed = await request(
    `${INGEST_URL}/upload`,
    { method: 'POST', headers: { 'x-api-key': key } },
    'Shotstack Ingest'
  );
  const { data } = await signed.json();
  await request(
    data.attributes.url,
    { method: 'PUT', headers: { 'Content-Type': contentType }, body },
    'Shotstack Ingest'
  );
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const poll = await request(
      `${INGEST_URL}/sources/${data.id}`,
      { headers: { 'x-api-key': key } },
      'Shotstack Ingest'
    );
    const source = (await poll.json()).data.attributes;

    if (source.status === 'ready') {
      return source.source;
    }

    if (source.status === 'failed') {
      throw new Error(`Shotstack could not read the ${label}.`);
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Shotstack did not finish reading the ${label} in time.`);
}

async function renderEdit(key, edit, label) {
  const submitted = await request(
    `${EDIT_URL}/render`,
    {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(edit)
    },
    'Shotstack'
  );
  const renderId = (await submitted.json()).response.id;
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    await delay(POLL_INTERVAL_MS);
    const poll = await request(
      `${EDIT_URL}/render/${renderId}`,
      { headers: { 'x-api-key': key } },
      'Shotstack'
    );
    const status = (await poll.json()).response;

    if (status.status === 'done') {
      return status.url;
    }

    if (status.status === 'failed') {
      throw new Error(
        `The ${label} render failed: ${status.error ?? 'no reason given'}`
      );
    }
  }

  throw new Error(`The ${label} render did not finish in time.`);
}

async function download(url, path) {
  const response = await request(url, {}, 'Shotstack CDN');
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function mergeFields(values) {
  return Object.entries(values).map(([find, replace]) => ({
    find,
    replace: String(replace)
  }));
}

const HEDRA_URL = 'https://api.hedra.com/v3';
const HEDRA_MODEL = 'hedra-character-3';

const shotstackKey = requireEnv(
  'SHOTSTACK_API_KEY',
  'Get it from https://dashboard.shotstack.io.'
);
const hedraKey = requireEnv(
  'HEDRA_API_KEY',
  'It is the key_id:secret pair from https://hedra.com.'
);
const imageUrl = requireEnv(
  'HEDRA_IMAGE_URL',
  'It must be a public link to a portrait.'
);
const audioUrl = requireEnv(
  'HEDRA_AUDIO_URL',
  'It must be a public link to the voice recording.'
);

async function createCharacterVideo(prompt) {
  const response = await request(
    `${HEDRA_URL}/models/${HEDRA_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Key ${hedraKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: '16:9',
          resolution: '720p',
          start_image: { source: 'url', url: imageUrl },
          audio: { source: 'url', url: audioUrl }
        }
      })
    },
    'Hedra'
  );
  const jobId = (await response.json()).job_id;

  if (!jobId) {
    throw new Error('Hedra did not return a job ID.');
  }

  return jobId;
}

async function waitForCharacterVideo(jobId) {
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const poll = await request(
      `${HEDRA_URL}/jobs/${jobId}/status`,
      { headers: { Authorization: `Key ${hedraKey}` } },
      'Hedra'
    );
    const status = (await poll.json()).status;

    if (status === 'complete') {
      const finished = await request(
        `${HEDRA_URL}/jobs/${jobId}`,
        { headers: { Authorization: `Key ${hedraKey}` } },
        'Hedra'
      );
      const outputs = (await finished.json()).outputs || [];

      if (!outputs[0]?.url) {
        throw new Error('Hedra finished but returned no video URL.');
      }

      return outputs[0].url;
    }

    if (status === 'error' || status === 'failed') {
      throw new Error('Hedra could not generate the character video.');
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Hedra did not finish the character video in time.');
}

async function main() {
  const prompt = (await readFile('prompt.txt', 'utf8')).trim();
  const cutaways = parseCsv(await readFile('broll.csv', 'utf8'));
  await mkdir('output', { recursive: true });
  const manifestPath = 'output/manifest.json';
  const manifest = await readManifest(manifestPath);
  const template = JSON.parse(await readFile('template.json', 'utf8'));
  const cacheKey = fingerprint([prompt, imageUrl, audioUrl]);
  let characterUrl = manifest.cache[cacheKey];

  if (characterUrl) {
    console.log('Reusing the character clip from an earlier run');
  } else {
    console.log(
      'Asking Hedra for the character clip. This takes a few minutes.'
    );
    characterUrl = await waitForCharacterVideo(
      await createCharacterVideo(prompt)
    );
    manifest.cache[cacheKey] = characterUrl;
    await writeManifest(manifestPath, manifest);
  }

  // The cutaways sit on their own track above the character, so each one
  // covers the picture while the voice keeps playing underneath.
  const edit = structuredClone(template);
  edit.timeline.tracks[1].clips = cutaways.map(cut => ({
    asset: { type: 'image', src: cut.url },
    start: Number(cut.start),
    length: Number(cut.length),
    effect: cut.effect || 'zoomInSlow',
    fit: 'crop',
    transition: { in: 'fade', out: 'fade' }
  }));
  edit.merge = mergeFields({
    CHARACTER_URL: characterUrl,
    END_CARD: process.env.END_CARD || 'Start free at shotstack.io'
  });

  console.log(`Rendering with ${cutaways.length} cutaways`);
  const url = await renderEdit(shotstackKey, edit, 'spokesperson ad');
  const file = 'output/spokesperson-ad.mp4';
  await download(url, file);
  manifest.jobs['spokesperson-ad'] = {
    status: 'done',
    file,
    url,
    cutaways: cutaways.length,
    renderedAt: new Date().toISOString()
  };
  await writeManifest(manifestPath, manifest);
  console.log(`\nDone. The ad is at ${file}.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
