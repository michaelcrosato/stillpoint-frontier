import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function openDeterministicWorld(page: Page) {
  await page.goto("/?test=1", { waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({ animations: "disabled" });
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
  expect(screenshot.byteLength).toBeGreaterThan(35_000);
  return screenshot;
}

async function canvasVisualStats(page: Page) {
  return page.getByTestId("game-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false, range: 0, visibleSamples: 0 };
    const width = Math.min(64, canvas.width);
    const height = Math.min(64, canvas.height);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(
      Math.max(0, Math.floor(canvas.width / 2 - width / 2)),
      Math.max(0, Math.floor(canvas.height / 2 - height / 2)),
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let minimum = 255;
    let maximum = 0;
    let visibleSamples = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = Math.round(
        pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722,
      );
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
      if (pixels[index + 3] > 0) visibleSamples += 1;
    }
    return { webgl2: true, range: maximum - minimum, visibleSamples };
  });
}

test("boots WebGL2 without a blank frame", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await openDeterministicWorld(page);
  const state = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(state?.loadedChunks).toBe(25);
  expect(state?.triangles).toBeGreaterThan(1_000);
  const pixels = await canvasVisualStats(page);
  expect(pixels.webgl2).toBe(true);
  expect(pixels.visibleSamples).toBeGreaterThan(3_000);
  expect(pixels.range).toBeGreaterThan(12);
  expect(consoleErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "entry-screen");
});

test("starts the survey, streams distant chunks, and opens the map", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  await expect(page.getByTestId("game-hud")).toBeVisible();

  await page.evaluate(() => window.__STILLPOINT_TEST__?.teleport(1240, -910));
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().chunk))
    .toEqual({ x: 13, z: -9 });
  const streamedState = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(streamedState?.loadedChunks).toBe(25);

  await page.getByRole("button", { name: /map/i }).click();
  await expect(page.getByTestId("map-panel")).toBeVisible();
  await attachScreenshot(page, testInfo, "distant-world-map");
});

test("recovers records and updates persistent survey UI", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();

  await page.evaluate(() => {
    window.__STILLPOINT_TEST__?.teleport(38, -47);
    window.__STILLPOINT_TEST__?.faceBeacon("amber-relay");
  });
  await expect(page.getByTestId("interaction-prompt")).toBeVisible();
  await page.keyboard.press("KeyE");
  await expect(page.getByTestId("discovery-card")).toContainText("Amber Relay");

  const state = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(state?.scanned).toEqual(["amber-relay"]);
  await expect(page.getByTestId("mission-card")).toContainText("RECOVERED");
  await attachScreenshot(page, testInfo, "record-recovered");
});

test("restores a saved survey after reload", async ({ page }) => {
  await page.goto("/?test=1&storage=1", { waitUntil: "load" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
  await page.getByTestId("enter-frontier").click();
  await page.evaluate(() => window.__STILLPOINT_TEST__?.discover("amber-relay"));
  await expect(page.getByTestId("mission-card")).toContainText("RECOVERED");

  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.getByTestId("enter-frontier").click();
  await expect(page.getByTestId("mission-card")).toContainText("RECOVERED");
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().scanned)).toEqual([
    "amber-relay",
  ]);
});

test("keeps GPU resource counts bounded through repeated chunk churn", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const baseline = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());

  for (const [x, z] of [
    [2_000, 2_000],
    [-3_000, 1_500],
    [4_500, -4_500],
    [0, 8],
  ] as const) {
    await page.evaluate(([nextX, nextZ]) => {
      window.__STILLPOINT_TEST__?.teleport(nextX, nextZ);
    }, [x, z] as const);
    await page.waitForTimeout(80);
  }

  const settled = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(settled?.loadedChunks).toBe(25);
  expect(settled?.geometries).toBeLessThanOrEqual((baseline?.geometries ?? 0) + 3);
  expect(settled?.textures).toBeLessThanOrEqual(baseline?.textures ?? 0);
});

test("surfaces graphics context loss and preserves the simulation", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  await page.evaluate(() => window.__STILLPOINT_TEST__?.loseContext());
  await expect(page.getByText("GRAPHICS CONTEXT LOST")).toBeVisible();
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().contextStatus)).toBe("lost");
  await page.evaluate(() => window.__STILLPOINT_TEST__?.restoreContext());
  await expect(page.getByText("GRAPHICS CONTEXT LOST")).toBeHidden();
});

test("entry and fixed world views are visually reviewable @visual", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  if (process.env.VISUAL_BASELINES === "1") {
    await expect(page).toHaveScreenshot("entry-screen.png");
  } else {
    await attachScreenshot(page, testInfo, "visual-entry-candidate");
  }

  await page.getByTestId("enter-frontier").click();
  await page.waitForTimeout(100);
  if (process.env.VISUAL_BASELINES === "1") {
    await expect(page).toHaveScreenshot("frontier-world.png");
  } else {
    await attachScreenshot(page, testInfo, "visual-world-candidate");
  }
});

test("explains unavailable graphics acceleration @fallback", async ({ page }, testInfo) => {
  await page.goto("/?test=1", { waitUntil: "load" });
  await expect(page.getByTestId("engine-error")).toBeVisible();
  await expect(page.getByTestId("engine-error")).toContainText("WebGL2-capable browser");
  await attachScreenshot(page, testInfo, "webgl-fallback");
});
