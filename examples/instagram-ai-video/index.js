import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const INGEST_BASE = 'https://api.shotstack.io/ingest/v1';
const INGEST_HEADERS = { 'x-api-key': process.env.SHOTSTACK_API_KEY };

const EDIT_BASE = 'https://api.shotstack.io/edit/v1';
const EDIT_HEADERS = {
  'x-api-key': process.env.SHOTSTACK_API_KEY,
  'Content-Type': 'application/json',
};

const VIDEO_DURATION = 20; // seconds — matches the 15-20s script target

async function generateContent(topic) {
  const response = await openai.chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      {
        role: 'system',
        content: `You are a social media content writer. Return JSON only, no markdown.
Schema: { "script": string, "caption": string }
- script: a 15-20 second voiceover narration (~40 words), punchy and direct
- caption: under 75 characters with 2-3 relevant hashtags`,
      },
      {
        role: 'user',
        content: `Write a script and caption for an Instagram Reel about: ${topic}`,
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
  const model = process.env.OPENAI_IMAGE_MODEL;
  const result = await openai.images.generate({
    model,
    prompt: `Cinematic vertical background image for an Instagram Reel about: ${topic}.
Bold colors, visually striking, no text, no people. Designed for 9:16 portrait format.`,
    size: '1024x1536',
    quality: 'medium',
  });

  return Buffer.from(result.data[0].b64_json, 'base64');
}

async function uploadToShotstack(buffer, contentType) {
  // 1. Request a signed upload URL
  const uploadRes = await fetch(`${INGEST_BASE}/upload`, {
    method: 'POST',
    headers: { ...INGEST_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!uploadRes.ok)
    throw new Error(`Ingest upload init failed: ${uploadRes.status}`);
  const { data } = await uploadRes.json();
  const { id: sourceId, url: signedUrl } = data.attributes;

  // 2. Upload binary data to the signed URL
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!putRes.ok) throw new Error(`Signed URL upload failed: ${putRes.status}`);

  // 3. Poll until ready (usually a few seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${INGEST_BASE}/sources/${sourceId}`, {
      headers: INGEST_HEADERS,
    });
    const { data: src } = await statusRes.json();
    if (src.attributes.status === 'ready') return src.attributes.source;
    if (src.attributes.status === 'failed')
      throw new Error('Shotstack ingest failed');
  }

  throw new Error('Shotstack ingest timed out');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function renderReel(backgroundUrl, voiceoverUrl, hookText) {
  const edit = {
    timeline: {
      soundtrack: { src: voiceoverUrl, effect: 'fadeOut' },
      tracks: [
        {
          // Text hook overlay (top layer)
          clips: [
            {
              asset: {
                type: 'html5',
                html: `<p>${escapeHtml(hookText)}</p>`,
                css: `p {
                  font-family: "Open Sans"; font-size: 42px;
                  color: white; text-align: center;
                  text-shadow: 2px 2px 8px rgba(0,0,0,0.8);
                  padding: 20px;
                }`,
              },
              start: 0,
              length: VIDEO_DURATION,
              width: 1080,
              height: 300,
              position: 'bottom',
              offset: { y: 0.15 },
            },
          ],
        },
        {
          // Background image (bottom layer)
          clips: [
            {
              asset: { type: 'image', src: backgroundUrl },
              start: 0,
              length: VIDEO_DURATION,
              fit: 'crop',
              effect: 'zoomIn',
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
    headers: EDIT_HEADERS,
    body: JSON.stringify(edit),
  });
  if (!renderRes.ok)
    throw new Error(`Shotstack render submit failed: ${renderRes.status}`);
  const { response } = await renderRes.json();

  // Poll until done
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${EDIT_BASE}/render/${response.id}`, {
      headers: EDIT_HEADERS,
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
  const BASE = 'https://graph.facebook.com/v25.0';

  // The Graph API accepts both JSON and form-encoded bodies; form-encoded is used
  // here to match Meta's own examples and Postman collection.

  // 1. Create the Reels container
  const containerRes = await fetch(`${BASE}/${igUserId}/media`, {
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

  // 2. Poll until FINISHED — once per minute, up to 5 minutes (per Meta's guidance)
  let isFinished = false;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 60_000));
    const statusRes = await fetch(
      `${BASE}/${containerId}?fields=status_code&access_token=${accessToken}`,
    );
    if (!statusRes.ok)
      throw new Error(`Container status check failed: ${statusRes.status}`);
    const { status_code } = await statusRes.json();
    if (status_code === 'FINISHED') {
      isFinished = true;
      break;
    }
    if (status_code === 'ERROR' || status_code === 'EXPIRED')
      throw new Error(`Instagram container ${status_code.toLowerCase()}`);
  }
  if (!isFinished)
    throw new Error(
      'Instagram container was not ready to publish after 5 minutes',
    );

  // 3. Publish the container
  const publishRes = await fetch(`${BASE}/${igUserId}/media_publish`, {
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

async function createAndPostReel(topic) {
  console.log(`Starting pipeline for: "${topic}"`);

  const { script, caption } = await generateContent(topic);
  console.log('✓ Script and caption generated');

  // Generate voiceover and background image in parallel
  const [voiceoverBuffer, backgroundBuffer] = await Promise.all([
    generateVoiceover(script),
    generateBackground(topic),
  ]);

  // Upload both assets to Shotstack Ingest in parallel
  const [voiceoverUrl, backgroundUrl] = await Promise.all([
    uploadToShotstack(voiceoverBuffer, 'audio/mpeg'),
    uploadToShotstack(backgroundBuffer, 'image/png'),
  ]);
  console.log('✓ Assets uploaded to Shotstack Ingest');

  const hookText = script.split('.')[0];
  const videoUrl = await renderReel(backgroundUrl, voiceoverUrl, hookText);
  console.log('✓ Reel rendered:', videoUrl);

  const mediaId = await postToInstagram(videoUrl, caption);
  console.log('✓ Published to Instagram. Media ID:', mediaId);

  return { mediaId, videoUrl, caption };
}

// Run it
createAndPostReel('the future of remote work').catch(console.error);
