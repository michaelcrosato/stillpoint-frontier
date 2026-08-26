import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  // Software WebGL on headless Linux can make GPU-heavy integration flows
  // substantially slower without changing their deterministic assertions.
  timeout: 90_000,
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "functional-chromium",
      grepInvert: /@(visual|fallback)/,
    },
    {
      name: "visual-chromium",
      grep: /@visual/,
    },
    {
      name: "webgl-fallback",
      grep: /@fallback/,
      use: {
        launchOptions: {
          args: ["--disable-gpu", "--disable-software-rasterizer"],
        },
      },
    },
  ],
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.002,
    },
  },
  webServer: {
    command: "npm run dev -- --port 4173",
    url: "http://127.0.0.1:4173/?test=1",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
