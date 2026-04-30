/**
 * Playwright Configuration
 *
 * E2E test configuration for the OPS Web application.
 * Runs against a local dev server on port 3000.
 */

import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = process.env.E2E_PORT ?? "3000";
const E2E_BASE_URL =
  process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

export default defineConfig({
  // Test directory
  testDir: "./tests/e2e",

  // Test file pattern
  testMatch: "**/*.spec.ts",

  // Maximum time a test can run
  timeout: 30000,

  // Maximum time expect() can wait
  expect: {
    timeout: 10000,
  },

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ["html", { open: "never" }],
    ["list"],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for navigation (override with E2E_BASE_URL or E2E_PORT)
    baseURL: E2E_BASE_URL,

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on first retry
    video: "on-first-retry",

    // Default action timeout
    actionTimeout: 10000,

    // Default navigation timeout
    navigationTimeout: 15000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
  },

  // Output directory for test artifacts
  outputDir: "test-results",
});
