import { appendFile, readFile } from 'node:fs/promises';

const FILE = new URL('./renders.jsonl', import.meta.url);

// One JSON object per line, appended. The API has no endpoint that lists
// renders, so this file is the only record of which render belongs to
// which record.
export async function recordRender(row) {
  try {
    await appendFile(FILE, JSON.stringify(row) + '\n');
  } catch (error) {
    throw new Error(`Could not write renders.jsonl: ${error.message}`);
  }
}

export async function readRenders() {
  let text;

  try {
    text = await readFile(FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Could not read renders.jsonl: ${error.message}`);
  }

  return text
    .split('\n')
    .filter(line => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(
          `renders.jsonl line ${index + 1} is not valid JSON. Fix or delete the file and submit again.`
        );
      }
    });
}
