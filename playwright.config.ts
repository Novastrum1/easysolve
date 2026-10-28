import { defineConfig,devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  reporter: "list",
  ...(process.env.CI
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: false,
          timeout: 60000,
        },
      }
    : {}),
});
