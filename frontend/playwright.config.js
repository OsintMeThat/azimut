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
    // Plain, after four attempts at giving this browser WebGL on a CI runner:
    // the blocklist turned off, the software fallback allowed, and both halves
    // of mesa installed each left the console saying the same thing —
    // `tryNativeGL()`, then `EXHAUSTED_DRIVERS`. Chromium carries its own
    // software renderer and needs none of that; a patched headless Firefox has
    // nowhere to fall back to. The map specs skip themselves there and say so
    // (`awaitMapReady` in `app.fixture.js`); every other spec runs, and locally
    // Firefox draws the map like anything else.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
