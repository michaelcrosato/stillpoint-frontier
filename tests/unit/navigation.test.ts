import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  bearingDegrees,
  buildCompassMarks,
  cardinalForHeading,
  formatNavigationDistance,
  formatHeading,
  headingFromYaw,
  mapPercentToWorld,
  mapPointToWorld,
  normalizeDegrees,
  signedHeadingDelta,
  unwrappedHeadingFromYaw,
  worldToMapPercent,
} from "../../lib/game/navigation/math";
import {
  MANUAL_WAYPOINT_ID,
  NavigationService,
} from "../../lib/game/navigation/NavigationService";
import {
  GamePresentationStore,
  INITIAL_PRESENTATION,
} from "../../lib/game/navigation/presentation";

describe("navigation math", () => {
  it.each([
    [-721, 359],
    [-1, 359],
    [0, 0],
    [359, 359],
    [360, 0],
    [721, 1],
    [Number.NaN, 0],
  ])("normalizes %s degrees to %s", (value, expected) => {
    expect(normalizeDegrees(value)).toBe(expected);
  });

  it("uses north-zero clockwise headings for the Three.js camera", () => {
    expect(headingFromYaw(0)).toBe(0);
    expect(headingFromYaw(-Math.PI / 2)).toBe(90);
    expect(headingFromYaw(Math.PI)).toBe(180);
    expect(headingFromYaw(Math.PI / 2)).toBe(270);
    expect(unwrappedHeadingFromYaw(-Math.PI * 2.25)).toBeCloseTo(405, 10);
    expect(unwrappedHeadingFromYaw(Number.NaN)).toBe(0);
  });

  it.each([
    [{ x: 0, z: -10 }, 0],
    [{ x: 10, z: 0 }, 90],
    [{ x: 0, z: 10 }, 180],
    [{ x: -10, z: 0 }, 270],
  ])("computes cardinal target bearings", (target, expected) => {
    expect(bearingDegrees({ x: 0, z: 0 }, target)).toBe(expected);
  });

  it("takes the shortest signed turn across north", () => {
    expect(signedHeadingDelta(1, 359)).toBe(2);
    expect(signedHeadingDelta(359, 1)).toBe(-2);
    expect(signedHeadingDelta(180, 0)).toBe(-180);
  });

  it("contains invalid coordinate input and formats navigation readouts", () => {
    expect(bearingDegrees({ x: Number.NaN, z: 0 }, { x: 1, z: 1 })).toBe(0);
    expect(bearingDegrees({ x: 4, z: 9 }, { x: 4, z: 9 })).toBe(0);
    expect(worldToMapPercent(Number.NaN, 48_000)).toBe(50);
    expect(worldToMapPercent(0, 0)).toBe(50);
    expect(mapPercentToWorld(Number.NaN, 48_000)).toBe(0);
    expect(mapPercentToWorld(50, -1)).toBe(0);
    expect(cardinalForHeading(44)).toBe("NE");
    expect(formatNavigationDistance(Number.NaN)).toBe("--");
    expect(formatNavigationDistance(-1)).toBe("--");
    expect(formatNavigationDistance(999)).toBe("999 M");
    expect(formatNavigationDistance(1_250)).toBe("1.3 KM");
    expect(formatNavigationDistance(12_500)).toBe("13 KM");
  });

  it("round-trips arbitrary atlas coordinates through map percentages", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -48_000, max: 48_000, noNaN: true, noDefaultInfinity: true }),
        (coordinate) => {
          const percent = worldToMapPercent(coordinate, 48_000);
          expect(mapPercentToWorld(percent, 48_000)).toBeCloseTo(coordinate, 8);
        },
      ),
    );
  });

  it("maps clicks through non-square rectangles and clamps their edges", () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 };
    expect(mapPointToWorld(700, 150, rect, 48_000)).toEqual({ x: 24_000, z: -24_000 });
    expect(mapPointToWorld(-500, 900, rect, 48_000)).toEqual({ x: -48_000, z: 48_000 });
    expect(mapPointToWorld(100, 50, { ...rect, width: 0 }, 48_000)).toBeNull();
    expect(mapPointToWorld(Number.NaN, 50, rect, 48_000)).toBeNull();
    expect(mapPointToWorld(100, Number.NaN, rect, 48_000)).toBeNull();
    expect(mapPointToWorld(100, 50, { ...rect, left: Number.NaN }, 48_000)).toBeNull();
    expect(mapPointToWorld(100, 50, { ...rect, top: Number.NaN }, 48_000)).toBeNull();
    expect(mapPointToWorld(100, 50, { ...rect, height: 0 }, 48_000)).toBeNull();
    expect(mapPointToWorld(100, 50, rect, 0)).toBeNull();
  });

  it("builds a continuous five-degree tape through north", () => {
    const beforeNorth = buildCompassMarks(359, 60, 5);
    const north = beforeNorth.find((mark) => mark.absoluteHeading === 360);
    expect(north).toMatchObject({ heading: 0, offset: 1, label: "N", kind: "cardinal" });

    const between = buildCompassMarks(22.5, 60, 5);
    expect(between.find((mark) => mark.heading === 0)?.offset).toBe(-22.5);
    expect(between.find((mark) => mark.heading === 45)?.offset).toBe(22.5);
    expect(new Set(beforeNorth.map((mark) => mark.absoluteHeading)).size).toBe(beforeNorth.length);
    expect(formatHeading(359.8)).toBe("000°");
    expect(buildCompassMarks(Number.NaN, 0, Number.NaN)).toEqual(buildCompassMarks(0, 60, 5));
  });
});

describe("navigation service", () => {
  it("keeps registered quest targets when a player waypoint becomes active", () => {
    const navigation = new NavigationService();
    navigation.setTarget(
      {
        id: "quest:signal:relay",
        label: "Recover the relay",
        position: { x: 100, z: -200 },
        source: { kind: "quest", questId: "signal", objectiveId: "relay" },
      },
      false,
    );
    navigation.setManualWaypoint({ x: 10, z: -10 });
    navigation.setManualWaypoint({ x: 20, z: -30 });

    expect(navigation.targetsSnapshot()).toHaveLength(2);
    expect(navigation.getTarget(MANUAL_WAYPOINT_ID)?.position).toEqual({ x: 20, z: -30 });
    expect(navigation.getActiveTarget()?.id).toBe(MANUAL_WAYPOINT_ID);
    expect(navigation.activateTarget("quest:signal:relay")).toBe(true);
    expect(navigation.getActiveTarget()?.source.kind).toBe("quest");
  });

  it("computes distance, absolute bearing, and player-relative bearing", () => {
    const navigation = new NavigationService();
    navigation.setManualWaypoint({ x: 30, z: -40 });
    expect(navigation.getGuidance({ x: 0, z: 0 }, 0)).toMatchObject({
      distance: 50,
      reached: false,
    });
    const east = navigation.getGuidance({ x: 0, z: 0 }, 90);
    expect(east?.bearing).toBeCloseTo(36.869897, 5);
    expect(east?.relativeBearing).toBeCloseTo(-53.130103, 5);
  });

  it("emits arrival once and holds a player waypoint for confirmation", () => {
    const navigation = new NavigationService();
    const arrived = vi.fn();
    navigation.on("arrived", arrived);
    navigation.setManualWaypoint({ x: 10, z: 0 });

    navigation.update({ x: 0, z: 0 });
    navigation.update({ x: 1, z: 0 });
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(navigation.getGuidance({ x: 1, z: 0 }, 0)?.reached).toBe(true);
    expect(navigation.getActiveTarget()?.id).toBe(MANUAL_WAYPOINT_ID);
  });

  it("allows one-shot scripted destinations to clear on arrival", () => {
    const navigation = new NavigationService();
    const arrived = vi.fn();
    navigation.on("arrived", arrived);
    navigation.setTarget({
      id: "script:intro:door",
      label: "Enter the station",
      position: { x: 5, z: 5 },
      source: { kind: "script", scriptId: "intro" },
      arrivalRadius: 2,
      clearOnArrival: true,
    });
    navigation.update({ x: 4, z: 5 });
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(navigation.getActiveTarget()).toBeNull();
    expect(navigation.getTarget("script:intro:door")).toBeNull();
  });

  it("does not let a stale clear command remove a newer active target", () => {
    const navigation = new NavigationService();
    navigation.setManualWaypoint({ x: 1, z: 2 });
    navigation.setTarget({
      id: "system:shelter",
      label: "Emergency shelter",
      position: { x: -5, z: 9 },
      source: { kind: "system", systemId: "weather" },
    });
    expect(navigation.clearActive(MANUAL_WAYPOINT_ID)).toBe(false);
    expect(navigation.getActiveTarget()?.id).toBe("system:shelter");
  });

  it("rejects invalid destinations and protects internal target data", () => {
    const navigation = new NavigationService();
    expect(navigation.setManualWaypoint({ x: Number.NaN, z: 0 })).toBeNull();
    expect(navigation.setTarget({
      id: "invalid id",
      label: "Target",
      position: { x: 0, z: 0 },
      source: { kind: "player" },
    })).toBeNull();
    expect(navigation.setTarget({
      id: "valid:id",
      label: "   ",
      position: { x: 0, z: 0 },
      source: { kind: "player" },
    })).toBeNull();
    expect(navigation.setTarget({
      id: "valid:id",
      label: "Target",
      position: { x: 0, z: Number.NaN },
      source: { kind: "player" },
    })).toBeNull();

    const target = navigation.setManualWaypoint({ x: 2, z: 3 });
    if (!target) throw new Error("Expected a target");
    target.position.x = 999;
    expect(navigation.getActiveTarget()?.position.x).toBe(2);
    expect(navigation.activateTarget("missing:target")).toBe(false);
    expect(navigation.getTarget("missing:target")).toBeNull();
    expect(navigation.removeTarget("missing:target")).toBe(false);
    expect(navigation.clearActive()).toBe(true);
    expect(navigation.clearActive()).toBe(false);
    navigation.dispose();
    expect(navigation.targetsSnapshot()).toEqual([]);
  });

  it("clamps arrival radii and bounds the destination registry", () => {
    const navigation = new NavigationService();
    expect(navigation.setTarget({
      id: "system:tiny",
      label: "Tiny radius",
      position: { x: 0, z: 0 },
      source: { kind: "system", systemId: "test" },
      arrivalRadius: 0,
    })?.arrivalRadius).toBe(0.5);
    expect(navigation.setTarget({
      id: "system:huge",
      label: "Huge radius",
      position: { x: 0, z: 0 },
      source: { kind: "system", systemId: "test" },
      arrivalRadius: 50_000,
    })?.arrivalRadius).toBe(1_000);
    expect(navigation.setTarget({
      id: "system:fallback",
      label: "Fallback radius",
      position: { x: 0, z: 0 },
      source: { kind: "system", systemId: "test" },
      arrivalRadius: Number.NaN,
    })?.arrivalRadius).toBe(12);

    for (let index = 0; index < 130; index += 1) {
      navigation.setTarget({
        id: `system:capacity:${index}`,
        label: `Target ${index}`,
        position: { x: index, z: 0 },
        source: { kind: "system", systemId: "capacity" },
      });
    }
    expect(navigation.targetsSnapshot()).toHaveLength(128);
  });
});

describe("render-frame presentation store", () => {
  it("notifies only when presentation values change", () => {
    const store = new GamePresentationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.publish(INITIAL_PRESENTATION);
    expect(listener).not.toHaveBeenCalled();

    store.publish({ ...INITIAL_PRESENTATION, heading: 1, unwrappedHeading: 361 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().unwrappedHeading).toBe(361);
    store.publish({ ...INITIAL_PRESENTATION, heading: 1, unwrappedHeading: 361 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.publish({ ...INITIAL_PRESENTATION, heading: 2, unwrappedHeading: 362 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("detects navigation and projection changes independently", () => {
    const store = new GamePresentationStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const navigation = new NavigationService();
    navigation.setManualWaypoint({ x: 20, z: -20 });
    const guidance = navigation.getGuidance({ x: 0, z: 0 }, 0);
    if (!guidance) throw new Error("Expected guidance");

    store.publish({
      heading: 0,
      unwrappedHeading: 0,
      navigation: guidance,
      waypointScreen: { visible: true, xPercent: 50, yPercent: 40 },
    });
    store.publish({
      heading: 0,
      unwrappedHeading: 0,
      navigation: { ...guidance, distance: guidance.distance + 1 },
      waypointScreen: { visible: true, xPercent: 50, yPercent: 40 },
    });
    store.publish({
      heading: 0,
      unwrappedHeading: 0,
      navigation: { ...guidance, distance: guidance.distance + 1 },
      waypointScreen: { visible: false, xPercent: 51, yPercent: 41 },
    });
    store.publish({
      heading: 0,
      unwrappedHeading: 0,
      navigation: null,
      waypointScreen: null,
    });
    expect(listener).toHaveBeenCalledTimes(4);
    expect(store.getServerSnapshot()).toBe(INITIAL_PRESENTATION);
  });
});
