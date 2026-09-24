import { readFile, writeFile } from 'node:fs/promises';
import { fail, getRender, requireConfig } from './api.mjs';
import { readRenders } from './renders.mjs';

requireConfig();

let rows;

try {
  rows = await readRenders();
} catch (error) {
  fail(error.message);
}

if (rows.length === 0) {
  console.log('No renders recorded yet. Run node render.mjs first.');
  process.exit(0);
}

const finished = new Map();

for (const row of rows) {
  let render;

  try {
    render = await getRender(row.renderId, row.slug);
  } catch (error) {
    if (error.fatal) {
      fail(error.message);
    }

    console.error(error.message);
    process.exitCode = 1;
    continue;
  }

  console.log(`${row.slug} → ${render.status}`);

  if (render.status === 'done') {
    console.log(`  ${render.url}`);
    finished.set(row.slug, render.url);
  }

  if (render.status === 'failed') {
    console.log(`  error: ${render.error}`);
  }
}

// Close the loop: put each finished video URL back on its article, the way a
// newsroom would write it back to the CMS. render.mjs skips these next time.
const ARTICLES = new URL('./articles.json', import.meta.url);
let articles;

try {
  articles = JSON.parse(await readFile(ARTICLES, 'utf8'));
} catch (error) {
  fail(`Could not read articles.json: ${error.message}`);
}

let written = 0;

for (const article of articles) {
  if (finished.has(article.slug) && !article.videoUrl) {
    article.videoUrl = finished.get(article.slug);
    written += 1;
  }
}

if (written > 0) {
  try {
    await writeFile(ARTICLES, `${JSON.stringify(articles, null, 2)}\n`);
  } catch (error) {
    fail(`Could not write articles.json: ${error.message}`);
  }

  console.log(`Wrote ${written} video URL(s) into articles.json`);
}
