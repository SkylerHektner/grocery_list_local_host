import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 3999;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = path.resolve(__dirname, '..');

// Fresh, empty data dir per run (the server creates it) — never the real `data/`.
// The runner process picks the path; worker processes inherit it through the env, so tests can
// read it from process.env.GROCERY_E2E_DATA_DIR. global-teardown.ts deletes it afterwards.
export const E2E_DATA_ROOT = path.join(os.tmpdir(), 'grocery-e2e');
process.env.GROCERY_E2E_DATA_DIR ??= path.join(
  E2E_DATA_ROOT,
  `run-${Date.now()}-${process.pid}`,
);
const dataDir = path.resolve(process.env.GROCERY_E2E_DATA_DIR);
if (!dataDir.startsWith(E2E_DATA_ROOT + path.sep)) {
  throw new Error(`GROCERY_E2E_DATA_DIR must be inside ${E2E_DATA_ROOT}, got ${dataDir}`);
}

export default defineConfig({
  testDir: './tests',
  // One server with one shared DB serves every test, so run tests one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        channel: 'msedge',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // `--demo` seeds a demo catalog into the fresh DB (from T2 on).
    command: `cargo run -- --addr 127.0.0.1:${PORT} --data-dir "${dataDir}" --demo`,
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    // The first `cargo run` may compile the whole dependency tree.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
