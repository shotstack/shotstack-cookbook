// Renders one video per row of data.csv from the saved template, and downloads each one.
// Run it again after a failure: rows already downloaded are skipped, and renders that were
// sent but not downloaded are picked up again instead of being paid for twice.
// Usage: node render-videos.js [data.csv]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EDIT_API,
  api,
  waitForRender,
  download,
  readStep,
  sleep
} = require('./shotstack');

// A safety limit, not a guarantee: the card shrinks long text, but very long values still won't fit.
const MAX_LENGTH = { PRODUCT: 60, PRICE: 10 };

// Reads a CSV file with a header row. Handles quoted values with commas and "" quotes.
function readCsv(file) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`Can't find ${name}.`);
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (quoted) throw new Error(`${name} has a quote that is never closed.`);
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const [header, ...data] = rows.filter(r =>
    r.some(cell => cell.trim() !== '')
  );
  const columns = (header || []).map(cell => cell.trim());
  const missing = Object.keys(MAX_LENGTH).filter(
    field => !columns.includes(field)
  );
  if (missing.length)
    throw new Error(
      `${name} needs a header row with the columns ${Object.keys(MAX_LENGTH).join(', ')}.`
    );
  return data.map(cells =>
    Object.fromEntries(columns.map((col, i) => [col, (cells[i] || '').trim()]))
  );
}

// Merge values go into HTML, so escape the characters HTML treats as markup.
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function problemsWith(row) {
  const problems = [];
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    if (!row[field]) problems.push(`${field} is empty`);
    else if (row[field].length > max)
      problems.push(
        `${field} is ${row[field].length} characters (limit ${max})`
      );
  }
  return problems;
}

function slug(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function main() {
  const rows = readCsv(path.join(__dirname, process.argv[2] || 'data.csv'));
  const id = readStep(
    __dirname,
    'template-id.txt',
    'create-template.js'
  ).trim();
  // A change to the template (a design update) means every row renders again.
  const design = crypto
    .createHash('sha1')
    .update(readStep(__dirname, 'template.json', 'create-template.js'))
    .digest('hex');
  const videosDir = path.join(__dirname, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });

  // Results of earlier runs, keyed by design + values, so a new run can resume them.
  const resultsFile = path.join(__dirname, 'render-results.json');
  let earlier = [];
  if (fs.existsSync(resultsFile)) {
    try {
      earlier = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    } catch {
      throw new Error(
        'render-results.json is not valid JSON. Delete it to start again.'
      );
    }
  }
  const results = new Map(earlier.map(r => [r.key, r]));
  const save = () =>
    fs.writeFileSync(
      resultsFile,
      JSON.stringify([...results.values()], null, 2)
    );
  const current = [];

  // Send one render request per row, about one per second.
  for (const [index, row] of rows.entries()) {
    const name = `${String(index + 1).padStart(2, '0')}-${slug(row.PRODUCT || 'row')}`;
    const merge = Object.keys(MAX_LENGTH).map(field => ({
      find: field,
      replace: escapeHtml(row[field] || '')
    }));
    const key = crypto
      .createHash('sha1')
      .update(design)
      .update(JSON.stringify(merge))
      .digest('hex');
    const before = results.get(key);
    if (
      before?.status === 'done' &&
      before.video &&
      fs.existsSync(path.join(__dirname, before.video))
    ) {
      console.log(`  ${name}: already rendered (${before.video})`);
      continue;
    }
    if (before?.id && before.status !== 'failed') {
      console.log(`  ${name}: picking up render ${before.id}`);
      current.push(before);
      continue;
    }
    const result = {
      key,
      name,
      row,
      id: null,
      status: null,
      url: null,
      error: null,
      video: null
    };
    results.set(key, result);
    current.push(result);
    const problems = problemsWith(row);
    if (problems.length) {
      result.status = 'skipped';
      result.error = problems.join('; ');
      console.log(`  ${name}: skipped (${result.error})`);
      save();
      continue;
    }
    try {
      const { response } = await api('POST', `${EDIT_API}/templates/render`, {
        id,
        merge
      });
      if (!response?.id) throw new Error('The API returned no render id.');
      result.id = response.id;
      result.status = 'queued';
      console.log(`  ${name}: queued (${response.id})`);
    } catch (err) {
      result.status = 'not sent';
      result.error = err.message;
      console.log(`  ${name}: not sent. ${err.message}`);
    }
    save();
    await sleep(1000);
  }

  // Wait for each render, then download the video.
  const pending = current.filter(r => r.id);
  if (pending.length) console.log('Waiting for renders to finish...');
  for (const result of pending) {
    try {
      const render = await waitForRender(result.id);
      result.status = render.status;
      result.url = render.url || null;
      result.error = render.error || null;
      if (render.status === 'done' && !render.url) {
        result.status = 'unknown';
        result.error =
          'The render finished without a video URL. Run the script again to check it.';
      }
      if (result.status === 'done') {
        result.video = path.join('videos', `${result.name}.mp4`);
        await download(render.url, path.join(__dirname, result.video));
      }
    } catch (err) {
      result.status = 'unknown';
      result.video = null;
      result.error = err.message;
    }
    save();
    console.log(
      `  ${result.name}: ${result.status}${result.video ? `  saved ${result.video}` : ''}${result.error ? `  ${result.error}` : ''}`
    );
  }
  console.log(`Saved results to ${path.basename(resultsFile)}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
