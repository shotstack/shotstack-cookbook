import { appendFile, readFile } from 'node:fs/promises';

const FILE = new URL('./renders.jsonl', import.meta.url);

export const db = {
  renders: {
    // One JSON object per line, appended. Nine renders submit concurrently, so
    // reading the whole file, pushing a row and writing it back would lose
    // rows: two writers read the same state and the second overwrites the
    // first. Appends don't interleave.
    async insert(row) {
      await appendFile(FILE, JSON.stringify(row) + '\n');
    },

    async all() {
      try {
        const text = await readFile(FILE, 'utf8');
        return text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line));
      } catch {
        return [];
      }
    }
  }
};
