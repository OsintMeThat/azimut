import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Canvas-heavy browser specs compete for CPU under Playwright's default of
  // one worker per core. Four keeps local runs parallel without turning normal
  // MapLibre/Konva startup into a timeout; CI stays fully deterministic.
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:18477',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 18477',
    url: 'http://127.0.0.1:18477',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox is given WebGL by hand. A CI runner has no GPU, and Firefox will
    // not fall back to a software renderer for WebGL on its own the way Chromium
    // does — so MapLibre never reached `load`, the map never said it was ready,
    // and every spec that opens one failed waiting on an element that was not
    // coming. Measured with the GL drivers taken out from under it: without this
    // pref the map specs fail, with it they pass.
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
      },
    },
  ],
});
