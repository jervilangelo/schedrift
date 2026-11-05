import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 5199;
// Each run saves into a throwaway folder, never into the user's data/ directory.
const dataDir = process.env.SCHEDRIFT_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'schedrift-e2e-'));
process.env.SCHEDRIFT_DATA_DIR = dataDir;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the installed Google Chrome; set PW_CHANNEL=chromium after `npx playwright install chromium`.
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server/index.mjs',
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { SCHEDRIFT_PORT: String(PORT), SCHEDRIFT_DATA_DIR: dataDir },
  },
});
