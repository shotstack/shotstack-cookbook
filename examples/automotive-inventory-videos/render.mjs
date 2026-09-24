import { readFile } from 'node:fs/promises';
import { fail, requireConfig, submitRender } from './api.mjs';
import { buildEdit } from './edit.mjs';
import { recordRender } from './renders.mjs';

const REQUIRED_FIELDS = [
  'stockId',
  'year',
  'make',
  'model',
  'trim',
  'price',
  'odometer',
  'transmission',
  'fuel',
  'dealer'
];

requireConfig();

let vehicles;

try {
  vehicles = JSON.parse(
    await readFile(new URL('./vehicles.json', import.meta.url), 'utf8')
  );
} catch (error) {
  fail(`Could not read vehicles.json: ${error.message}`);
}

if (!Array.isArray(vehicles) || vehicles.length === 0) {
  fail('vehicles.json must contain an array with at least one vehicle.');
}

const problems = [];

vehicles.forEach((vehicle, index) => {
  const label = vehicle.stockId ?? `vehicle ${index + 1}`;

  for (const field of REQUIRED_FIELDS) {
    if (vehicle[field] === undefined || vehicle[field] === '') {
      problems.push(`${label}: ${field} is required.`);
    }
  }

  if (!Array.isArray(vehicle.photos) || vehicle.photos.length === 0) {
    problems.push(`${label}: photos must contain at least one HTTPS URL.`);
    return;
  }

  for (const photo of vehicle.photos) {
    if (!/^https:\/\//.test(photo)) {
      problems.push(`${label}: photo ${photo} must be an HTTPS URL.`);
    }
  }
});

if (problems.length > 0) {
  fail(problems.join('\n'));
}

let submitted = 0;

for (const vehicle of vehicles) {
  try {
    const edit = buildEdit(vehicle);
    const renderId = await submitRender(edit, vehicle.stockId);

    await recordRender({
      renderId,
      stockId: vehicle.stockId,
      submittedAt: new Date().toISOString()
    });

    console.log(`${vehicle.stockId} → ${renderId}`);
    submitted += 1;
  } catch (error) {
    if (error.fatal) {
      fail(error.message);
    }

    console.error(error.message);
    process.exitCode = 1;
  }
}

console.log(`${submitted}/${vehicles.length} submitted`);
