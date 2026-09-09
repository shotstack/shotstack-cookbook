import { appendFile, readFile } from 'node:fs/promises';

const FILE = new URL('./renders.jsonl', import.meta.url);

export const db = {
  renders: {
    // One JSON object per line, appended. Nine renders submit concurrently, so
    // reading the whole file, pushing a row and writing it back would lose
    // rows: two writers read the same state and the second overwrites the
    // first. Appends don't interleave.
    async insert(row) {
      try {
        await appendFile(FILE, JSON.stringify(row) + '\n');
      } catch (err) {
        throw new Error(`Could not write renders.jsonl: ${err.message}`);
      }
    },

    async all() {
      let text;
      try {
        text = await readFile(FILE, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return []; // no batch submitted yet
        throw new Error(`Could not read renders.jsonl: ${err.message}`);
      }

      // A line that is not JSON means the file was edited or a write was cut
      // short. Say so, rather than report an empty batch.
      return text
        .split('\n')
        .filter(line => line.trim())
        .map((line, i) => {
          try {
            return JSON.parse(line);
          } catch {
            throw new Error(
              `renders.jsonl line ${i + 1} is not valid JSON. Fix or delete the file and submit the batch again.`
            );
          }
        });
    }
  }
};
