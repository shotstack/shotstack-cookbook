import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';

const INGEST_BASE = 'https://api.shotstack.io/ingest/v1';
const EDIT_BASE = 'https://api.shotstack.io/edit/v1';
const IG_BASE = 'https://graph.facebook.com/v25.0';

const FALLBACK_DURATION = 20; // seconds, only if Ingest reports no duration

const FONT_SRC =
  'https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm45xW5rygbi49c.ttf';
const FONT_FAMILY = 'JTUSjIg1_i6t8kCHKm45xW5rygbi49c';

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

let openaiClient;
const openai = () =>
  (openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

const ingestHeaders = () => ({ 'x-api-key': process.env.SHOTSTACK_API_KEY });
const editHeaders = () => ({
  'x-api-key': process.env.SHOTSTACK_API_KEY,
  'Content-Type': 'application/json',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}\n` +
        'Copy .env.example to .env and fill in your keys.',
    );
  }
}

async function generateContent(topic) {
  const response = await openai().chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      {
        role: 'system',
        content: `You are a social media content writer. Return JSON only, no markdown.
Schema: { "script": string, "hook": string, "caption": string }
- script: a 15-20 second voiceover narration (~40 words), punchy and direct
- hook: the on-screen title, under 60 characters
- caption: under 75 characters with 2-3 relevant hashtags`,
      },
      {
        role: 'user',
        content: `Write a script, hook and caption for an Instagram Reel about: ${topic}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

async function generateVoiceover(script) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function generateBackground(topic) {
  const result = await openai().images.generate({
    model: IMAGE_MODEL,
    prompt: `Cinematic vertical background image for an Instagram Reel about: ${topic}.
Bold colors, visually striking, no text, no people. Designed for 9:16 portrait format.`,
    size: '1024x1536',
    quality: 'medium',
  });

  return Buffer.from(result.data[0].b64_json, 'base64');
}

async function uploadToShotstack(buffer, contentType) {
  const uploadRes = await fetch(`${INGEST_BASE}/upload`, {
    method: 'POST',
    headers: { ...ingestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!uploadRes.ok)
    throw new Error(`Ingest upload init failed: ${uploadRes.status}`);
  const { data } = await uploadRes.json();
  const { id: sourceId, url: signedUrl } = data.attributes;

  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!putRes.ok) throw new Error(`Signed URL upload failed: ${putRes.status}`);

  for (let i = 0; i < 20; i++) {
    const statusRes = await fetch(`${INGEST_BASE}/sources/${sourceId}`, {
      headers: ingestHeaders(),
    });
    const { data: src } = await statusRes.json();
    if (src.attributes.status === 'ready')
      return { url: src.attributes.source, duration: src.attributes.duration };
    if (src.attributes.status === 'failed')
      throw new Error('Shotstack ingest failed');
    await sleep(3000);
  }

  throw new Error('Shotstack ingest timed out');
}

async function renderReel(backgroundUrl, voiceoverUrl, hookText, duration) {
  const edit = {
    timeline: {
      fonts: [{ src: FONT_SRC }],
      tracks: [
        {
          clips: [
            {
              asset: {
                type: 'rich-text',
                text: hookText,
                font: {
                  family: FONT_FAMILY,
                  size: 54,
                  weight: '700',
                  color: '#ffffff',
                },
                stroke: { width: 2, color: '#000000' },
                shadow: {
                  offsetX: 0,
                  offsetY: 4,
                  blur: 12,
                  color: '#000000',
                  opacity: 0.6,
                },
                align: { horizontal: 'center', vertical: 'middle' },
                animation: { preset: 'ascend', duration: 0.6, direction: 'up' },
              },
              start: 0,
              length: duration,
              width: 940,
              height: 400,
              position: 'bottom',
              offset: { y: 0.15 }, // positive y moves up
            },
          ],
        },
        {
          clips: [
            {
              asset: { type: 'image', src: backgroundUrl },
              start: 0,
              length: duration,
              fit: 'crop',
              effect: 'zoomIn',
            },
          ],
        },
        {
          clips: [
            {
              asset: { type: 'audio', src: voiceoverUrl, effect: 'fadeOut' },
              start: 0,
              length: 'auto',
            },
          ],
        },
      ],
    },
    output: {
      format: 'mp4',
      size: { width: 1080, height: 1920 },
      fps: 30,
      quality: 'medium',
    },
  };

  const renderRes = await fetch(`${EDIT_BASE}/render`, {
    method: 'POST',
    headers: editHeaders(),
    body: JSON.stringify(edit),
  });
  if (!renderRes.ok)
    throw new Error(`Shotstack render submit failed: ${renderRes.status}`);
  const { response } = await renderRes.json();

  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const statusRes = await fetch(`${EDIT_BASE}/render/${response.id}`, {
      headers: editHeaders(),
    });
    const { response: render } = await statusRes.json();
    if (render.status === 'done') return render.url;
    if (render.status === 'failed') throw new Error('Shotstack render failed');
  }

  throw new Error('Shotstack render timed out');
}

async function postToInstagram(videoUrl, caption) {
  const igUserId = process.env.IG_USER_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;

  const containerRes = await fetch(`${IG_BASE}/${igUserId}/media`, {
    method: 'POST',
    body: new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
      access_token: accessToken,
    }),
  });
  if (!containerRes.ok)
    throw new Error(`Container creation failed: ${containerRes.status}`);
  const { id: containerId } = await containerRes.json();

  for (let i = 0; i < 5; i++) {
    const statusRes = await fetch(
      `${IG_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`,
    );
    if (!statusRes.ok)
      throw new Error(`Container status check failed: ${statusRes.status}`);
    const { status_code } = await statusRes.json();
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR' || status_code === 'EXPIRED')
      throw new Error(`Instagram container ${status_code.toLowerCase()}`);
    if (i === 4)
      throw new Error(
        'Instagram container was not ready to publish after 5 minutes',
      );
    await sleep(60_000);
  }

  const publishRes = await fetch(`${IG_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });
  if (!publishRes.ok) throw new Error(`Publish failed: ${publishRes.status}`);
  const { id: mediaId } = await publishRes.json();
  return mediaId;
}

export async function createAndPostReel(topic, { publish = false } = {}) {
  requireEnv([
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_VOICE_ID',
    'SHOTSTACK_API_KEY',
  ]);
  if (publish) requireEnv(['IG_USER_ID', 'IG_ACCESS_TOKEN']);

  console.log(`Starting pipeline for: "${topic}"`);

  const { script, hook, caption } = await generateContent(topic);
  console.log('✓ Script and caption generated');

  const [voiceoverBuffer, backgroundBuffer] = await Promise.all([
    generateVoiceover(script),
    generateBackground(topic),
  ]);

  const [voiceover, background] = await Promise.all([
    uploadToShotstack(voiceoverBuffer, 'audio/mpeg'),
    uploadToShotstack(backgroundBuffer, 'image/png'),
  ]);
  console.log('✓ Assets uploaded to Shotstack Ingest');

  // Ingest reports the voiceover's duration, so the visuals can end with the
  // narration instead of running to a fixed length and leaving dead air.
  const duration = voiceover.duration ?? FALLBACK_DURATION;

  const videoUrl = await renderReel(
    background.url,
    voiceover.url,
    hook,
    duration,
  );
  console.log('✓ Reel rendered:', videoUrl);

  if (!publish) {
    console.log('Skipping Instagram publish. Pass --publish to post it.');
    return { videoUrl, caption };
  }

  const mediaId = await postToInstagram(videoUrl, caption);
  console.log('✓ Published to Instagram. Media ID:', mediaId);

  return { mediaId, videoUrl, caption };
}

async function main() {
  const args = process.argv.slice(2);
  const publish = args.includes('--publish');
  const topic = args.find((arg) => !arg.startsWith('--'));

  if (!topic) {
    console.error(
      'Usage: node --env-file=.env index.js "<topic>" [--publish]\n\n' +
        'Renders a Reel and prints the video URL. Add --publish to post it to Instagram.',
    );
    process.exit(1);
  }

  await createAndPostReel(topic, { publish });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
