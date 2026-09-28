import { readFile } from 'node:fs/promises';
import { fail, requireConfig, submitRender } from './api.mjs';
import { buildEdit } from './edit.mjs';
import { recordRender } from './renders.mjs';

requireConfig();

let match;

try {
  match = JSON.parse(
    await readFile(new URL('./match.json', import.meta.url), 'utf8')
  );
} catch (error) {
  fail(`Could not read match.json: ${error.message}`);
}

const problems = [];

for (const field of ['matchId', 'source']) {
  if (!match[field]) {
    problems.push(`match.json: ${field} is required.`);
  }
}

if (match.source && !/^https:\/\//.test(match.source)) {
  problems.push('match.json: source must be an HTTPS URL.');
}

if (!Array.isArray(match.goals) || match.goals.length === 0) {
  problems.push('match.json: goals must contain at least one goal.');
} else {
  match.goals.forEach((goal, index) => {
    if (!Number.isFinite(goal.at) || goal.at < 0) {
      problems.push(`goal ${index + 1}: at must be a number of seconds.`);
    }
  });
}

if (problems.length > 0) {
  fail(problems.join('\n'));
}

try {
  const renderId = await submitRender(buildEdit(match), match.matchId);

  await recordRender({
    renderId,
    matchId: match.matchId,
    submittedAt: new Date().toISOString()
  });

  console.log(`${match.matchId} → ${renderId}`);
} catch (error) {
  fail(error.message);
}
