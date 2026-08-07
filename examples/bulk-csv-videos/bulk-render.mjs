import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

const command = process.argv[2] ?? 'submit';
const validCommands = new Set(['submit', 'status', 'summary']);

if (!validCommands.has(command)) {
  console.error('Usage: node bulk-render.mjs [submit|status|summary]');
  process.exit(1);
}

const API_KEY = process.env.SHOTSTACK_API_KEY;
const ENVIRONMENT = process.env.SHOTSTACK_ENV ?? 'stage';
const TEMPLATE_ID = process.env.SHOTSTACK_TEMPLATE_ID;
const CSV_PATH = process.env.CSV_PATH ?? 'products.csv';
const MANIFEST_PATH = process.env.MANIFEST_PATH ?? 'batch-results.json';
const REQUEST_INTERVAL_MS = Number(
  process.env.SHOTSTACK_REQUEST_INTERVAL_MS ?? '1000'
);
const ROW_LIMIT = Number(process.env.SHOTSTACK_ROW_LIMIT ?? '0');
const RETRY_FAILED = process.env.SHOTSTACK_RETRY_FAILED === 'true';
const MAX_RATE_LIMIT_RETRIES = 3;
const EDIT_BASE = (
  process.env.SHOTSTACK_EDIT_BASE ??
  `https://api.shotstack.io/edit/${ENVIRONMENT}`
).replace(/\/$/, '');
const SERVE_BASE = (
  process.env.SHOTSTACK_SERVE_BASE ??
  `https://api.shotstack.io/serve/${ENVIRONMENT}`
).replace(/\/$/, '');

const fail = message => {
  console.error(message);
  process.exit(1);
};

if (!['stage', 'v1'].includes(ENVIRONMENT)) {
  fail('SHOTSTACK_ENV must be stage or v1.');
}

if (!Number.isFinite(REQUEST_INTERVAL_MS) || REQUEST_INTERVAL_MS < 0) {
  fail('SHOTSTACK_REQUEST_INTERVAL_MS must be zero or greater.');
}

if (!Number.isInteger(ROW_LIMIT) || ROW_LIMIT < 0) {
  fail('SHOTSTACK_ROW_LIMIT must be a non-negative integer.');
}

if (command !== 'summary' && !API_KEY) {
  fail('Set SHOTSTACK_API_KEY before running this command.');
}

if (command === 'submit' && !TEMPLATE_ID) {
  fail('Set SHOTSTACK_TEMPLATE_ID before submitting renders.');
}

const sleep = milliseconds =>
  milliseconds > 0
    ? new Promise(resolve => setTimeout(resolve, milliseconds))
    : Promise.resolve();

const hashRow = row =>
  createHash('sha256')
    .update(JSON.stringify(row, Object.keys(row).sort()))
    .digest('hex');

const responseMessage = body =>
  body?.response?.error ??
  body?.response?.message ??
  body?.message ??
  JSON.stringify(body);

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString();
  const temporaryPath = `${MANIFEST_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporaryPath, MANIFEST_PATH);
}

async function loadManifest({ create = false } = {}) {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

    if (manifest.environment !== ENVIRONMENT) {
      throw new Error(
        `${MANIFEST_PATH} belongs to ${manifest.environment}, not ${ENVIRONMENT}.`
      );
    }

    if (
      TEMPLATE_ID &&
      manifest.templateId &&
      manifest.templateId !== TEMPLATE_ID
    ) {
      throw new Error(`${MANIFEST_PATH} belongs to a different template.`);
    }

    return manifest;
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) {
      throw error;
    }

    return {
      version: 1,
      environment: ENVIRONMENT,
      templateId: TEMPLATE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rows: []
    };
  }
}

async function loadRows() {
  let csvText;

  try {
    csvText = await readFile(CSV_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Cannot find ${CSV_PATH}. Run node generate-data.mjs first, or set CSV_PATH.`
      );
    }
    throw error;
  }

  const rows = parse(csvText, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  const requiredColumns = [
    'row_id',
    'product_name',
    'headline',
    'price',
    'image_url',
    'brand_color'
  ];
  const seenIds = new Set();
  const errors = [];

  rows.forEach((row, index) => {
    const line = index + 2;

    for (const column of requiredColumns) {
      if (!row[column]) {
        errors.push(`Line ${line}: ${column} is required.`);
      }
    }

    if (!/^[A-Za-z0-9_-]+$/.test(row.row_id ?? '')) {
      errors.push(
        `Line ${line}: row_id may contain only letters, numbers, _ and -.`
      );
    }

    if (seenIds.has(row.row_id)) {
      errors.push(`Line ${line}: duplicate row_id ${row.row_id}.`);
    }
    seenIds.add(row.row_id);

    if ((row.product_name ?? '').length > 40) {
      errors.push(`Line ${line}: product_name must be 40 characters or fewer.`);
    }

    if ((row.headline ?? '').length > 55) {
      errors.push(`Line ${line}: headline must be 55 characters or fewer.`);
    }

    if ((row.price ?? '').length > 20) {
      errors.push(`Line ${line}: price must be 20 characters or fewer.`);
    }

    try {
      const imageUrl = new URL(row.image_url);
      if (imageUrl.protocol !== 'https:') {
        throw new Error('not HTTPS');
      }
    } catch {
      errors.push(`Line ${line}: image_url must be a valid HTTPS URL.`);
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(row.brand_color ?? '')) {
      errors.push(`Line ${line}: brand_color must be a six-digit hex color.`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`CSV validation failed:\n${errors.join('\n')}`);
  }

  return ROW_LIMIT > 0 ? rows.slice(0, ROW_LIMIT) : rows;
}

function mergeFields(row) {
  const fields = [
    { find: 'PRODUCT_NAME', replace: row.product_name },
    { find: 'HEADLINE', replace: row.headline },
    { find: 'PRICE', replace: row.price },
    { find: 'IMAGE_URL', replace: row.image_url },
    { find: 'BRAND_COLOR', replace: row.brand_color }
  ];

  // The AI data step adds an image_prompt column for templates that use a
  // text-to-image asset with an {{IMAGE_PROMPT}} placeholder. Templates
  // without the placeholder ignore the extra merge field.
  if (row.image_prompt) {
    fields.push({ find: 'IMAGE_PROMPT', replace: row.image_prompt });
  }

  return fields;
}

function retryDelay(response, retryNumber) {
  const retryAfter = response.headers.get('retry-after');

  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Number(retryAfter) * 1000;
  }

  if (retryAfter) {
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) {
      return dateDelay;
    }
  }

  return 60_000 * 2 ** retryNumber;
}

async function submitTemplate(row) {
  const payload = {
    id: TEMPLATE_ID,
    merge: mergeFields(row)
  };

  for (let retry = 0; retry <= MAX_RATE_LIMIT_RETRIES; retry += 1) {
    let response;

    try {
      response = await fetch(`${EDIT_BASE}/templates/render`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': API_KEY
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (error) {
      return {
        kind: 'unknown',
        error: `No definitive API response: ${error.message}`
      };
    }

    const body = await parseResponse(response);

    if (response.status === 429) {
      if (retry === MAX_RATE_LIMIT_RETRIES) {
        return {
          kind: 'rejected',
          statusCode: 429,
          error: responseMessage(body)
        };
      }

      const delay = retryDelay(response, retry);
      console.warn(`Rate limited. Waiting ${Math.ceil(delay / 1000)} seconds.`);
      await sleep(delay);
      continue;
    }

    if (response.status === 201 && body?.response?.id) {
      return { kind: 'accepted', renderId: body.response.id };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        kind: 'rejected',
        statusCode: response.status,
        error: responseMessage(body)
      };
    }

    return {
      kind: 'unknown',
      statusCode: response.status,
      error: `Unexpected response: ${responseMessage(body)}`
    };
  }
}

async function submitRows() {
  const rows = await loadRows();
  const manifest = await loadManifest({ create: true });
  let failures = 0;

  console.log(`Validated ${rows.length} rows from ${CSV_PATH}.`);

  for (const [index, row] of rows.entries()) {
    let entry = manifest.rows.find(item => item.rowId === row.row_id);

    if (entry?.status === 'submitting') {
      entry.status = 'unknown';
      entry.error =
        'The previous process stopped during submission. Check the dashboard before retrying.';
      await saveManifest(manifest);
    }

    if (entry?.status === 'unknown') {
      console.warn(`[${row.row_id}] skipped: previous outcome is unknown.`);
      continue;
    }

    const canRetry =
      RETRY_FAILED &&
      (entry?.status === 'failed' || entry?.status === 'submission_failed');
    const currentHash = hashRow(row);

    if (entry?.inputHash && entry.inputHash !== currentHash && !canRetry) {
      throw new Error(
        `Row ${row.row_id} changed after its first submission. ` +
          'Use a new row_id, or retry it only after confirming the previous request failed.'
      );
    }

    if (entry?.renderId && !canRetry) {
      console.log(`[${row.row_id}] skipped: already has a render ID.`);
      continue;
    }

    if (entry?.status === 'submission_failed' && !canRetry) {
      console.log(`[${row.row_id}] skipped: set SHOTSTACK_RETRY_FAILED=true.`);
      continue;
    }

    if (!entry) {
      entry = { rowId: row.row_id, attempts: 0 };
      manifest.rows.push(entry);
    }

    if (canRetry) {
      if (entry.renderId) {
        entry.previousRenderIds = [
          ...(entry.previousRenderIds ?? []),
          entry.renderId
        ];
      }
      delete entry.renderId;
      delete entry.temporaryUrl;
      delete entry.hostedUrl;
      delete entry.hostingStatus;
      delete entry.statusUpdatedAt;
      delete entry.completedAt;
      delete entry.submittedAt;
      delete entry.statusCode;
    }

    entry.inputHash = currentHash;
    entry.status = 'submitting';
    entry.error = null;
    entry.attempts += 1;
    entry.lastAttemptAt = new Date().toISOString();
    await saveManifest(manifest);

    const result = await submitTemplate(row);

    if (result.kind === 'accepted') {
      entry.renderId = result.renderId;
      entry.status = 'queued';
      entry.submittedAt = new Date().toISOString();
      console.log(
        `[${index + 1}/${rows.length}] ${row.row_id} -> ${result.renderId}`
      );
    } else if (result.kind === 'rejected') {
      entry.status = 'submission_failed';
      entry.statusCode = result.statusCode;
      entry.error = result.error;
      failures += 1;
      console.error(`[${row.row_id}] rejected: ${result.error}`);
    } else {
      entry.status = 'unknown';
      entry.statusCode = result.statusCode;
      entry.error = result.error;
      failures += 1;
      console.error(`[${row.row_id}] unknown outcome: ${result.error}`);
    }

    await saveManifest(manifest);

    if (result.kind === 'rejected' && [401, 403].includes(result.statusCode)) {
      console.error(
        'The API key was rejected. Check SHOTSTACK_API_KEY and SHOTSTACK_ENV, then run submit again.'
      );
      break;
    }

    await sleep(REQUEST_INTERVAL_MS);
  }

  printSummary(manifest);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': API_KEY
    },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await parseResponse(response);
  return { response, body };
}

async function updateStatuses() {
  const manifest = await loadManifest();

  for (const entry of manifest.rows) {
    if (
      !entry.renderId ||
      entry.status === 'failed' ||
      (entry.status === 'done' && entry.hostedUrl)
    ) {
      continue;
    }

    if (entry.status !== 'done') {
      try {
        const { response, body } = await getJson(
          `${EDIT_BASE}/render/${entry.renderId}?data=false`
        );

        if (response.ok && body?.response?.status) {
          entry.status = body.response.status;
          entry.error = body.response.error || null;
          entry.temporaryUrl = body.response.url || null;
          entry.statusUpdatedAt = body.response.updated || null;

          if (entry.status === 'done' || entry.status === 'failed') {
            entry.completedAt = body.response.updated || null;
          }
        } else {
          console.warn(
            `[${entry.rowId}] status lookup failed: ${response.status} ${responseMessage(body)}`
          );
        }
      } catch (error) {
        console.warn(`[${entry.rowId}] status lookup failed: ${error.message}`);
      }
    }

    if (entry.status === 'done' && !entry.hostedUrl) {
      try {
        const { response, body } = await getJson(
          `${SERVE_BASE}/assets/render/${entry.renderId}`
        );

        if (response.ok && Array.isArray(body.data)) {
          const video = body.data.find(
            asset =>
              asset?.attributes?.status === 'ready' &&
              asset?.attributes?.filename?.endsWith('.mp4')
          );
          const firstAsset = body.data[0]?.attributes;

          entry.hostingStatus = video
            ? 'ready'
            : (firstAsset?.status ?? 'pending');
          entry.hostedUrl = video?.attributes?.url ?? null;
        } else {
          entry.hostingStatus = 'pending';
        }
      } catch {
        entry.hostingStatus = 'pending';
      }
    }

    await saveManifest(manifest);
    await sleep(REQUEST_INTERVAL_MS);
  }

  printSummary(manifest);
}

function printSummary(manifest) {
  const counts = {};

  for (const entry of manifest.rows) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  console.table(
    Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => ({ status, count }))
  );
  console.log(
    `Hosted videos ready: ${manifest.rows.filter(row => row.hostedUrl).length}/${manifest.rows.length}`
  );
}

try {
  if (command === 'submit') {
    await submitRows();
  } else if (command === 'status') {
    await updateStatuses();
  } else {
    printSummary(await loadManifest());
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error(
      `Cannot find ${MANIFEST_PATH}. Run node bulk-render.mjs submit first.`
    );
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
