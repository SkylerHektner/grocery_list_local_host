import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Removes this run's temp data dir. Only ever deletes inside <tmp>/grocery-e2e.
export default async function globalTeardown() {
  const root = path.join(os.tmpdir(), 'grocery-e2e');
  const dir = process.env.GROCERY_E2E_DATA_DIR;
  if (!dir || !path.resolve(dir).startsWith(root + path.sep)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`could not remove e2e data dir ${dir}: ${err}`);
  }
}
