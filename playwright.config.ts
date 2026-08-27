import { defineConfig, devices } from "@playwright/test";

const functionalViewport = process.env.CI
  ? { width: 1024, height: 768 }
  : { width: 1440, height: 900 };

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  // Software WebGL on headless Linux can make GPU-heavy integration flows
  // substantially slower without changing their deterministic assertions.
  timeout: 90_000,
  // Full parallel metadata lets CI shard this single spec across runners. Keep
  // one worker per runner because concurrent software WebGL contexts contend.
  fullyParallel: true,
  workers: 1,
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
      use: {
        // Hosted runners use software WebGL, so keep functional coverage above
        // the desktop breakpoints without rendering visual-baseline dimensions.
        viewport: functionalViewport,
      },
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
