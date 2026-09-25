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

const GLADIA_URL = 'https://api.gladia.io/v2/pre-recorded';
const CLIP_COUNT = Number(process.env.CLIP_COUNT || 3);
const CLIP_SECONDS = Number(process.env.CLIP_SECONDS || 45);

const shotstackKey = requireEnv(
  'SHOTSTACK_API_KEY',
  'Get it from https://dashboard.shotstack.io.'
);
const gladiaKey = requireEnv(
  'GLADIA_API_KEY',
  'Get it from https://app.gladia.io.'
);
const audioUrl = requireEnv(
  'AUDIO_URL',
  'It must be a public link to the recording you want to cut up.'
);
const keywords = (process.env.KEYWORDS || '')
  .split(',')
  .map(word => word.trim().toLowerCase())
  .filter(Boolean);

async function startTranscription() {
  const response = await request(
    GLADIA_URL,
    {
      method: 'POST',
      headers: {
        'x-gladia-key': gladiaKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ audio_url: audioUrl, diarization: true })
    },
    'Gladia'
  );
  const job = await response.json();

  if (!job.result_url) {
    throw new Error('Gladia did not return a result URL.');
  }

  return job.result_url;
}

async function waitForTranscription(resultUrl) {
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    const poll = await request(
      resultUrl,
      { headers: { 'x-gladia-key': gladiaKey } },
      'Gladia'
    );
    const job = await poll.json();

    if (job.status === 'done') {
      const utterances = job.result?.transcription?.utterances;

      if (!utterances || utterances.length === 0) {
        throw new Error('Gladia returned no speech for that recording.');
      }

      return utterances;
    }

    if (job.status === 'error') {
      throw new Error('Gladia could not transcribe that recording.');
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Gladia did not finish the transcript in time.');
}

// Build every window of consecutive utterances up to CLIP_SECONDS long, then
// keep the ones that say the most. A keyword hit counts for ten words.
function pickSegments(utterances) {
  const windows = [];

  for (let i = 0; i < utterances.length; i += 1) {
    const first = utterances[i];
    const group = [];

    for (let j = i; j < utterances.length; j += 1) {
      if (utterances[j].end - first.start > CLIP_SECONDS) {
        break;
      }

      group.push(utterances[j]);
    }

    if (group.length === 0) {
      continue;
    }

    const last = group[group.length - 1];
    const text = group.map(part => part.text).join(' ');
    const hits = keywords.filter(word =>
      text.toLowerCase().includes(word)
    ).length;
    windows.push({
      start: first.start,
      end: last.end,
      speaker: first.speaker,
      utterances: group,
      score: text.split(/\s+/).length + hits * 10
    });
  }

  const picked = [];

  for (const window of windows.sort((a, b) => b.score - a.score)) {
    const overlaps = picked.some(
      other => window.start < other.end && window.end > other.start
    );

    if (!overlaps) {
      picked.push(window);
    }

    if (picked.length === CLIP_COUNT) {
      break;
    }
  }

  return picked.sort((a, b) => a.start - b.start);
}

function timecode(seconds) {
  const whole = Math.max(0, seconds);
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(whole % 60)).padStart(2, '0');
  const ms = String(Math.round((whole % 1) * 1000)).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

// The subtitles are cut from the transcript we already have, so the render
// does not transcribe again and consumes no generation credits.
function buildSrt(window) {
  return window.utterances
    .map((part, index) => {
      const from = timecode(part.start - window.start);
      const to = timecode(part.end - window.start);
      return `${index + 1}\n${from} --> ${to}\n${part.text.trim()}\n`;
    })
    .join('\n');
}

async function main() {
  await mkdir('output', { recursive: true });
  const manifestPath = 'output/manifest.json';
  const manifest = await readManifest(manifestPath);
  const template = JSON.parse(await readFile('template.json', 'utf8'));
  const cacheKey = fingerprint([audioUrl, 'transcript']);
  let utterances = manifest.cache[cacheKey];

  if (utterances) {
    console.log('Reusing the transcript from an earlier run');
  } else {
    console.log('Transcribing the recording with Gladia');
    utterances = await waitForTranscription(await startTranscription());
    manifest.cache[cacheKey] = utterances;
    await writeManifest(manifestPath, manifest);
  }

  const segments = pickSegments(utterances);
  console.log(
    `Picked ${segments.length} segments of up to ${CLIP_SECONDS} seconds`
  );

  for (const [index, segment] of segments.entries()) {
    const jobId = `short-${String(index + 1).padStart(2, '0')}`;

    if (manifest.jobs[jobId]?.status === 'done') {
      console.log(`${jobId}: already rendered, skipping`);
      continue;
    }

    const srtUrl = await uploadToShotstack(
      shotstackKey,
      buildSrt(segment),
      'text/plain',
      'subtitles'
    );
    const edit = structuredClone(template);
    const length = Number((segment.end - segment.start).toFixed(2));
    const audioClip = edit.timeline.tracks.at(-1).clips[0];
    audioClip.asset.trim = Number(segment.start.toFixed(2));
    audioClip.length = length;
    edit.merge = mergeFields({
      SRT_URL: srtUrl,
      AUDIO_URL: audioUrl,
      SPEAKER: segment.speaker ? `Speaker ${segment.speaker}` : 'Highlight',
      ACCENT: process.env.ACCENT || '#0CB5B2'
    });

    if (process.env.BACKGROUND_URL) {
      edit.timeline.tracks.push({
        clips: [
          {
            asset: {
              type: 'video',
              src: process.env.BACKGROUND_URL,
              volume: 0
            },
            start: 0,
            length: 'end',
            fit: 'crop',
            effect: 'zoomInSlow'
          }
        ]
      });
    }

    console.log(
      `${jobId}: rendering ${length}s from ${segment.start.toFixed(1)}s`
    );
    const url = await renderEdit(shotstackKey, edit, jobId);
    const file = `output/${jobId}.mp4`;
    await download(url, file);
    manifest.jobs[jobId] = {
      status: 'done',
      file,
      url,
      startsAt: segment.start,
      length,
      renderedAt: new Date().toISOString()
    };
    await writeManifest(manifestPath, manifest);
    console.log(`${jobId}: saved to ${file}`);
  }

  console.log(
    '\nDone. The vertical clips are in output/ with output/manifest.json.'
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
