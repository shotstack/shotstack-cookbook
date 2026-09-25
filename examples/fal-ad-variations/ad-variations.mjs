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

const FAL_URL = process.env.FAL_URL || 'https://fal.run/fal-ai/flux/dev';
const SHOTS_PER_AD = 3;
const FORMATS = [
  { name: '9x16', width: 1080, height: 1920 },
  { name: '1x1', width: 1080, height: 1080 },
  { name: '16x9', width: 1920, height: 1080 }
];

const shotstackKey = requireEnv(
  'SHOTSTACK_API_KEY',
  'Get it from https://dashboard.shotstack.io.'
);
const falKey = requireEnv(
  'FAL_KEY',
  'Get it from https://fal.ai/dashboard/keys.'
);

// Text is sized in pixels, so each output format scales from a 1080-wide base.
function scaleText(edit, width) {
  const factor = width / 1080;

  for (const track of edit.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.asset.type === 'rich-text') {
        clip.asset.font.size = Math.round(clip.asset.font.size * factor);
      }
    }
  }

  return edit;
}

async function generateStills(prompt, count) {
  const response = await request(
    FAL_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_size: 'square_hd',
        num_images: count,
        output_format: 'jpeg'
      })
    },
    'fal'
  );
  const images = (await response.json()).images || [];

  if (images.length < count) {
    throw new Error(`fal returned ${images.length} images, not ${count}.`);
  }

  return images.map(image => image.url);
}

async function main() {
  const rows = parseCsv(await readFile('variations.csv', 'utf8'));

  if (rows.length === 0) {
    throw new Error('variations.csv has a header but no rows.');
  }

  await mkdir('output', { recursive: true });
  const manifestPath = 'output/manifest.json';
  const manifest = await readManifest(manifestPath);
  const template = JSON.parse(await readFile('template.json', 'utf8'));

  for (const row of rows) {
    const cacheKey = fingerprint([row.prompt, SHOTS_PER_AD, FAL_URL]);
    let stills = manifest.cache[cacheKey];

    if (stills) {
      console.log(`${row.id}: reusing images from an earlier run`);
    } else {
      console.log(`${row.id}: generating ${SHOTS_PER_AD} images with fal`);
      stills = await generateStills(row.prompt, SHOTS_PER_AD);
      manifest.cache[cacheKey] = stills;
      await writeManifest(manifestPath, manifest);
    }

    for (const format of FORMATS) {
      const jobId = `${row.id}-${format.name}`;

      if (manifest.jobs[jobId]?.status === 'done') {
        console.log(`${jobId}: already rendered, skipping`);
        continue;
      }

      const edit = scaleText(structuredClone(template), format.width);
      edit.merge = mergeFields({
        HEADLINE: row.headline,
        CTA: row.cta,
        ACCENT: row.accent || '#0CB5B2',
        IMG1: stills[0],
        IMG2: stills[1],
        IMG3: stills[2]
      });
      edit.output = {
        format: 'mp4',
        size: { width: format.width, height: format.height }
      };

      console.log(`${jobId}: rendering`);
      const url = await renderEdit(shotstackKey, edit, jobId);
      const file = `output/${jobId}.mp4`;
      await download(url, file);
      manifest.jobs[jobId] = {
        status: 'done',
        file,
        url,
        renderedAt: new Date().toISOString()
      };
      await writeManifest(manifestPath, manifest);
      console.log(`${jobId}: saved to ${file}`);
    }
  }

  const done = Object.keys(manifest.jobs).length;
  console.log(
    `\nDone. ${done} videos in output/. The manifest is output/manifest.json.`
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
