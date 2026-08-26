import { describe, expect, it } from "vitest";
import {
  MAP_MAX_ZOOM,
  clampMapViewport,
  fitMapViewport,
  focusMapViewport,
  mapDetailLevel,
  mapScreenPointToWorld,
  mapStageLayout,
  panMapViewport,
  visibleMapWorldBounds,
  worldToMapScreenPoint,
  zoomMapViewportAtPoint,
} from "../../lib/game/cartography/viewport";

const EXTENT = 48_000;

describe("cartographic viewport", () => {
  it("fits a square atlas without stretching it in a wide plot", () => {
    expect(fitMapViewport()).toEqual({ centerX: 0, centerZ: 0, zoom: 1 });
    expect(mapStageLayout({ width: 1_200, height: 800 })).toEqual({
      left: 200,
      top: 0,
      size: 800,
    });
    const west = worldToMapScreenPoint(
      { x: -EXTENT, z: 0 },
      fitMapViewport(),
      { width: 1_200, height: 800 },
      EXTENT,
    );
    const east = worldToMapScreenPoint(
      { x: EXTENT, z: 0 },
      fitMapViewport(),
      { width: 1_200, height: 800 },
      EXTENT,
    );
    expect(west?.x).toBe(200);
    expect(east?.x).toBe(1_000);
  });

  it("round-trips world coordinates through a zoomed non-square plot", () => {
    const metrics = { width: 1_200, height: 800 };
    const viewport = { centerX: 3_000, centerZ: -4_000, zoom: 3 };
    const world = { x: 12_000, z: -8_000 };
    const screen = worldToMapScreenPoint(world, viewport, metrics, EXTENT);
    expect(screen).not.toBeNull();
    const restored = screen
      ? mapScreenPointToWorld(screen, viewport, metrics, EXTENT)
      : null;
    expect(restored?.x).toBeCloseTo(world.x, 6);
    expect(restored?.z).toBeCloseTo(world.z, 6);
  });

  it("does not place waypoints in full-atlas letterbox space", () => {
    expect(mapScreenPointToWorld(
      { x: 100, y: 400 },
      fitMapViewport(),
      { width: 1_200, height: 800 },
      EXTENT,
    )).toBeNull();
  });

  it("keeps the world point beneath the cursor anchored while zooming", () => {
    const metrics = { width: 1_200, height: 800 };
    const anchor = { x: 900, y: 200 };
    const initial = fitMapViewport();
    const world = mapScreenPointToWorld(anchor, initial, metrics, EXTENT);
    const zoomed = zoomMapViewportAtPoint(initial, 4, anchor, metrics, EXTENT);
    expect(world).not.toBeNull();
    const screen = world
      ? worldToMapScreenPoint(world, zoomed, metrics, EXTENT)
      : null;
    expect(screen?.x).toBeCloseTo(anchor.x, 6);
    expect(screen?.y).toBeCloseTo(anchor.y, 6);
  });

  it("pans in world units and clamps every atlas edge", () => {
    const metrics = { width: 800, height: 800 };
    const panned = panMapViewport(
      { centerX: 0, centerZ: 0, zoom: 4 },
      { x: 120, y: 60 },
      metrics,
      EXTENT,
    );
    expect(panned.centerX).toBeCloseTo(-3_600);
    expect(panned.centerZ).toBeCloseTo(-1_800);

    const clamped = clampMapViewport(
      { centerX: 999_999, centerZ: -999_999, zoom: 4 },
      metrics,
      EXTENT,
    );
    expect(clamped.centerX).toBe(36_000);
    expect(clamped.centerZ).toBe(-36_000);
  });

  it("focuses destinations at a useful local zoom and reports visible bounds", () => {
    const metrics = { width: 1_200, height: 800 };
    const focused = focusMapViewport(
      fitMapViewport(),
      { x: 30_000, z: -12_000 },
      metrics,
      EXTENT,
      4,
    );
    expect(focused).toMatchObject({ centerX: 30_000, centerZ: -12_000, zoom: 4 });
    const bounds = visibleMapWorldBounds(focused, metrics, EXTENT);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(36_000);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(24_000);
  });

  it("contains invalid inputs and exposes stable semantic detail levels", () => {
    const safe = clampMapViewport(
      { centerX: Number.NaN, centerZ: Number.POSITIVE_INFINITY, zoom: 9_999 },
      { width: Number.NaN, height: -1 },
      EXTENT,
    );
    expect(safe).toEqual({ centerX: 0, centerZ: 0, zoom: MAP_MAX_ZOOM });
    expect(mapDetailLevel(1)).toBe("atlas");
    expect(mapDetailLevel(2)).toBe("regional");
    expect(mapDetailLevel(4)).toBe("local");
  });
});
