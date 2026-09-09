import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// The production environment. For free watermarked test renders,
// change 'v1' to 'stage' and use your sandbox API key.
const SHOTSTACK_EDIT_URL = 'https://api.shotstack.io/edit/v1';
const SHOTSTACK_INGEST_URL = 'https://api.shotstack.io/ingest/v1';
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1';
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;

const SCRIPT =
  'Welcome to 12 Seaview Road. Three bedrooms of morning light, a kitchen ' +
  'that opens to the garden, and the beach a five-minute walk away. Booked ' +
  'inspections are filling fast. Come see it Saturday.';

const shotstackKey = process.env.SHOTSTACK_API_KEY;
const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
const presetVoiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const voiceSample = process.env.ELEVENLABS_VOICE_SAMPLE;

if (!shotstackKey) {
  console.error('Set the SHOTSTACK_API_KEY environment variable first.');
  process.exit(1);
}

if (!elevenlabsKey) {
  console.error('Set the ELEVENLABS_API_KEY environment variable first.');
  process.exit(1);
}

async function request(url, options, service) {
  let response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
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
    const detail = await response.text();
    throw new Error(`${service} returned ${response.status}: ${detail}`);
  }

  return response;
}

async function cloneVoice(samplePath) {
  const sample = await readFile(samplePath).catch(() => {
    throw new Error(`Could not read the voice sample at ${samplePath}.`);
  });
  const form = new FormData();
  form.append('name', 'Cookbook cloned voice');
  form.append('files', new Blob([sample]), 'sample.mp3');

  const response = await request(
    `${ELEVENLABS_URL}/voices/add`,
    { method: 'POST', headers: { 'xi-api-key': elevenlabsKey }, body: form },
    'ElevenLabs'
  );
  const voice = await response.json();

  if (!voice.voice_id) {
    throw new Error('ElevenLabs did not return a voice ID for the clone.');
  }

  return voice.voice_id;
}

async function generateVoiceover(voiceId) {
  const response = await request(
    `${ELEVENLABS_URL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': elevenlabsKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: SCRIPT,
        model_id: 'eleven_multilingual_v2'
      })
    },
    'ElevenLabs'
  );

  return Buffer.from(await response.arrayBuffer());
}

async function uploadToShotstack(audio) {
  const uploadResponse = await request(
    `${SHOTSTACK_INGEST_URL}/upload`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-api-key': shotstackKey }
    },
    'Shotstack'
  );
  const upload = (await uploadResponse.json()).data;

  if (!upload?.attributes?.url || !upload?.id) {
    throw new Error('The upload response did not contain a signed URL.');
  }

  await request(
    upload.attributes.url,
    { method: 'PUT', body: audio },
    'Shotstack'
  );

  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const sourceResponse = await request(
      `${SHOTSTACK_INGEST_URL}/sources/${upload.id}`,
      { headers: { Accept: 'application/json', 'x-api-key': shotstackKey } },
      'Shotstack'
    );
    const attributes = (await sourceResponse.json()).data?.attributes || {};

    if (attributes.status === 'failed') {
      throw new Error('Shotstack could not ingest the voice-over file.');
    }

    if (attributes.source) {
      return attributes.source;
    }

    console.log('Waiting for the voice-over upload to be ready...');
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('The voice-over upload did not finish in time.');
}

async function submitRender(voiceoverUrl) {
  const template = await readFile(
    new URL('./edit.json', import.meta.url),
    'utf8'
  );
  const edit = JSON.parse(template.replace('{{VOICEOVER_URL}}', voiceoverUrl));

  const response = await request(
    `${SHOTSTACK_EDIT_URL}/render`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': shotstackKey
      },
      body: JSON.stringify(edit)
    },
    'Shotstack'
  );
  const renderId = (await response.json()).response?.id;

  if (!renderId) {
    throw new Error('The render response did not contain a render ID.');
  }

  return renderId;
}

async function waitForRender(renderId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const response = await request(
      `${SHOTSTACK_EDIT_URL}/render/${renderId}`,
      { headers: { Accept: 'application/json', 'x-api-key': shotstackKey } },
      'Shotstack'
    );
    const render = (await response.json()).response || {};

    if (!render.status) {
      throw new Error('Shotstack returned an unexpected status response.');
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

  throw new Error(`Render ${renderId} did not finish in time.`);
}

try {
  let voiceId = presetVoiceId;

  if (voiceSample) {
    console.log('Cloning the voice with ElevenLabs...');
    voiceId = await cloneVoice(voiceSample);
  }

  console.log('Generating the voice-over with ElevenLabs...');
  const audio = await generateVoiceover(voiceId);

  console.log('Uploading the voice-over to Shotstack...');
  const voiceoverUrl = await uploadToShotstack(audio);

  const renderId = await submitRender(voiceoverUrl);
  console.log(`Queued render: ${renderId}`);

  const render = await waitForRender(renderId);
  console.log(`Temporary output URL: ${render.url}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
