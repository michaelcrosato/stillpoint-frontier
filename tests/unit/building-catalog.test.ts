import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  AUTHORED_BUILDINGS,
  authoredBuildingById,
  authoredBuildingSupportCandidates,
  authoredBuildingsForChunk,
  authoredBuildingsForLandmark,
  buildingLocalToWorld,
  createAuthoredBuildingsForChunk,
  resolveBuildingAnchor,
} from "../../lib/game/world/authoredBuildings";
import { spawnBuildingSupportCandidates } from "../../lib/game/world/spawnBuilding";
import { tenStorySupportCandidates } from "../../lib/game/world/tenStoryBuilding";
import { twoStorySupportCandidates } from "../../lib/game/world/twoStoryBuilding";
import { interiorPlacementIssues } from "../../lib/game/world/spawnFeatures";
import type { InteriorPlacement } from "../../lib/game/world/spawnFeatures";
import { createAuthoredGameplayFeaturesForChunk } from "../../lib/game/world/spawnFeatures";
import { inspectablesForChunk } from "../../lib/game/world/inspectables";

function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

describe("authored building catalog", () => {
  it("publishes unique stable IDs, door IDs, and chunk membership", () => {
    const semanticIds = AUTHORED_BUILDINGS.map(({ frame }) => frame.id);
    const definitionIds = AUTHORED_BUILDINGS.map(({ frame }) => frame.definitionId);
    const doorIds = AUTHORED_BUILDINGS.flatMap((recipe) => recipe.doorIds);
    expect(new Set(semanticIds).size).toBe(semanticIds.length);
    expect(new Set(definitionIds).size).toBe(definitionIds.length);
    expect(new Set(doorIds).size).toBe(doorIds.length);
    expect(authoredBuildingsForChunk("0:0")).toHaveLength(3);
    expect(authoredBuildingsForChunk("50:50")).toEqual([]);
    expect(authoredBuildingsForLandmark("landmark:field-unit-compound"))
      .toHaveLength(3);
    expect(authoredBuildingsForLandmark("landmark:remote-site")).toEqual([]);
    expect(authoredBuildingById("missing")).toBeNull();
  });

  it("streams authored gameplay and inspectables only in their owning chunk", () => {
    const local = createAuthoredGameplayFeaturesForChunk(
      "0:0",
      "performance",
      450,
      {},
    );
    const remote = createAuthoredGameplayFeaturesForChunk(
      "1:0",
      "performance",
      450,
      {},
    );
    expect(local.root.children.length).toBeGreaterThan(0);
    expect(local.targets.some((target) => target.kind === "npc")).toBe(true);
    expect(remote.root.children).toHaveLength(0);
    expect(remote.colliders).toHaveLength(0);
    expect(remote.targets).toHaveLength(0);
    expect(inspectablesForChunk("0:0")).toHaveLength(3);
    expect(inspectablesForChunk("1:0")).toHaveLength(0);
    dispose(local.root);
    dispose(remote.root);
  });

  it("passes persistent door state through each recipe", () => {
    const doorStates = Object.fromEntries(
      AUTHORED_BUILDINGS.flatMap((recipe) => recipe.doorIds.map((id) => [id, true])),
    );
    const runtimes = createAuthoredBuildingsForChunk(
      "0:0",
      "performance",
      doorStates,
    );
    expect(runtimes).toHaveLength(AUTHORED_BUILDINGS.length);
    expect(runtimes.flatMap((runtime) => runtime.doors).every((door) => door.isOpen))
      .toBe(true);
    expect(runtimes.flatMap((runtime) => runtime.doors.map((door) => door.id)).sort())
      .toEqual(AUTHORED_BUILDINGS.flatMap((recipe) => recipe.doorIds).sort());
    for (const runtime of runtimes) dispose(runtime.root);
  });

  it("aggregates unchanged support algorithms and resolves finite anchors", () => {
    const samples = [[12, -6], [18, 13], [4, 34], [500, 500]] as const;
    for (const [x, z] of samples) {
      expect(authoredBuildingSupportCandidates(x, z)).toEqual([
        ...spawnBuildingSupportCandidates(x, z),
        ...twoStorySupportCandidates(x, z),
        ...tenStorySupportCandidates(x, z),
      ]);
    }
    const frame = authoredBuildingById("survey-house")!.frame;
    expect(Object.values(buildingLocalToWorld(frame, 1, 2)).every(Number.isFinite))
      .toBe(true);
    expect(resolveBuildingAnchor({
      buildingId: "survey-house",
      floor: 1,
      localX: -1.35,
      localZ: 1.15,
    })).toMatchObject({ y: frame.floorYs[1], yaw: frame.rotation });
    expect(resolveBuildingAnchor({
      buildingId: "missing",
      floor: 0,
      localX: 0,
      localZ: 0,
    })).toBeNull();
  });

  it("reports unknown building references in interior authoring data", () => {
    const invalid = {
      id: "test",
      buildingId: "missing",
      floor: 0,
      localX: 0,
      localZ: 0,
      width: 1,
      depth: 1,
      height: 1,
      color: 0xffffff,
    } as unknown as InteriorPlacement;
    expect(interiorPlacementIssues([invalid])).toContain(
      "missing:test:unknown-building",
    );
  });
});
