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
  }

  if (render.status === 'failed') {
    console.log(`  error: ${render.error}`);
  }
}
