import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { ScanCandidate } from "../../lib/game/gameplay/fieldGuide";
import {
  SCAN_HOLD_SECONDS,
  ScannerSystem,
} from "../../lib/game/systems/ScannerSystem";
import type {
  GameRuntimeContext,
  ScannerRuntimeState,
} from "../../lib/game/systems/runtime";

const WEATHER_MAST = "guide:landmark:field-unit-weather-mast:v1";
const FIBER = "guide:resource:fiber:v1";

function candidate(
  id: string,
  entryId: string,
  z: number,
  name = id,
): ScanCandidate {
  return {
    id,
    entryId,
    name,
    position: { x: 0, y: 1.6, z },
    maxDistance: 24,
  };
}

function scannerRuntime(options: {
  candidates?: readonly ScanCandidate[];
  started?: boolean;
  paused?: boolean;
  scannerDown?: boolean;
  knownEntries?: readonly string[];
  hasLineOfSight?: (position: Readonly<{ x: number; y: number; z: number }>) => boolean;
} = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  camera.updateMatrixWorld(true);
  let candidates = [...(options.candidates ?? [])];
  let scannerDown = options.scannerDown ?? true;
  const knownEntries = new Set(options.knownEntries ?? []);
  const scanner: ScannerRuntimeState = {
    active: false,
    focusId: null,
    focusEntryId: null,
    focusName: null,
    progress: 0,
  };
  const consumeActionPressed = vi.fn(() => false);
  const isActionDown = vi.fn((action: string) => action === "scanner" && scannerDown);
  const toggleOperations = vi.fn();
  const completeScan = vi.fn(() => true);
  const hasLineOfSight = vi.fn(
    (
      _origin: Readonly<{ x: number; y: number; z: number }>,
      position: Readonly<{ x: number; y: number; z: number }>,
    ) => options.hasLineOfSight?.(position) ?? true,
  );
  const context = {
    input: { consumeActionPressed, isActionDown },
    camera,
    world: { hasLineOfSight },
    started: options.started ?? true,
    paused: options.paused ?? false,
    scanner,
    toggleOperations,
    scanCandidates: () => candidates,
    completeScan,
    hasFieldGuideEntry: (entryId: string) => knownEntries.has(entryId),
  } as unknown as GameRuntimeContext;

  return {
    context,
    scanner,
    consumeActionPressed,
    isActionDown,
    toggleOperations,
    completeScan,
    hasLineOfSight,
    setCandidates(next: readonly ScanCandidate[]) {
      candidates = [...next];
    },
    setScannerDown(down: boolean) {
      scannerDown = down;
    },
  };
}

describe("field scanner system", () => {
  it("routes a consumed field-guide edge to operations exactly once", () => {
    const runtime = scannerRuntime({ scannerDown: false });
    runtime.consumeActionPressed
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const system = new ScannerSystem();

    system.update(runtime.context, 1 / 60);
    system.update(runtime.context, 1 / 60);

    expect(runtime.consumeActionPressed).toHaveBeenCalledWith("fieldGuide");
    expect(runtime.toggleOperations).toHaveBeenCalledTimes(1);
  });

  it("clears every transient scanner field while paused or after release", () => {
    const dirtyState: ScannerRuntimeState = {
      active: true,
      focusId: "weather-mast",
      focusEntryId: WEATHER_MAST,
      focusName: "Weather mast",
      progress: 0.75,
    };
    const paused = scannerRuntime({ paused: true });
    Object.assign(paused.scanner, dirtyState);
    new ScannerSystem().update(paused.context, 0.1);
    expect(paused.scanner).toEqual({
      active: false,
      focusId: null,
      focusEntryId: null,
      focusName: null,
      progress: 0,
    });

    const released = scannerRuntime();
    Object.assign(released.scanner, dirtyState);
    released.setScannerDown(false);
    new ScannerSystem().update(released.context, 0.1);
    expect(released.scanner).toEqual(paused.scanner);
  });

  it("skips an occluded nearer subject and focuses the visible aligned subject", () => {
    const blocked = candidate("blocked-mast", WEATHER_MAST, -4, "Blocked mast");
    const visible = candidate("visible-fiber", FIBER, -8, "Visible fiber");
    const runtime = scannerRuntime({
      candidates: [blocked, visible],
      hasLineOfSight: (position) => position.z < -6,
    });

    new ScannerSystem().update(runtime.context, 0.1);

    expect(runtime.scanner).toMatchObject({
      active: true,
      focusId: visible.id,
      focusEntryId: visible.entryId,
      focusName: visible.name,
    });
    expect(runtime.scanner.progress).toBeCloseTo(0.1 / SCAN_HOLD_SECONDS);
    expect(runtime.hasLineOfSight).toHaveBeenCalledTimes(2);
    expect(runtime.hasLineOfSight).toHaveBeenLastCalledWith(
      runtime.context.camera.position,
      visible.position,
      {
        ignoredColliderIds: [visible.id],
        checkTerrain: true,
      },
    );
  });

  it("completes one continuous hold once and does not repeat completion", () => {
    const subject = candidate("weather-mast", WEATHER_MAST, -5, "Weather mast");
    const runtime = scannerRuntime({ candidates: [subject] });
    const system = new ScannerSystem();

    for (let index = 0; index < 20; index += 1) {
      system.update(runtime.context, 0.1);
    }

    expect(runtime.scanner.progress).toBe(1);
    expect(runtime.completeScan).toHaveBeenCalledTimes(1);
    expect(runtime.completeScan).toHaveBeenCalledWith(WEATHER_MAST);
  });

  it("restarts progress for a new focus and clears focus when no subject remains", () => {
    const first = candidate("weather-mast", WEATHER_MAST, -5);
    const second = candidate("fiber-sample", FIBER, -6);
    const runtime = scannerRuntime({ candidates: [first] });
    const system = new ScannerSystem();

    for (let index = 0; index < 4; index += 1) {
      system.update(runtime.context, 0.1);
    }
    expect(runtime.scanner.progress).toBeCloseTo(0.4 / SCAN_HOLD_SECONDS);

    runtime.setCandidates([second]);
    system.update(runtime.context, 0.05);
    expect(runtime.scanner).toMatchObject({
      active: true,
      focusId: second.id,
      focusEntryId: second.entryId,
      progress: 0.05 / SCAN_HOLD_SECONDS,
    });

    runtime.setCandidates([]);
    system.update(runtime.context, 0.1);
    expect(runtime.scanner).toEqual({
      active: true,
      focusId: null,
      focusEntryId: null,
      focusName: null,
      progress: 0,
    });
  });

  it("shows an already-known subject as resolved without completing it again", () => {
    const known = candidate("known-weather-mast", WEATHER_MAST, -5, "Known mast");
    const runtime = scannerRuntime({
      candidates: [known],
      knownEntries: [WEATHER_MAST],
    });
    const system = new ScannerSystem();

    system.update(runtime.context, 0.1);
    system.update(runtime.context, 0.1);

    expect(runtime.scanner).toMatchObject({
      active: true,
      focusId: known.id,
      focusEntryId: WEATHER_MAST,
      progress: 1,
    });
    expect(runtime.completeScan).not.toHaveBeenCalled();
  });
});
