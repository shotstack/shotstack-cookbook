// On-brand product videos from a brand guide (brand.json) and a product export (products.csv).
//
//   node pipeline.js --dry              write the template to out/template.json, no API calls
//   node pipeline.js [file.csv]         show what a run would do, then stop
//   node pipeline.js [file.csv] --yes   make a video for every product (production: uses credits)
//
// Needs SHOTSTACK_API_KEY (production key), ANTHROPIC_API_KEY and ffmpeg on your PATH.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const SHOTSTACK = 'https://api.shotstack.io/edit/v1';
const CLAUDE_MODEL = 'claude-sonnet-5-5';
const IMAGE_MODEL = 'nano-banana-2-edit';
const VIDEO_MODEL = 'wan-3.0-prime-image-to-video';
const PRODUCTS_AT_ONCE = 3;
const MAX_TRIES = { script: 3, still: 2, clip: 2 };
const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 300_000;

// Files next to this script, wherever the script is run from
const here = file => fileURLToPath(new URL(file, import.meta.url));
const OUT = here('out');
// A value from a map in brand.json. A plain lookup would also find "constructor"
const own = (map, key) =>
  Object.hasOwn(map ?? {}, key) ? map[key] : undefined;

// Every key the pipeline reads from brand.json, so a missing one is named before anything runs
const BRAND_KEYS =
  `name labels layout.titleMax layout.detailMax colors.panel colors.text
  colors.mark font.family font.src voice.tone voice.maxWords voice.avoid voice.claimsNeedData
  voice.avoidPatterns voice.hooks voice.examples voiceover.model voiceover.voice visual.backdrops
  visual.shot visual.light visual.rules visual.motion visual.camera music.model music.prompt
  music.options`.split(/\s+/);

function readBrand() {
  let guide;
  try {
    guide = JSON.parse(fs.readFileSync(here('brand.json'), 'utf8'));
  } catch (error) {
    console.error(`brand.json: ${error.message}`);
    process.exit(1);
  }
  const missing = BRAND_KEYS.filter(
    key => key.split('.').reduce((value, part) => value?.[part], guide) == null
  );
  if (missing.length) {
    console.error(`brand.json needs ${missing.join(', ')}`);
    process.exit(1);
  }
  return guide;
}

export const brand = readBrand();

// ---------- The template ----------
// A 1080x1920 video, 6.5 seconds long. The product clip fills the top 62% and the brand
// panel covers the rest. Fonts, colors, layout and music never change between videos;
// the merge fields in {{ }} are filled in for each product.
const WIDTH = 1080;
const HEIGHT = 1920;
const SECONDS = 6.5;
const PANEL_TOP = 1190; // 62% of the height
const MARGIN = 108;
const TEXT_WIDTH = WIDTH - 2 * MARGIN;

// Shotstack offsets are measured from the center of the frame, as a fraction of its size.
// This turns a point in pixels (from the top left) into an offset.
const round = n => Math.round(n * 10000) / 10000;
const offsetFor = (x, y) => ({
  x: round((x - WIDTH / 2) / WIDTH),
  y: round((HEIGHT / 2 - y) / HEIGHT)
});

// One line of text in the panel, centered at height y and wiping in from the left
function textLine(
  text,
  { y, size, weight, start, letterSpacing = 0, uppercase = false, opacity = 1 }
) {
  return {
    asset: {
      type: 'rich-text',
      text,
      font: {
        family: brand.font.family,
        size,
        weight,
        color: brand.colors.text,
        opacity
      },
      style: {
        letterSpacing,
        lineHeight: 1,
        textTransform: uppercase ? 'uppercase' : 'none'
      },
      align: { horizontal: 'left', vertical: 'middle' }
    },
    start,
    length: 'end',
    width: TEXT_WIDTH,
    height: Math.round(size * 1.3),
    position: 'center',
    offset: offsetFor(WIDTH / 2, y),
    transition: { in: 'reveal' }
  };
}

const svg = (width, height, shape) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shape}</svg>`;

export function buildTemplate() {
  const { colors, font, voiceover } = brand;
  const panelHeight = HEIGHT - PANEL_TOP;
  return {
    timeline: {
      background: colors.panel,
      fonts: [{ src: font.src }],
      tracks: [
        // The facts, straight from the product data: label, title, then price and detail
        {
          clips: [
            textLine('{{LABEL}}', {
              y: 1470,
              size: 64,
              weight: 400,
              start: 0.3,
              letterSpacing: 3,
              uppercase: true,
              opacity: 0.8
            })
          ]
        },
        {
          clips: [
            textLine('{{TITLE}}', {
              y: 1597,
              size: 135,
              weight: 600,
              start: 0.43,
              letterSpacing: -5
            })
          ]
        },
        {
          clips: [
            textLine('{{DETAIL}}', {
              y: 1762,
              size: 86,
              weight: 400,
              start: 0.56
            })
          ]
        },
        // Captions, transcribed from the voice-over clip
        {
          clips: [
            {
              asset: {
                type: 'rich-caption',
                src: 'alias://voice',
                font: {
                  family: font.family,
                  size: 44,
                  weight: 600,
                  color: colors.text
                },
                animation: { style: 'fade' }
              },
              start: 0,
              length: 'end',
              width: TEXT_WIDTH,
              height: 140,
              position: 'center',
              offset: offsetFor(WIDTH / 2, 1280)
            }
          ]
        },
        // The brand mark, top left
        {
          clips: [
            {
              asset: {
                type: 'svg',
                src: svg(
                  173,
                  173,
                  `<circle cx="86.5" cy="86.5" r="86.5" fill="${colors.mark}"/>`
                )
              },
              start: 0,
              length: 'end',
              fit: 'none',
              width: 173,
              height: 173,
              position: 'center',
              offset: offsetFor(MARGIN + 86.5, MARGIN + 86.5),
              transition: { in: 'fade' }
            }
          ]
        },
        // The brand panel over the bottom 38%
        {
          clips: [
            {
              asset: {
                type: 'svg',
                src: svg(
                  WIDTH,
                  panelHeight,
                  `<rect width="${WIDTH}" height="${panelHeight}" fill="${colors.panel}"/>`
                )
              },
              start: 0,
              length: 'end',
              fit: 'none',
              width: WIDTH,
              height: panelHeight,
              position: 'bottom'
            }
          ]
        },
        // The product clip, cropped to fill the top 62% (with 5 px to spare above and below, so no
        // edge shows). With position "top" it did not sit at the top in our tests, so it's
        // positioned by its center plus an offset.
        {
          clips: [
            {
              asset: { type: 'video', src: '{{CLIP}}', volume: 0 },
              start: 0,
              length: SECONDS,
              width: WIDTH,
              height: PANEL_TOP + 10,
              fit: 'crop',
              position: 'center',
              offset: offsetFor(WIDTH / 2, PANEL_TOP / 2)
            }
          ]
        },
        // The voice-over, generated from the checked script while the video renders
        {
          clips: [
            {
              asset: {
                type: 'audio',
                model: voiceover.model,
                prompt: '{{SCRIPT}}',
                options: { voice: voiceover.voice }
              },
              alias: 'voice',
              start: 0.4,
              length: 'auto'
            }
          ]
        },
        // The music, generated once per run before any video renders
        {
          clips: [
            {
              asset: { type: 'audio', src: '{{MUSIC}}', volume: 0.35 },
              start: 0,
              length: SECONDS
            }
          ]
        }
      ]
    },
    output: { format: 'mp4', size: { width: WIDTH, height: HEIGHT } },
    merge: ['LABEL', 'TITLE', 'DETAIL', 'SCRIPT', 'CLIP', 'MUSIC'].map(
      find => ({ find, replace: '' })
    )
  };
}

// ---------- The store's data ----------
// The rows of a CSV text, including quoted fields that contain commas, quotes or line breaks
function parseCsv(text, file) {
  const rows = [[]];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      rows.at(-1).push(field);
      field = '';
    } else if (char === '\n') {
      rows.at(-1).push(field.replace(/\r$/, ''));
      rows.push([]);
      field = '';
    } else field += char;
  }
  if (quoted)
    throw new Error(`${file} has a quoted field that is never closed`);
  rows.at(-1).push(field);
  return rows.filter(row => row.some(value => value.trim()));
}

const COLUMNS =
  'handle title product_type price detail badge features image_src'.split(' ');

// The rows of a CSV file as objects keyed by its header, after a check that the columns
// the caller needs are there and that every row has as many fields as the header
function readCsv(file, required) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    throw new Error(`Can't read ${file}: ${error.code ?? error.message}`);
  }
  // An empty file has the columns the caller needs and no rows
  const [header = required, ...records] = parseCsv(text, file);
  const names = header.map(name => name.trim());
  const absent = required.filter(name => !names.includes(name));
  if (absent.length)
    throw new Error(`${file} has no ${absent.join(', ')} column`);
  const odd = records.findIndex(record => record.length !== names.length);
  if (odd >= 0)
    throw new Error(
      `${file}, row ${odd + 1}: ${records[odd].length} fields, but the header has ${names.length}`
    );
  const rows = records.map(record =>
    Object.fromEntries(names.map((name, i) => [name, record[i].trim()]))
  );
  return { names, rows };
}

export const readProducts = file => readCsv(file, COLUMNS).rows;

// What goes on screen comes from the data, never from the AI. Every row is checked against
// the layout and the brand guide before anything is spent on it.
export function checkRow(row) {
  const values = {
    LABEL: own(brand.labels, row.badge) ?? '',
    TITLE: row.title ?? '',
    DETAIL: `${row.price} · ${row.detail}`
  };
  const problems = ['handle', 'title', 'price', 'detail']
    .filter(field => !row[field])
    .map(field => `the ${field} is missing`);
  if (row.handle && !/^[a-z0-9][a-z0-9-]*$/.test(row.handle))
    problems.push(
      `the handle "${row.handle}" must start with a letter or a digit and can only use a-z, 0-9 and -`
    );
  if (!values.LABEL)
    problems.push(`brand.json has no label for the badge "${row.badge}"`);
  if (!own(brand.visual.motion, row.product_type))
    problems.push(
      `brand.json has no motion line for the product type "${row.product_type}"`
    );
  if (!/^https:\/\//.test(row.image_src ?? ''))
    problems.push('the packshot URL is missing or not https');
  if (values.TITLE.length > brand.layout.titleMax)
    problems.push(
      `the title "${values.TITLE}" is ${values.TITLE.length} characters; the layout fits ${brand.layout.titleMax}`
    );
  if (values.DETAIL.length > brand.layout.detailMax)
    problems.push(
      `"${values.DETAIL}" is ${values.DETAIL.length} characters; the layout fits ${brand.layout.detailMax}`
    );
  return { values, problems };
}

// ---------- API helpers ----------
const sleep = seconds =>
  new Promise(resolve => setTimeout(resolve, seconds * 1000));

// fetch with a time limit. A 429 is retried, because the server refused the request and
// created nothing. A 408, a 5xx, a timeout or a network error is retried only when
// `repeatable` is true: on a POST that starts a paid job, the job may already exist, so a
// retry could pay twice.
async function send(
  url,
  options,
  { repeatable = true, timeout = REQUEST_TIMEOUT } = {}
) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout)
      });
    } catch (error) {
      if (repeatable && attempt < 5) {
        await sleep(2 ** attempt * 2);
        continue;
      }
      const { host } = new URL(url);
      throw new Error(
        error.name === 'TimeoutError'
          ? `${host} did not answer in ${timeout / 1000} seconds`
          : `Can't reach ${host} (${error.cause?.code ?? error.message})`
      );
    }
    const temporary =
      res.status === 429 ||
      (repeatable && (res.status === 408 || res.status >= 500));
    if (!temporary || attempt === 5) return res;
    await sleep(2 ** attempt * 2);
  }
}

// The reason in an error body: Shotstack sends errors[0].detail, response.error or message,
// and Anthropic sends error.message
function errorDetail(body) {
  const detail =
    body?.errors?.[0]?.detail ??
    body?.response?.error ??
    body?.error?.message ??
    body?.message;
  return typeof detail === 'string'
    ? detail
    : JSON.stringify(body).slice(0, 300);
}

// Sends the request and returns the parsed JSON body
async function request(url, options, retry) {
  const res = await send(url, options, retry);
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw Object.assign(
      new Error(
        `${options?.method ?? 'GET'} ${url} returned ${res.status}: ${errorDetail(body)}`
      ),
      { status: res.status }
    );
  if (!body || typeof body !== 'object')
    throw new Error(`${url} returned a body that is not a JSON object`);
  return body;
}

const shotstack = (method, path, body) =>
  request(
    `${SHOTSTACK}${path}`,
    {
      method,
      headers: {
        'x-api-key': process.env.SHOTSTACK_API_KEY,
        'content-type': 'application/json'
      },
      body: body && JSON.stringify(body)
    },
    { repeatable: method === 'GET' }
  );

// A retry here is safe: a failed request has no effect, and a repeated one costs a few tokens.
// The model thinks before it answers and the thinking counts against max_tokens, so the
// limit leaves room for it. A low effort is enough for a 12-word script or a verdict on
// two images.
async function askClaude(system, content) {
  const reply = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content }]
    })
  });
  if (reply.stop_reason !== 'end_turn')
    throw new Error(`Claude stopped early (${reply.stop_reason})`);
  return reply.content.map(block => block.text ?? '').join('');
}

// The JSON object in a model's reply (ignoring code fences or text around it), or null
function parseJson(text) {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

// Calls check() until it returns something, with a time limit
async function waitFor(what, check, { every, minutes }) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline)
      throw new Error(`${what} is still not finished after ${minutes} minutes`);
    await sleep(every);
  }
}

export async function download(url, file) {
  const res = await send(url, undefined, { timeout: DOWNLOAD_TIMEOUT });
  if (!res.ok) throw new Error(`downloading ${url} returned ${res.status}`);
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
}

// Generates one image, video or audio file and returns its URL. An identical request
// returns the file generated last time, at no charge.
export async function generate(asset, length) {
  let job = await shotstack(
    'POST',
    '/generate',
    length ? { asset, length } : { asset }
  );
  return waitFor(
    `${asset.type} generation ${job.id}`,
    async () => {
      if (job.status !== 'done' && job.status !== 'failed')
        job = await shotstack('GET', `/generate/${job.id}`);
      if (job.status === 'failed')
        throw new Error(`${asset.type} generation failed: ${job.error}`);
      if (job.status === 'done' && !job.url)
        throw new Error(`${asset.type} generation is done but has no url`);
      return job.status === 'done' ? job.url : null;
    },
    { every: 4, minutes: 15 }
  );
}

// ---------- Guardrails on the words ----------
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = word => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');

export function checkScript(script, row) {
  const { voice } = brand;
  const words = script.split(/\s+/).filter(Boolean);
  if (!words.length) return ['the script is empty'];
  const problems = [];
  if (words.length > voice.maxWords)
    problems.push(
      `it is ${words.length} words; the limit is ${voice.maxWords}`
    );
  const avoided = voice.avoid.filter(word => wordPattern(word).test(script));
  if (avoided.length)
    problems.push(`it uses words the brand avoids: ${avoided.join(', ')}`);
  const facts = `${row.title} ${row.features} ${row.detail}`;
  const claims = voice.claimsNeedData.filter(
    word => wordPattern(word).test(script) && !wordPattern(word).test(facts)
  );
  if (claims.length)
    problems.push(
      `it claims something the product data doesn't say: ${claims.join(', ')}`
    );
  const spoken = script.replace(new RegExp(escapeRegExp(row.title), 'gi'), '');
  if (/[0-9$€£%]|\b(dollars?|cents?|bucks|discount|sale)\b/i.test(spoken))
    problems.push(
      'it mentions a number, price or discount (the price is on screen, from the data)'
    );
  if (/[!"“”]|\p{Extended_Pictographic}/u.test(script))
    problems.push('it has an exclamation mark, quote marks or an emoji');
  if (script.split(/[,;]/).length > 2)
    problems.push('it reads like a feature list');
  return problems;
}

// The AI writes only the voice-over script. Code checks it, and failures go back with the reasons.
export async function writeScript(row) {
  const { voice } = brand;
  const system = [
    `You write voice-over scripts for ${brand.name} product videos. ${voice.tone}`,
    'Reply with one JSON object and nothing else: {"script": "..."}',
    `Use at most ${voice.maxWords} words, in two short beats. Only claim what the product's features say, but you don't have to mention them.`,
    `Don't do these: ${voice.avoidPatterns.join('; ')}.`,
    `Never use numbers, prices, discounts, exclamation marks, quote marks or emoji. Never use these words: ${voice.avoid.join(', ')}.`,
    `Scripts in our voice:\n${voice.examples.map(line => `- ${line}`).join('\n')}`
  ].join('\n');
  const product = `Product: ${row.title}. Type: ${row.product_type}. Features: ${row.features}. Detail: ${row.detail}. Badge: ${row.badge}, so ${own(voice.hooks, row.badge) ?? 'open by naming the product'}.`;
  const attempts = [];
  let prompt = product;
  for (let i = 0; i < MAX_TRIES.script; i++) {
    const script = String(
      parseJson(await askClaude(system, prompt))?.script ?? ''
    ).trim();
    const problems = checkScript(script, row);
    attempts.push({ script, problems });
    if (!problems.length) {
      console.log(`${row.handle}: script passed on try ${i + 1}: "${script}"`);
      return { script, attempts };
    }
    console.log(
      `${row.handle}: script try ${i + 1} failed ("${script}"): ${problems.join('; ')}`
    );
    prompt = `${product}\nYour last script was "${script}". Fix these problems: ${problems.join('; ')}.`;
  }
  return { script: null, attempts };
}

// ---------- Guardrails on the pictures ----------
// An LLM with vision compares generated images with the store's packshot. The check runs
// twice and both answers must pass, because the same image can pass once and fail the next time.
const CHECKER =
  'You check product images for an online store. Reply with one JSON object and nothing else: {"match": true or false, "issues": ["..."]}. When match is true, issues must be an empty list. Describe each issue in terms of the product, not image numbers.';

// Only a well-formed reply with "match": true and no issues counts as a pass
export function readVerdict(reply) {
  const verdict = parseJson(reply);
  if (
    !verdict ||
    typeof verdict.match !== 'boolean' ||
    !Array.isArray(verdict.issues)
  ) {
    return {
      pass: false,
      issues: ['the checker reply was not in the expected format']
    };
  }
  const issues = verdict.issues.map(String);
  if (!verdict.match && !issues.length)
    issues.push('the checker failed it without saying why');
  return { pass: verdict.match && !issues.length, issues };
}

async function compareWithPackshot(row, images, instructions) {
  const content = [
    { type: 'text', text: "Image 1, the store's product photo:" },
    { type: 'image', source: { type: 'url', url: row.image_src } },
    ...images.flatMap((source, i) => [
      { type: 'text', text: `Image ${i + 2}:` },
      { type: 'image', source }
    ]),
    { type: 'text', text: instructions }
  ];
  const verdicts = (
    await Promise.all([1, 2].map(() => askClaude(CHECKER, content)))
  ).map(readVerdict);
  return {
    pass: verdicts.every(v => v.pass),
    issues: [...new Set(verdicts.flatMap(v => v.issues))]
  };
}

// An image-edit model puts the store's real product on a brand backdrop, or in the scene
// brand.json sets for its type, using the packshot as its reference. The prompt comes from brand.json, so nobody types a free prompt.
export async function makeStill(row, backdrop) {
  const { visual } = brand;
  const attempts = [];
  for (let i = 0; i < MAX_TRIES.still; i++) {
    const issues = attempts.at(-1)?.check.issues;
    const prompt = [
      (own(visual.scenes, row.product_type) ?? visual.shot)
        .replaceAll('{backdrop}', backdrop)
        .replaceAll('{light}', visual.light),
      ...visual.rules,
      ...(issues
        ? [`Fix these problems from the last attempt: ${issues.join(' ')}`]
        : [])
    ].join(' ');
    const url = await generate({
      type: 'image',
      model: IMAGE_MODEL,
      prompt,
      options: {
        imageUrls: [row.image_src],
        aspectRatio: '3:4',
        resolution: '2K'
      }
    });
    // The checker gets the same rules from brand.json as the image model
    const check = await compareWithPackshot(
      row,
      [{ type: 'url', url }],
      `Image 2 is a generated studio shot that must show exactly the same product as image 1 ("${row.title}"), and no other product. Compare color, shape, material and visible details. Fail it if anything a shopper would notice is different, or if it breaks any of these rules: ${visual.rules.join(' ')}`
    );
    attempts.push({ url, check });
    if (check.pass) {
      console.log(`${row.handle}: still passed both checks on try ${i + 1}`);
      return { url, attempts };
    }
    console.log(
      `${row.handle}: still try ${i + 1} failed: ${check.issues.join('; ')}`
    );
  }
  return { url: null, attempts };
}

// ---------- Guardrails on the motion ----------
// Frames from the middle and the end of the part of the clip that appears in the video
async function framesFrom(file) {
  return Promise.all(
    [SECONDS / 2, SECONDS - 0.25].map(async (second, i) => {
      const jpg = `${file}.frame${i + 1}.jpg`;
      fs.rmSync(jpg, { force: true });
      const { stderr } = await execFileAsync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-ss',
        String(second),
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        'scale=512:-1',
        jpg
      ]).catch(error => error);
      if (!fs.existsSync(jpg))
        throw new Error(
          `ffmpeg could not take a frame at ${second} seconds from ${path.basename(file)}: ${stderr?.trim() || 'the clip may be shorter'}`
        );
      return {
        type: 'base64',
        media_type: 'image/jpeg',
        data: fs.readFileSync(jpg).toString('base64')
      };
    })
  );
}

// An image-to-video model animates the approved still with the motion line for its product
// type. The clip is checked before it goes anywhere near a render.
export async function makeClip(row, still) {
  const { visual } = brand;
  const attempts = [];
  for (let i = 0; i < MAX_TRIES.clip; i++) {
    const issues = attempts.at(-1)?.check.issues;
    const prompt = [
      visual.motion[row.product_type],
      visual.camera,
      ...(issues
        ? [`Avoid these problems from the last attempt: ${issues.join(' ')}`]
        : [])
    ].join(' ');
    // The model makes whole seconds and bills them rounded up, so ask for whole seconds
    const url = await generate(
      {
        type: 'video',
        model: VIDEO_MODEL,
        prompt,
        options: {
          startSrc: still,
          aspectRatio: '3:4',
          resolution: '1080p',
          generateAudio: false
        }
      },
      Math.ceil(SECONDS)
    );
    const file = path.join(OUT, 'clips', `${row.handle}-${i + 1}.mp4`);
    await download(url, file);
    const check = await compareWithPackshot(
      row,
      await framesFrom(file),
      `The other images are frames from a short video of "${row.title}". Every frame must show exactly the same product as image 1: the same shape, parts, color and material, with nothing added or removed (for example no new handle, strap or lid). Fail it if the product changes in any frame, or if a person, hand, text or logo appears. The motion this video was asked for is expected and passes: ${visual.motion[row.product_type]}`
    );
    attempts.push({ url, check });
    if (check.pass) {
      console.log(`${row.handle}: clip passed both checks on try ${i + 1}`);
      return { url, attempts };
    }
    console.log(
      `${row.handle}: clip try ${i + 1} failed: ${check.issues.join('; ')}`
    );
  }
  return { url: null, attempts };
}

// ---------- Rendering ----------
// The first run saves the template and keeps its id in out/template.id. Later runs update
// that template, so a change to brand.json applies and the dashboard has one copy.
export async function saveTemplate() {
  const idFile = path.join(OUT, 'template.id');
  const body = {
    name: `${brand.name} product video`,
    template: buildTemplate()
  };
  const saved = fs.existsSync(idFile)
    ? fs.readFileSync(idFile, 'utf8').trim()
    : '';
  if (saved)
    try {
      await shotstack('PUT', `/templates/${saved}`, body);
      return saved;
    } catch (error) {
      // A 404 means the template was deleted in the dashboard, so it is saved again below
      if (error.status !== 404) throw error;
    }
  const { response } = await shotstack('POST', '/templates', body);
  if (!response?.id)
    throw new Error('the template was saved but the reply has no id');
  fs.writeFileSync(idFile, response.id);
  return response.id;
}

// The music is the same for every product, so it's generated once, before any video renders,
// and every video uses the same file.
export function generateMusic() {
  const { model, prompt, options } = brand.music;
  return generate({ type: 'audio', model, prompt, options }, SECONDS);
}

// Renders one video from the template and waits for it. The status response has a download
// URL that expires after 24 hours, and the owner ID that the permanent CDN URL is built from.
export async function renderVideo(templateId, values) {
  const merge = Object.entries(values).map(([find, replace]) => ({
    find,
    replace
  }));
  const { response: queued } = await shotstack('POST', '/templates/render', {
    id: templateId,
    merge
  });
  if (!queued?.id)
    throw new Error(
      'the render request was accepted but the reply has no render id'
    );
  const done = await waitFor(
    `render ${queued.id}`,
    async () => {
      const { response: render } = await shotstack(
        'GET',
        `/render/${queued.id}`
      );
      if (!render)
        throw new Error(`the status reply for render ${queued.id} is empty`);
      if (render.status === 'failed')
        throw new Error(`render ${queued.id} failed: ${render.error}`);
      return render.status === 'done' ? render : null;
    },
    { every: 6, minutes: 20 }
  );
  if (!done.url || !done.owner)
    throw new Error(`render ${queued.id} is done but has no url`);
  return {
    id: done.id,
    downloadUrl: done.url,
    url: `https://cdn.shotstack.io/au/v1/${done.owner}/${done.id}.mp4`
  };
}

// A person approves every video before it's posted. Rows are added as products finish.
// A held row belongs to the pipeline: the next run that looks at the product replaces it.
// A row with a video belongs to the reviewer and is never changed.
export function approvalSheet(file) {
  const columns = ['handle', 'product', 'script', 'video', 'approved', 'notes'];
  // A cell that starts with = + - or @ would run as a formula in a spreadsheet
  const cell = value =>
    `"${String(value ?? '')
      .replace(/^[=+\-@]/, "'$&")
      .replace(/"/g, '""')}"`;
  // The file keeps its own header, so a column the reviewer adds or moves survives a rewrite
  const read = () =>
    fs.existsSync(file) ? readCsv(file, columns) : { names: columns, rows: [] };
  const write = (names, rows) =>
    fs.writeFileSync(
      file,
      [
        names.map(cell).join(','),
        ...rows.map(row => names.map(name => cell(row[name])).join(','))
      ].join('\n') + '\n'
    );
  return {
    // The permanent link of the latest video made for this handle in an earlier run, if any
    videoFor: handle =>
      read().rows.findLast(r => r.handle === handle && r.video)?.video,
    add: ({ row, script = '', video = '', notes = '' }) => {
      const { names, rows } = read();
      const kept = rows.filter(r => !(r.handle === row.handle && !r.video));
      if (
        !video ||
        !kept.some(r => r.handle === row.handle && r.video === video)
      )
        kept.push({
          handle: row.handle,
          product: row.title,
          script,
          video,
          approved: notes.startsWith('held:') ? 'no' : '',
          notes
        });
      write(names, kept);
    }
  };
}

// A video from an earlier run that was never downloaded. The sheet has its permanent link.
async function downloadEarlier(handle, url) {
  try {
    await download(url, path.join(OUT, `${handle}.mp4`));
    console.log(`${handle}: downloaded the video from the earlier run`);
    return true;
  } catch (error) {
    console.log(`${handle}: ${error.message}, so the video is made again`);
    return false;
  }
}

async function makeVideo(row, backdrop, templateId, music) {
  const copy = await writeScript(row);
  if (!copy.script)
    return {
      row,
      notes: `held: the script failed the brand checks ${MAX_TRIES.script} times (${copy.attempts.at(-1).problems.join('; ')})`
    };
  const still = await makeStill(row, backdrop);
  if (!still.url)
    return {
      row,
      script: copy.script,
      notes: `held: the product still failed the checks (${still.attempts.at(-1).check.issues.join('; ')})`
    };
  const clip = await makeClip(row, still.url);
  if (!clip.url)
    return {
      row,
      script: copy.script,
      notes: `held: the motion clip changed the product (${clip.attempts.at(-1).check.issues.join('; ')})`
    };
  const video = await renderVideo(templateId, {
    ...checkRow(row).values,
    SCRIPT: copy.script,
    CLIP: clip.url,
    MUSIC: music
  });
  console.log(`${row.handle}: done, ${video.url}`);
  try {
    await download(video.downloadUrl, path.join(OUT, `${row.handle}.mp4`));
  } catch (error) {
    return {
      row,
      script: copy.script,
      video: video.url,
      notes: `the render is done, but the download failed (${error.message}). The next run tries the link in this row before it renders the product again`
    };
  }
  return { row, script: copy.script, video: video.url };
}

// Runs fn on every item, with at most `limit` running at the same time
async function inParallel(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
}

async function main() {
  const { values: flags, positionals: files } = parseArgs({
    options: { dry: { type: 'boolean' }, yes: { type: 'boolean' } },
    allowPositionals: true
  });
  if (files.length > 1) throw new Error('Pass one .csv file at most.');
  if (flags.dry) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'template.json'),
      JSON.stringify(buildTemplate(), null, 2)
    );
    return console.log('Wrote out/template.json');
  }

  // Check the setup before spending anything
  const missing = ['SHOTSTACK_API_KEY', 'ANTHROPIC_API_KEY'].filter(
    key => !process.env[key]
  );
  if (missing.length)
    throw new Error(
      `Set ${missing.join(' and ')} first (see .env.example). To check the template without keys, use --dry.`
    );
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error(
      'ffmpeg is not on your PATH. The pipeline uses it to check each clip. Install it, then run again.'
    );
  }
  const products = readProducts(
    files[0] ? path.resolve(files[0]) : here('products.csv')
  );

  // Check every row, and skip the products that already have a video. A video that was
  // rendered in an earlier run but not downloaded is downloaded again, not made again.
  const sheet = approvalSheet(path.join(OUT, 'approval.csv'));
  const ready = [];
  const held = [];
  const handles = new Set();
  for (const [i, row] of products.entries()) {
    const { problems } = checkRow(row);
    if (handles.has(row.handle))
      problems.push(`the handle "${row.handle}" is used by an earlier row`);
    handles.add(row.handle);
    const earlier = sheet.videoFor(row.handle);
    if (problems.length) {
      console.log(`${row.handle}: held, ${problems.join('; ')}`);
      held.push({ row, notes: `held: ${problems.join('; ')}` });
    } else if (fs.existsSync(path.join(OUT, `${row.handle}.mp4`))) {
      console.log(
        `${row.handle}: skipped, out/${row.handle}.mp4 already exists`
      );
    } else if (!earlier || !(await downloadEarlier(row.handle, earlier))) {
      ready.push({
        row,
        backdrop: brand.visual.backdrops[i % brand.visual.backdrops.length]
      });
    }
  }

  // Each product can use every try on its stills and clips, and its render generates a
  // voice-over. The music is generated once.
  const worstCase = `${ready.length} products, at most ${ready.length * (MAX_TRIES.still + MAX_TRIES.clip + 1) + 1} generations (images, clips, voice-overs and music) and ${ready.length} renders, all on production credits.`;
  if (ready.length && !flags.yes)
    return console.log(`${worstCase} Add --yes to start. Nothing was spent.`);
  fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
  held.forEach(sheet.add);
  if (!ready.length) return console.log('No products to make.');
  console.log(worstCase);

  // A rejected Anthropic key would otherwise show up only after the music is paid for
  await request('https://api.anthropic.com/v1/models?limit=1', {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  });
  const templateId = await saveTemplate();
  const music = await generateMusic();
  console.log(`Template ${templateId} ready, music ready`);

  await inParallel(ready, PRODUCTS_AT_ONCE, async ({ row, backdrop }) => {
    try {
      sheet.add(await makeVideo(row, backdrop, templateId, music));
    } catch (error) {
      console.log(`${row.handle}: held, ${error.message}`);
      sheet.add({ row, notes: `held: ${error.message}` });
    }
  });
  console.log('Approval sheet: out/approval.csv');
}

// Run main() only when this file is run directly, so other scripts can import its functions
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
