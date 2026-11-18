import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * Playwright runs the end-to-end tests in this folder against the dev build of Rapid, in a real browser.
 * See `README.md` in this folder.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.test.js',
  outputDir: './results',       // traces, screenshots and error context of failed tests
  globalSetup: './recording.js',  // when recording, merges what each test recorded (see `README.md`)
  timeout: 60_000,              // per test: Rapid loads several MB of assets from the CDN at startup

  forbidOnly: CI,               // a `test.only` left in by accident fails in CI
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,

  reporter: [
    [CI ? 'github' : 'list'],
    ['html', { open: 'never', outputFolder: './report' }]
  ],

  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // WebGL without a GPU (CI machines have none), so Pixi and MapLibre can draw
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],

  // Build and serve Rapid, unless a server is already running (locally only, in CI always start fresh).
  // A server you started yourself serves whatever you built last.
  webServer: {
    command: 'bun run start',
    cwd: '../..',
    url: 'http://127.0.0.1:8080/dist/index-dev.html',
    reuseExistingServer: !CI,
    timeout: 300_000
  }
});
