import { defineConfig, devices } from "@playwright/test";

// Deliberately separate from mocked browser tests. No production host is used.
const api = "http://127.0.0.1:5143";
export default defineConfig({
  testDir: "./real",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
    cwd: "..",
    env: { VITE_API_URL: api },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
  outputDir: "./real-test-results",
});
