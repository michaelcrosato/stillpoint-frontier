import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { getSettlement } from "../../lib/game/world/macroWorld";

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

test("streams proportional ambient citizens without making them interaction targets", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const mega = getSettlement("vesper-crown");
  const village = getSettlement("dustmere");
  expect(mega).not.toBeNull();
  expect(village).not.toBeNull();
  if (!mega || !village) return;

  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);
  const megacityCrowd = await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens());
  const targets = await page.evaluate(() => window.__STILLPOINT_TEST__?.targets() ?? []);
  expect(megacityCrowd?.visible).toBeGreaterThan(3_000);
  expect(megacityCrowd?.density).toBe("SURGE");
  expect(targets.some((target) => target.id.startsWith("citizen:"))).toBe(false);
  await expect(page.getByTestId("crowd-readout")).toContainText("NON-INTERACTIVE");

  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [village.x, village.z]);
  const villageCrowd = await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens());
  expect(villageCrowd?.visible).toBeGreaterThan(0);
  expect(villageCrowd?.visible).toBeLessThan((megacityCrowd?.visible ?? 0) / 20);

  await page.evaluate(() => window.__STILLPOINT_TEST__?.teleport(44_000, -44_000));
  expect((await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens().visible)) ?? -1).toBe(0);

  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);
  const returnedCrowd = await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens());
  expect(returnedCrowd?.ids).toEqual(megacityCrowd?.ids);
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

test("supports sprint, crouch, and a complete jump arc", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();

  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().sprinting))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().stamina ?? 1))
    .toBeLessThan(0.99);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");

  await page.keyboard.down("KeyC");
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().crouching))
    .toBe(true);
  await page.keyboard.up("KeyC");

  await page.keyboard.press("Space");
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().grounded))
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().grounded), {
      timeout: 2_000,
    })
    .toBe(true);
});

test("collects and harvests deterministic resources without duplicate loot", async ({ page }, testInfo) => {
  await page.goto("/?test=1&storage=1", { waitUntil: "load" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
  await page.getByTestId("enter-frontier").click();

  const targets = await page.evaluate(() => window.__STILLPOINT_TEST__?.targets() ?? []);
  const pickup = targets.find((target) => target.kind === "pickup");
  const rock = targets.find((target) => target.id.includes("resource:rock:v1:0:0"));
  expect(pickup).toBeTruthy();
  expect(rock).toBeTruthy();
  if (!pickup || !rock) return;

  await page.evaluate((id) => window.__STILLPOINT_TEST__?.interactTarget(id), pickup.id);
  const afterPickup = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(Object.values(afterPickup?.inventory ?? {}).reduce((sum, value) => sum + value, 0)).toBe(1);

  for (let hit = 0; hit < 3; hit += 1) {
    await page.evaluate((id) => window.__STILLPOINT_TEST__?.interactTarget(id), rock.id);
  }
  const afterRock = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(afterRock?.inventory.stone).toBe(3);
  await page.evaluate((id) => window.__STILLPOINT_TEST__?.interactTarget(id), rock.id);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().inventory.stone)).toBe(3);
  await expect(page.getByTestId("gather-card")).toContainText("+3 STONE");
  await attachScreenshot(page, testInfo, "resource-harvested");

  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
  const restored = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(restored?.inventory.stone).toBe(3);
  expect((await page.evaluate(() => window.__STILLPOINT_TEST__?.targets() ?? [])).some(
    (target) => target.id === rock.id,
  )).toBe(false);
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

test("megacity crowd density is visually reviewable @visual", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const mega = getSettlement("vesper-crown");
  expect(mega).not.toBeNull();
  if (!mega) return;
  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);
  await expect(page.getByTestId("crowd-readout")).toContainText("SURGE");
  await page.waitForTimeout(150);
  await attachScreenshot(page, testInfo, "megacity-crowd-candidate");
});

test("HUD and territory-map fixtures are visually reviewable without a GPU @visual", async ({ page }, testInfo) => {
  await page.goto("/?visual=hud", { waitUntil: "load" });
  await expect(page.getByTestId("movement-readout")).toContainText("READY");
  await expect(page.getByTestId("inventory-belt")).toContainText("WOOD");
  await attachScreenshot(page, testInfo, "hud-layout-fixture");

  await page.goto("/?visual=map", { waitUntil: "load" });
  await expect(page.getByTestId("map-panel")).toContainText("9,216 KM²");
  await expect(page.getByTestId("map-panel")).toContainText("24");
  await attachScreenshot(page, testInfo, "territory-map-fixture");
});

test("explains unavailable graphics acceleration @fallback", async ({ page }, testInfo) => {
  await page.goto("/?test=1", { waitUntil: "load" });
  await expect(page.getByTestId("engine-error")).toBeVisible();
  await expect(page.getByTestId("engine-error")).toContainText("WebGL2-capable browser");
  await attachScreenshot(page, testInfo, "webgl-fallback");
});
