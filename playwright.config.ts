import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the repo's own committed E2E suite (tests/*.spec.ts), authored via the
 * qa-planner / qa-generator / qa-healer agents in .claude/agents/ — see docs/e2e-agents.md.
 *
 * NOT related to src/services/automation/ (the in-app "Playwright Automation Agent"
 * feature, which generates and runs scripts on behalf of end users at request time —
 * see browser-runner.ts). This config is only for tests that live under tests/ and are
 * run with `npx playwright test`.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],

  // Uncomment to have Playwright boot the Next.js dev server itself before running:
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
