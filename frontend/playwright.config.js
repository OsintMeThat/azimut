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
    // Firefox is given WebGL by hand. A CI runner has no GPU, and where Chromium
    // falls back to the software renderer it carries inside it, Firefox tries the
    // native driver, finds none, and stops there — `tryNativeGL()`, then
    // `FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`, read off the runner's own
    // console. So MapLibre never reached `load`, no map said it was ready, and
    // every spec that opens one failed on an element that was not coming.
    //
    // Two prefs, doing two different things: `force-enabled` gets past the
    // blocklist, and `allow-software` is what lets the fallback be tried at all.
    // Without the second the first decides nothing, which is how this failure
    // survived a pref that looked like it addressed it.
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.allow-software': true,
            'gfx.webrender.software': true,
          },
        },
      },
    },
  ],
});
