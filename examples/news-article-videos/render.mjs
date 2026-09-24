import { readFile } from 'node:fs/promises';
import { fail, requireConfig, submitRender } from './api.mjs';
import { recordRender } from './renders.mjs';

const REQUIRED_FIELDS = ['slug', 'headline'];

requireConfig();

const callback = process.env.CALLBACK_URL;

if (callback && !/^https:\/\//.test(callback)) {
  fail('CALLBACK_URL must be an HTTPS URL.');
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
  } catch (error) {
    fail(`Could not read ${name}: ${error.message}`);
  }
}

const template = await readJson('./edit.json');
const articles = await readJson('./articles.json');

if (!Array.isArray(articles) || articles.length === 0) {
  fail('articles.json must contain an array with at least one article.');
}

const problems = [];

articles.forEach((article, index) => {
  const label = article.slug ?? `article ${index + 1}`;

  for (const field of REQUIRED_FIELDS) {
    if (!article[field]) {
      problems.push(`${label}: ${field} is required.`);
    }
  }

  if (
    !Array.isArray(article.images) ||
    article.images.length !== 2 ||
    !article.images.every(url => /^https:\/\//.test(url))
  ) {
    problems.push(`${label}: images must list two HTTPS URLs.`);
  }
});

if (problems.length > 0) {
  fail(problems.join('\n'));
}

// An article that already has a video URL was rendered on an earlier run.
// status.mjs writes that URL back, so a rerun only renders new stories.
const pending = articles.filter(article => !article.videoUrl);

if (pending.length === 0) {
  console.log('Every article already has a video URL. Nothing to render.');
  process.exit(0);
}

// The template is fixed. Only the merge values change per article, so the
// same edit.json renders every story the newsroom publishes. Every
// placeholder in the template is a string, so every replace value is a string.
function editFor(article) {
  const edit = {
    ...template,
    merge: [
      { find: 'HEADLINE', replace: String(article.headline) },
      { find: 'IMAGE_1', replace: String(article.images[0]) },
      { find: 'IMAGE_2', replace: String(article.images[1]) }
    ]
  };

  if (callback) {
    edit.callback = callback;
  }

  return edit;
}

let submitted = 0;

for (const article of pending) {
  try {
    const renderId = await submitRender(editFor(article), article.slug);

    await recordRender({
      renderId,
      slug: article.slug,
      submittedAt: new Date().toISOString()
    });

    console.log(`${article.slug} → ${renderId}`);
    submitted += 1;
  } catch (error) {
    if (error.fatal) {
      fail(error.message);
    }

    console.error(error.message);
    process.exitCode = 1;
  }
}

console.log(
  `${submitted}/${pending.length} submitted, ${articles.length - pending.length} already had a video URL`
);
