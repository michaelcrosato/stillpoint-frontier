import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../lib/game/Engine";
import {
  acceptContract,
  createContractJournal,
} from "../../lib/game/gameplay/contracts";
import { createFeatureProgress } from "../../lib/game/gameplay/progression";
import {
  MANUAL_WAYPOINT_ID,
  NavigationService,
} from "../../lib/game/navigation/NavigationService";
import { MOUNTAIN_LANDMARK } from "../../lib/game/world/mountainLandmark";
import { CANYON_LANDMARK } from "../../lib/game/world/canyonLandmark";
import { AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID } from "../../lib/game/world/authoredLandmarks";

const CONTRACT_TARGET_ID = "contract:active-objective";

interface NavigationEngineHarness {
  navigation: NavigationService;
  featureProgress: ReturnType<typeof createFeatureProgress>;
  environment: {
    getSample(): { totalMinutes: number };
  };
  persist(): boolean;
  emitPresentation(): void;
  emitSnapshot(force?: boolean): void;
  syncContractNavigation(activate?: boolean): void;
  syncAuthoredLandmarkTargets(): void;
  clearManualWaypoint(): boolean;
  clearActiveNavigationTarget(expectedId?: string): boolean;
  removeNavigationTarget(id: string): boolean;
}

function createNavigationHarness() {
  const navigation = new NavigationService();
  const featureProgress = createFeatureProgress();
  featureProgress.contractJournal = acceptContract(
    createContractJournal(),
    "contract:field-calibration:v1",
    500,
  );
  const engine = Object.create(Engine.prototype) as NavigationEngineHarness;
  Object.assign(engine, {
    navigation,
    featureProgress,
    environment: {
      getSample: () => ({ totalMinutes: 720 }),
    },
    persist: vi.fn(() => true),
    emitPresentation: vi.fn(),
    emitSnapshot: vi.fn(),
  });

  engine.syncContractNavigation();
  expect(navigation.getActiveTarget()?.id).toBe(CONTRACT_TARGET_ID);
  navigation.setManualWaypoint({ x: 120, z: -80 });
  expect(navigation.getActiveTarget()?.id).toBe(MANUAL_WAYPOINT_ID);
  return { engine, navigation };
}

describe("Engine navigation precedence", () => {
  it("registers every authored landmark waypoint without stealing active guidance", () => {
    const { engine, navigation } = createNavigationHarness();
    const activeBefore = navigation.getActiveTarget()?.id;

    engine.syncAuthoredLandmarkTargets();

    expect(navigation.getActiveTarget()?.id).toBe(activeBefore);
    expect(navigation.getTarget(MOUNTAIN_LANDMARK.trailheadId)).toMatchObject({
      id: MOUNTAIN_LANDMARK.trailheadId,
      label: MOUNTAIN_LANDMARK.trailheadName,
      position: MOUNTAIN_LANDMARK.baseWaypoint,
      source: {
        kind: "system",
        systemId: AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID,
      },
      arrivalRadius: 24,
      clearOnArrival: false,
    });
    expect(navigation.getTarget(CANYON_LANDMARK.overlookId)).toMatchObject({
      id: CANYON_LANDMARK.overlookId,
      label: CANYON_LANDMARK.overlookName,
      position: CANYON_LANDMARK.overlookWaypoint,
      source: {
        kind: "system",
        systemId: AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID,
      },
      arrivalRadius: 28,
      clearOnArrival: false,
    });
  });

  it("restores active contract guidance after clearing a manual waypoint", () => {
    const { engine, navigation } = createNavigationHarness();

    expect(engine.clearManualWaypoint()).toBe(true);

    expect(navigation.getTarget(MANUAL_WAYPOINT_ID)).toBeNull();
    expect(navigation.getActiveTarget()?.id).toBe(CONTRACT_TARGET_ID);
  });

  it("restores active contract guidance when the generic remover deletes the manual waypoint", () => {
    const { engine, navigation } = createNavigationHarness();

    expect(engine.removeNavigationTarget(MANUAL_WAYPOINT_ID)).toBe(true);

    expect(navigation.getTarget(MANUAL_WAYPOINT_ID)).toBeNull();
    expect(navigation.getActiveTarget()?.id).toBe(CONTRACT_TARGET_ID);
  });

  it("restores contract guidance when a generic clear suspends the active manual waypoint", () => {
    const { engine, navigation } = createNavigationHarness();

    expect(engine.clearActiveNavigationTarget(MANUAL_WAYPOINT_ID)).toBe(true);

    expect(navigation.getTarget(MANUAL_WAYPOINT_ID)).not.toBeNull();
    expect(navigation.getActiveTarget()?.id).toBe(CONTRACT_TARGET_ID);
  });
});
