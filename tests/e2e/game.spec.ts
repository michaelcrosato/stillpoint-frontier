import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  CAMERA_DRAW_DISTANCE,
  CITIZEN_RESIDENT_CHUNKS,
  WORLD_RESIDENT_CHUNKS,
} from "../../lib/game/config";
import { getSettlement } from "../../lib/game/world/macroWorld";
import { SPAWN_BUILDING } from "../../lib/game/world/spawnBuilding";
import { TWO_STORY_BUILDING } from "../../lib/game/world/twoStoryBuilding";

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
  expect(state?.loadedChunks).toBe(WORLD_RESIDENT_CHUNKS);
  expect(state?.drawDistanceMeters).toBe(CAMERA_DRAW_DISTANCE);
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
  expect(streamedState?.loadedChunks).toBe(WORLD_RESIDENT_CHUNKS);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens().chunks))
    .toBe(CITIZEN_RESIDENT_CHUNKS);

  await page.getByRole("button", { name: /map/i }).click();
  await expect(page.getByTestId("map-panel")).toBeVisible();
  await attachScreenshot(page, testInfo, "distant-world-map");
});

test("toggles the spawn door and exposes a traversable second floor", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  expect(SPAWN_BUILDING.floorCount).toBe(1);
  expect(SPAWN_BUILDING.hasBasement).toBe(false);
  expect(SPAWN_BUILDING.roofAccess).toBe(false);
  const wallCount = await page.evaluate(
    (prefix) => window.__STILLPOINT_TEST__?.colliders().filter(
      (collider) => collider.id.startsWith(prefix),
    ).length,
    `spawn-building:${SPAWN_BUILDING.id}:wall:`,
  );
  expect(wallCount).toBe(5);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.doors().length)).toBe(2);

  const closedDoorwayProbe = await page.evaluate(
    ({ x, z, depth }) => window.__STILLPOINT_TEST__?.probeCollision(
      { x, z: z + depth * 0.5 + 2 },
      { x, z },
    ),
    SPAWN_BUILDING,
  );
  expect(closedDoorwayProbe?.position.z ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
    SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
  );

  await page.evaluate(
    (doorId) => window.__STILLPOINT_TEST__?.interactTarget(doorId),
    SPAWN_BUILDING.doorId,
  );
  expect(await page.evaluate(
    (doorId) => window.__STILLPOINT_TEST__?.doors().find((door) => door.id === doorId)?.open,
    SPAWN_BUILDING.doorId,
  )).toBe(true);
  const openDoorwayProbe = await page.evaluate(
    ({ x, z, depth }) => window.__STILLPOINT_TEST__?.probeCollision(
      { x, z: z + depth * 0.5 + 2 },
      { x, z },
    ),
    SPAWN_BUILDING,
  );
  expect(openDoorwayProbe?.position.x).toBeCloseTo(SPAWN_BUILDING.x, 3);
  expect(openDoorwayProbe?.position.z).toBeCloseTo(SPAWN_BUILDING.z, 3);

  await page.evaluate(
    (doorId) => window.__STILLPOINT_TEST__?.interactTarget(doorId),
    SPAWN_BUILDING.doorId,
  );
  expect(await page.evaluate(
    (doorId) => window.__STILLPOINT_TEST__?.doors().find((door) => door.id === doorId)?.open,
    SPAWN_BUILDING.doorId,
  )).toBe(false);
  const reclosedDoorwayProbe = await page.evaluate(
    ({ x, z, depth }) => window.__STILLPOINT_TEST__?.probeCollision(
      { x, z: z + depth * 0.5 + 2 },
      { x, z },
    ),
    SPAWN_BUILDING,
  );
  expect(reclosedDoorwayProbe?.position.z ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(
    SPAWN_BUILDING.z + SPAWN_BUILDING.depth * 0.5,
  );

  const wallProbe = await page.evaluate(
    ({ x, z, width }) => window.__STILLPOINT_TEST__?.probeCollision(
      { x, z },
      { x: x + width, z },
    ),
    SPAWN_BUILDING,
  );
  expect(wallProbe?.clear).toBe(true);
  expect(wallProbe?.position.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
    SPAWN_BUILDING.x + SPAWN_BUILDING.width * 0.5,
  );

  const groundFloor = await page.evaluate(
    ({ x, z }) => window.__STILLPOINT_TEST__?.groundHeight(x, z),
    TWO_STORY_BUILDING,
  );
  const upperFloor = await page.evaluate(
    ({ x, z, upperFloorY }) =>
      window.__STILLPOINT_TEST__?.groundHeight(x, z, upperFloorY),
    TWO_STORY_BUILDING,
  );
  expect(groundFloor).toBeCloseTo(TWO_STORY_BUILDING.floorY, 4);
  expect(upperFloor).toBeCloseTo(TWO_STORY_BUILDING.upperFloorY, 4);
});

test("sets, replaces, guides, and clears a map waypoint", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  await page.getByRole("button", { name: /map/i }).click();
  const plot = page.getByTestId("map-plot");
  const bounds = await plot.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.click(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.25);
  await expect(page.getByTestId("map-waypoint")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation?.target.position.x))
    .toBeCloseTo(24_000, -1);
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation?.target.position.z))
    .toBeCloseTo(-24_000, -1);

  await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.75);
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation?.target.position.x))
    .toBeCloseTo(-24_000, -1);
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation?.target.position.z))
    .toBeCloseTo(24_000, -1);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.navigationTargets().filter(
    (target) => target.id === "player:map",
  ).length)).toBe(1);

  await attachScreenshot(page, testInfo, "map-waypoint-set");
  await page.getByRole("button", { name: /close/i }).click();
  await expect(page.getByTestId("waypoint-guide")).toContainText(/map waypoint/i);
  await expect(page.getByTestId("waypoint-compass-marker")).toBeVisible();

  await page.evaluate(() => window.__STILLPOINT_TEST__?.setHeading(359));
  await expect(page.getByTestId("compass")).toContainText("359°");
  await page.evaluate(() => window.__STILLPOINT_TEST__?.setHeading(1));
  await expect(page.getByTestId("compass")).toContainText("001°");
  await expect(page.getByTestId("compass-tape")).toContainText("N");

  await page.getByRole("button", { name: /map/i }).click();
  await page.getByTestId("clear-waypoint").click();
  await expect(page.getByTestId("map-waypoint")).toBeHidden();
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation)).toBeNull();
});

test("fast travels from the map with all playtest destinations unlocked", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  await page.getByRole("button", { name: /map/i }).click();
  const mega = getSettlement("vesper-crown");
  expect(mega).not.toBeNull();
  if (!mega) return;

  await page.getByTestId("fast-travel-list-settlement:vesper-crown").click();
  await expect(page.getByTestId("map-panel")).toBeVisible();
  await expect(page.getByText(/arrival ready \/ vesper crown/i)).toBeVisible();
  const state = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(state?.lastFastTravel).toMatchObject({
    id: "settlement:vesper-crown",
    name: "Vesper Crown",
  });
  expect(Math.hypot(
    (state?.position.x ?? 0) - mega.x,
    (state?.position.z ?? 0) - mega.z,
  )).toBeLessThan(150);
  expect(state?.loadedChunks).toBe(WORLD_RESIDENT_CHUNKS);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens().chunks))
    .toBe(CITIZEN_RESIDENT_CHUNKS);
});

test("exposes a deterministic day-night clock and weather readout", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(0));
  await expect(page.getByTestId("environment-readout")).toContainText("NIGHT");
  await expect(page.getByTestId("world-clock")).toContainText("00:00");
  await expect(page.getByTestId("world-clock")).toContainText("NIGHT");
  await expect(page.getByTestId("world-clock-state")).toContainText("TEST HOLD");
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().environment.phase))
    .toBe("night");

  await page.evaluate(() => window.__STILLPOINT_TEST__?.advanceWorldMinutes(65));
  await expect(page.getByTestId("world-clock")).toContainText("01:05");

  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(12 * 60));
  await expect(page.getByTestId("environment-readout")).toContainText("12:00");
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().environment.phase))
    .toBe("day");
  const environment = await page.evaluate(
    () => window.__STILLPOINT_TEST__?.snapshot().environment,
  );
  expect(environment?.weatherLabel.length).toBeGreaterThan(3);
  expect(environment?.visibilityMeters).toBeGreaterThan(100);
});

test("lights cities and sharply reduces ambient population at 03:00", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const mega = getSettlement("vesper-crown");
  expect(mega).not.toBeNull();
  if (!mega) return;
  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);

  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(12 * 60));
  const noonCrowd = await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens());
  const dayLights = await page.evaluate(() => window.__STILLPOINT_TEST__?.nightLighting());
  expect(dayLights?.windows).toBeGreaterThan(100);
  expect(dayLights?.visibleWindowMeshes).toBe(0);
  expect(dayLights?.activeAreaLights).toBe(0);

  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(3 * 60));
  const nightCrowd = await page.evaluate(() => window.__STILLPOINT_TEST__?.citizens());
  const nightLights = await page.evaluate(() => window.__STILLPOINT_TEST__?.nightLighting());
  expect(nightCrowd?.visible ?? 0).toBeLessThan((noonCrowd?.visible ?? 0) / 4);
  expect(nightCrowd?.visible ?? 0).toBeGreaterThan(0);
  expect(nightLights?.strength).toBeGreaterThan(0.95);
  expect(nightLights?.visibleWindowMeshes).toBeGreaterThan(0);
  expect(nightLights?.activeAreaLights).toBeGreaterThan(0);
  await expect(page.getByTestId("crowd-readout")).toContainText("TIME DEMAND");
  await expect(page.getByTestId("world-clock")).toContainText("03:00");
});

test("keeps developer time and weather overrides out of the normal save", async ({ page }) => {
  await page.goto("/?test=1&storage=1", { waitUntil: "load" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
  await page.getByTestId("enter-frontier").click();
  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(12 * 60));

  await page.getByTestId("developer-launcher").click();
  await expect(page.getByTestId("developer-panel")).toBeVisible();
  await page.getByTestId("developer-mode-toggle").click();
  await expect
    .poll(() => page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().devTools.enabled))
    .toBe(true);

  await page.getByRole("button", { name: /midnight/i }).click();
  await expect(page.getByTestId("developer-time-output")).toHaveText("00:00");
  expect(await page.evaluate(
    () => window.__STILLPOINT_TEST__?.snapshot().devTools.persistentWorldMinutes,
  )).toBe(12 * 60);
  expect(await page.evaluate(
    () => window.__STILLPOINT_TEST__?.snapshot().environment.phase,
  )).toBe("night");

  await page.getByTestId("developer-weather").selectOption("storm");
  await expect
    .poll(() => page.evaluate(
      () => window.__STILLPOINT_TEST__?.snapshot().devTools.weatherOverride,
    ))
    .toBe("storm");
  expect(await page.evaluate(
    () => window.__STILLPOINT_TEST__?.snapshot().environment.weatherId,
  )).toBe("storm");

  await page.getByTestId("developer-clock-toggle").click();
  expect(await page.evaluate(
    () => window.__STILLPOINT_TEST__?.snapshot().devTools.clockPaused,
  )).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("developer-panel")).toBeHidden();

  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.waitForFunction(() => window.__STILLPOINT_TEST__?.isReady() === true);
  await page.getByTestId("enter-frontier").click();
  const restored = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot());
  expect(restored?.devTools.enabled).toBe(false);
  expect(restored?.devTools.weatherOverride).toBeNull();
  expect(restored?.environment.hour).toBe(12);
  expect(restored?.environment.minute).toBe(0);
});

test("opens developer tools from the keyboard while paused and protects form input", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const before = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().position);

  await page.keyboard.press("Backquote");
  await expect(page.getByTestId("developer-panel")).toBeVisible();
  await page.getByTestId("developer-mode-toggle").click();
  await page.getByTestId("developer-time").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  const after = await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().position);
  expect(after).toEqual(before);

  await page.getByTestId("developer-time").press("Escape");
  await expect(page.getByTestId("developer-panel")).toBeHidden();
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
  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWaypoint(1_250, -3_400));
  await expect(page.getByTestId("mission-card")).toContainText("RECOVERED");

  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("entry-screen")).toBeVisible();
  await page.getByTestId("enter-frontier").click();
  await expect(page.getByTestId("mission-card")).toContainText("RECOVERED");
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().scanned)).toEqual([
    "amber-relay",
  ]);
  expect(await page.evaluate(() => window.__STILLPOINT_TEST__?.snapshot().navigation?.target.position))
    .toEqual({ x: 1_250, z: -3_400 });
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

test("blocks representative buildings, trees, and rocks without tunneling", async ({ page }) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const mega = getSettlement("vesper-crown");
  expect(mega).not.toBeNull();
  if (!mega) return;
  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);

  const colliders = await page.evaluate(() => window.__STILLPOINT_TEST__?.colliders() ?? []);
  const representatives = [
    colliders.find((collider) => collider.id.startsWith("building:")),
    colliders.find((collider) => collider.id.startsWith("scenery-tree:")),
    colliders.find((collider) => collider.id.startsWith("scenery-rock:")),
  ];
  expect(representatives.every(Boolean)).toBe(true);

  for (const collider of representatives) {
    if (!collider) continue;
    const axis = collider.shape === "box"
      ? { x: Math.cos(collider.rotation), z: -Math.sin(collider.rotation) }
      : { x: 1, z: 0 };
    const extent = collider.shape === "box" ? collider.halfWidth : collider.radius;
    const distance = extent + 4;
    const current = {
      x: collider.x - axis.x * distance,
      z: collider.z - axis.z * distance,
    };
    const desired = {
      x: collider.x + axis.x * distance,
      z: collider.z + axis.z * distance,
    };
    const probe = await page.evaluate(
      ({ start, end }) => window.__STILLPOINT_TEST__?.probeCollision(start, end),
      { start: current, end: desired },
    );
    expect(probe?.clear).toBe(true);
    expect(probe?.candidateCount).toBeGreaterThan(0);
    expect(probe?.candidateCount).toBeLessThan(colliders.length);
    expect(Math.hypot(
      (probe?.position.x ?? desired.x) - desired.x,
      (probe?.position.z ?? desired.z) - desired.z,
    )).toBeGreaterThan(0.5);
  }
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
  expect(settled?.loadedChunks).toBe(WORLD_RESIDENT_CHUNKS);
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

test("megacity day and night activity are visually reviewable @visual", async ({ page }, testInfo) => {
  await openDeterministicWorld(page);
  await page.getByTestId("enter-frontier").click();
  const mega = getSettlement("vesper-crown");
  expect(mega).not.toBeNull();
  if (!mega) return;
  await page.evaluate(([x, z]) => window.__STILLPOINT_TEST__?.teleport(x, z), [mega.x, mega.z]);
  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(12 * 60));
  await expect(page.getByTestId("crowd-readout")).toContainText("SURGE");
  await expect(page.getByTestId("crowd-readout")).toContainText("TIME DEMAND 100%");
  await page.waitForTimeout(150);
  if (process.env.VISUAL_BASELINES === "1") {
    await expect(page).toHaveScreenshot("vesper-crown-noon.png");
  } else {
    await attachScreenshot(page, testInfo, "vesper-crown-noon-candidate");
  }

  await page.evaluate(() => window.__STILLPOINT_TEST__?.setWorldMinutes(3 * 60));
  await expect(page.getByTestId("world-clock")).toContainText("03:00");
  await expect(page.getByTestId("crowd-readout")).toContainText("TIME DEMAND 18%");
  expect((await page.evaluate(() => window.__STILLPOINT_TEST__?.nightLighting()))?.strength)
    .toBeGreaterThan(0.95);
  await page.waitForTimeout(150);
  const nightPixels = await canvasVisualStats(page);
  expect(nightPixels.range).toBeGreaterThan(8);
  if (process.env.VISUAL_BASELINES === "1") {
    await expect(page).toHaveScreenshot("vesper-crown-0300.png");
  } else {
    await attachScreenshot(page, testInfo, "vesper-crown-0300-candidate");
  }
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

  await page.goto("/?visual=dev", { waitUntil: "load" });
  await expect(page.getByTestId("developer-panel")).toContainText("SESSION-ONLY SANDBOX");
  await expect(page.getByTestId("developer-panel")).toContainText("Canopy drizzle");
  await attachScreenshot(page, testInfo, "developer-tools-fixture");

  await page.goto("/?visual=night", { waitUntil: "load" });
  await expect(page.getByTestId("world-clock")).toContainText("02:06");
  await expect(page.getByTestId("world-clock")).toContainText("RUNNING");
  await expect(page.getByTestId("crowd-readout")).toContainText("TIME DEMAND 18%");
  await attachScreenshot(page, testInfo, "night-clock-fixture");
});

test("explains unavailable graphics acceleration @fallback", async ({ page }, testInfo) => {
  await page.goto("/?test=1", { waitUntil: "load" });
  await expect(page.getByTestId("engine-error")).toBeVisible();
  await expect(page.getByTestId("engine-error")).toContainText("WebGL2-capable browser");
  await attachScreenshot(page, testInfo, "webgl-fallback");
});
