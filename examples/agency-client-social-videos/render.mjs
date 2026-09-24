import { readFile } from 'node:fs/promises';
import { fail, requireConfig, submitRender } from './api.mjs';
import { buildEdit } from './edit.mjs';
import { recordRender } from './renders.mjs';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const MEDIA_TYPES = ['image', 'video'];

requireConfig();

let clients;

try {
  clients = JSON.parse(
    await readFile(new URL('./clients.json', import.meta.url), 'utf8')
  );
} catch (error) {
  fail(`Could not read clients.json: ${error.message}`);
}

if (!Array.isArray(clients) || clients.length === 0) {
  fail('clients.json must contain an array with at least one client.');
}

const problems = [];

clients.forEach((client, index) => {
  const label = client.slug ?? `client ${index + 1}`;

  if (!client.slug || !client.name) {
    problems.push(`${label}: slug and name are required.`);
  }

  if (!HEX_COLOR.test(client.brandColor ?? '')) {
    problems.push(`${label}: brandColor must be a six-digit hex color.`);
  }

  if (!/^<svg[\s>]/.test(client.brandMark ?? '')) {
    problems.push(`${label}: brandMark must be SVG markup.`);
  }

  if (!Array.isArray(client.media) || client.media.length === 0) {
    problems.push(`${label}: media must list at least one image or video.`);
    return;
  }

  client.media.forEach((item, position) => {
    if (!MEDIA_TYPES.includes(item.type) || !/^https:\/\//.test(item.src)) {
      problems.push(
        `${label}: media item ${position + 1} needs a type (image or video) and an HTTPS src.`
      );
    }
  });
});

if (problems.length > 0) {
  fail(problems.join('\n'));
}

let submitted = 0;

for (const client of clients) {
  try {
    const renderId = await submitRender(buildEdit(client), client.slug);

    await recordRender({
      renderId,
      slug: client.slug,
      submittedAt: new Date().toISOString()
    });

    console.log(`${client.slug} → ${renderId}`);
    submitted += 1;
  } catch (error) {
    if (error.fatal) {
      fail(error.message);
    }

    console.error(error.message);
    process.exitCode = 1;
  }
}

console.log(`${submitted}/${clients.length} submitted`);
