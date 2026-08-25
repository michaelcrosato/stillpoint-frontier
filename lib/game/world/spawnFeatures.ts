import * as THREE from "three";
import { qualityUsesShadows, type QualityLevel } from "../config";
import type { CraftingStationKind } from "../gameplay/crafting";
import type { ContainerStates, LootTableId } from "../gameplay/loot";
import type { RestSiteDefinition } from "../gameplay/resting";
import {
  AUTHORED_NPCS,
  createAuthoredNpcTarget,
} from "../npcs/authoredNpc";
import type { PlanarCollider } from "../systems/collision";
import type { WorldTarget } from "./ChunkManager";
import { SPAWN_BUILDING } from "./spawnBuilding";
import { TEN_STORY_BUILDING } from "./tenStoryBuilding";
import { TWO_STORY_BUILDING } from "./twoStoryBuilding";
import { sampleTerrainHeight } from "./terrain";

export type BuildingId = "field-unit" | "survey-house" | "meridian-tower";

interface InteriorReservation {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface BuildingFrame {
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  wallThickness: number;
  floorYs: readonly number[];
  reservations: readonly InteriorReservation[];
}

export interface InteriorPlacement {
  id: string;
  buildingId: BuildingId;
  floor: number;
  localX: number;
  localZ: number;
  width: number;
  depth: number;
  height: number;
  color: number;
  solid?: boolean;
  emissive?: number;
  interaction?:
    | { type: "craft"; stationId: string; stationKind: CraftingStationKind; label: string }
    | { type: "rest"; site: RestSiteDefinition }
    | { type: "loot"; containerId: string; tableId: LootTableId; label: string };
}

const BUILDING_FRAMES: Readonly<Record<BuildingId, BuildingFrame>> = {
  "field-unit": {
    x: SPAWN_BUILDING.x,
    z: SPAWN_BUILDING.z,
    rotation: 0,
    width: SPAWN_BUILDING.width,
    depth: SPAWN_BUILDING.depth,
    wallThickness: SPAWN_BUILDING.wallThickness,
    floorYs: [SPAWN_BUILDING.floorY],
    reservations: [
      {
        id: "roof-stair",
        minX: SPAWN_BUILDING.roofStairwellMinX,
        maxX: SPAWN_BUILDING.roofStairwellMaxX,
        minZ: SPAWN_BUILDING.roofStairwellMinZ,
        maxZ: SPAWN_BUILDING.roofStairwellMaxZ,
      },
      {
        id: "front-door",
        minX: -SPAWN_BUILDING.doorWidth * 0.5 - 0.45,
        maxX: SPAWN_BUILDING.doorWidth * 0.5 + 0.45,
        minZ: SPAWN_BUILDING.depth * 0.5 - 1.15,
        maxZ: SPAWN_BUILDING.depth * 0.5 + 0.55,
      },
    ],
  },
  "survey-house": {
    x: TWO_STORY_BUILDING.x,
    z: TWO_STORY_BUILDING.z,
    rotation: TWO_STORY_BUILDING.rotation,
    width: TWO_STORY_BUILDING.width,
    depth: TWO_STORY_BUILDING.depth,
    wallThickness: TWO_STORY_BUILDING.wallThickness,
    floorYs: [TWO_STORY_BUILDING.floorY, TWO_STORY_BUILDING.upperFloorY],
    reservations: [
      {
        id: "stairs",
        minX: TWO_STORY_BUILDING.stairwellMinX,
        maxX: TWO_STORY_BUILDING.stairwellMaxX,
        minZ: TWO_STORY_BUILDING.stairwellMinZ,
        maxZ: TWO_STORY_BUILDING.stairwellMaxZ,
      },
      {
        id: "front-door",
        minX: -TWO_STORY_BUILDING.doorWidth * 0.5 - 0.45,
        maxX: TWO_STORY_BUILDING.doorWidth * 0.5 + 0.45,
        minZ: TWO_STORY_BUILDING.depth * 0.5 - 1.2,
        maxZ: TWO_STORY_BUILDING.depth * 0.5 + 0.55,
      },
    ],
  },
  "meridian-tower": {
    x: TEN_STORY_BUILDING.x,
    z: TEN_STORY_BUILDING.z,
    rotation: TEN_STORY_BUILDING.rotation,
    width: TEN_STORY_BUILDING.width,
    depth: TEN_STORY_BUILDING.depth,
    wallThickness: TEN_STORY_BUILDING.wallThickness,
    floorYs: TEN_STORY_BUILDING.floorYs,
    reservations: [
      {
        id: "stairs",
        minX: TEN_STORY_BUILDING.stairwellMinX,
        maxX: TEN_STORY_BUILDING.stairwellMaxX,
        minZ: TEN_STORY_BUILDING.stairwellMinZ,
        maxZ: TEN_STORY_BUILDING.stairwellMaxZ,
      },
      {
        id: "front-door",
        minX: -TEN_STORY_BUILDING.doorWidth * 0.5 - 0.45,
        maxX: TEN_STORY_BUILDING.doorWidth * 0.5 + 0.45,
        minZ: TEN_STORY_BUILDING.depth * 0.5 - 1.2,
        maxZ: TEN_STORY_BUILDING.depth * 0.5 + 0.55,
      },
    ],
  },
};

const BASE_INTERIOR_PLACEMENTS: readonly InteriorPlacement[] = [
  {
    id: "operations-desk",
    buildingId: "field-unit",
    floor: 0,
    localX: -2.45,
    localZ: -1.65,
    width: 2.2,
    depth: 0.72,
    height: 0.82,
    color: 0x4b4a42,
    solid: true,
  },
  {
    id: "fabrication-bench",
    buildingId: "field-unit",
    floor: 0,
    localX: -2.35,
    localZ: 1.65,
    width: 2.3,
    depth: 0.78,
    height: 0.92,
    color: 0x38443f,
    emissive: 0x18362b,
    solid: true,
    interaction: {
      type: "craft",
      stationId: "station:field-unit-01:fabricator",
      stationKind: "workbench",
      label: "Field fabrication bench",
    },
  },
  {
    id: "field-cot",
    buildingId: "field-unit",
    floor: 0,
    localX: 0.15,
    localZ: -1.75,
    width: 1.9,
    depth: 0.76,
    height: 0.38,
    color: 0x68736a,
    interaction: {
      type: "rest",
      site: {
        id: "rest:field-unit-01:cot",
        label: "Field Unit cot",
        safe: true,
        sheltered: true,
        warmth: 0.7,
      },
    },
  },
  {
    id: "supply-locker",
    buildingId: "field-unit",
    floor: 0,
    // Wall-side storage keeps the central entrance aisle unobstructed.
    localX: -3.3,
    localZ: 0.35,
    width: 0.78,
    depth: 0.52,
    height: 1.8,
    color: 0x47514d,
    solid: true,
    interaction: {
      type: "loot",
      containerId: "container:field-unit-01:locker-a",
      tableId: "field_supplies",
      label: "Field supply locker",
    },
  },
  {
    id: "survey-desk",
    buildingId: "survey-house",
    floor: 0,
    localX: -2.8,
    localZ: -1.25,
    width: 2.4,
    depth: 0.8,
    height: 0.82,
    color: 0x554b3d,
    solid: true,
  },
  {
    id: "survey-archive",
    buildingId: "survey-house",
    floor: 0,
    localX: -3.7,
    localZ: 2.3,
    width: 0.62,
    depth: 2.2,
    height: 2.15,
    color: 0x3f4643,
    solid: true,
  },
  {
    id: "survey-bed",
    buildingId: "survey-house",
    floor: 1,
    localX: -2.7,
    localZ: -1.6,
    width: 2,
    depth: 0.82,
    height: 0.42,
    color: 0x6b6558,
    interaction: {
      type: "rest",
      site: {
        id: "rest:survey-house:quarters",
        label: "Survey House bed",
        safe: true,
        sheltered: true,
        warmth: 0.8,
      },
    },
  },
  {
    id: "survey-crate",
    buildingId: "survey-house",
    floor: 1,
    localX: -3.7,
    localZ: 2.25,
    width: 1.05,
    depth: 0.8,
    height: 0.72,
    color: 0x665845,
    solid: true,
    interaction: {
      type: "loot",
      containerId: "container:survey-house:archive-a",
      tableId: "field_supplies",
      label: "Survey archive crate",
    },
  },
];

function towerPlacements(): InteriorPlacement[] {
  return TEN_STORY_BUILDING.floorYs.flatMap((_, floor) => {
    const zone = floor <= 2 ? "records" : floor <= 6 ? "cartography" : "observation";
    const color = zone === "records" ? 0x454947 : zone === "cartography" ? 0x4a5149 : 0x3c4b50;
    const placements: InteriorPlacement[] = [
      {
        id: `${zone}-desk-${floor + 1}`,
        buildingId: "meridian-tower",
        floor,
        localX: -3.7,
        localZ: -1.8,
        width: 2.4,
        depth: 0.8,
        height: 0.82,
        color,
        solid: true,
      },
      {
        id: `${zone}-shelf-${floor + 1}`,
        buildingId: "meridian-tower",
        floor,
        localX: -5.2,
        localZ: 2.4,
        width: 0.58,
        depth: 2.6,
        height: 2.2,
        color: 0x343b3a,
        solid: true,
      },
      {
        id: `${zone}-console-${floor + 1}`,
        buildingId: "meridian-tower",
        floor,
        localX: -0.7,
        localZ: 2.7,
        width: 1.5,
        depth: 0.58,
        height: 1.05,
        color: 0x33403e,
        emissive: 0x18352d,
        solid: true,
      },
    ];
    if (floor === 0) {
      placements.push({
        id: "tower-service-cache",
        buildingId: "meridian-tower",
        floor,
        // Keep the cache outside the positive-X switchback stairwell. This
        // leaves a full player-width approach to the first flight.
        localX: 0.95,
        localZ: 2.5,
        width: 1.2,
        depth: 0.82,
        height: 0.78,
        color: 0x5d5140,
        solid: true,
        interaction: {
          type: "loot",
          containerId: "container:meridian-tower:service-a",
          tableId: "tower_service",
          label: "Meridian service cache",
        },
      });
    }
    return placements;
  });
}

export const INTERIOR_PLACEMENTS = Object.freeze([
  ...BASE_INTERIOR_PLACEMENTS,
  ...towerPlacements(),
]);

function overlapsReservation(
  placement: Readonly<InteriorPlacement>,
  reservation: Readonly<InteriorReservation>,
) {
  const halfWidth = placement.width * 0.5;
  const halfDepth = placement.depth * 0.5;
  return (
    placement.localX + halfWidth > reservation.minX &&
    placement.localX - halfWidth < reservation.maxX &&
    placement.localZ + halfDepth > reservation.minZ &&
    placement.localZ - halfDepth < reservation.maxZ
  );
}

function overlapsPlacement(
  left: Readonly<InteriorPlacement>,
  right: Readonly<InteriorPlacement>,
) {
  return (
    Math.abs(left.localX - right.localX) < (left.width + right.width) * 0.5 &&
    Math.abs(left.localZ - right.localZ) < (left.depth + right.depth) * 0.5
  );
}

/** Pure authoring validation used by tests and future data-driven interiors. */
export function interiorPlacementIssues(
  placements: readonly InteriorPlacement[] = INTERIOR_PLACEMENTS,
) {
  const issues: string[] = [];
  const ids = new Set<string>();
  const validPlacements: InteriorPlacement[] = [];
  for (const placement of placements) {
    const frame = BUILDING_FRAMES[placement.buildingId];
    const stableId = `${placement.buildingId}:${placement.id}`;
    if (ids.has(stableId)) issues.push(`${stableId}:duplicate-id`);
    ids.add(stableId);
    if (!Number.isInteger(placement.floor) || frame.floorYs[placement.floor] === undefined) {
      issues.push(`${stableId}:invalid-floor`);
      continue;
    }
    if (
      ![
        placement.localX,
        placement.localZ,
        placement.width,
        placement.depth,
        placement.height,
      ].every(Number.isFinite) ||
      placement.width <= 0 ||
      placement.depth <= 0 ||
      placement.height <= 0
    ) {
      issues.push(`${stableId}:invalid-dimensions`);
      continue;
    }
    validPlacements.push(placement);
    const innerHalfWidth = frame.width * 0.5 - frame.wallThickness;
    const innerHalfDepth = frame.depth * 0.5 - frame.wallThickness;
    if (
      Math.abs(placement.localX) + placement.width * 0.5 > innerHalfWidth ||
      Math.abs(placement.localZ) + placement.depth * 0.5 > innerHalfDepth
    ) {
      issues.push(`${stableId}:outside-footprint`);
    }
    for (const reservation of frame.reservations) {
      if (overlapsReservation(placement, reservation)) {
        issues.push(`${stableId}:blocks-${reservation.id}`);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < validPlacements.length; leftIndex += 1) {
    const left = validPlacements[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < validPlacements.length; rightIndex += 1) {
      const right = validPlacements[rightIndex];
      if (
        left.buildingId !== right.buildingId ||
        left.floor !== right.floor ||
        !overlapsPlacement(left, right)
      ) continue;
      issues.push(`${left.buildingId}:${left.id}:overlaps-${right.id}`);
    }
  }
  return issues;
}

function localToWorld(frame: BuildingFrame, localX: number, localZ: number) {
  const cosine = Math.cos(frame.rotation);
  const sine = Math.sin(frame.rotation);
  return {
    x: frame.x + cosine * localX + sine * localZ,
    z: frame.z - sine * localX + cosine * localZ,
  };
}

function targetFromInteraction(
  placement: InteriorPlacement,
  root: THREE.Group,
  x: number,
  y: number,
  z: number,
  containerStates: Readonly<ContainerStates>,
): WorldTarget | null {
  const interaction = placement.interaction;
  if (!interaction) return null;
  const position = new THREE.Vector3(x, y + Math.min(1.25, placement.height), z);
  if (interaction.type === "craft") {
    return {
      id: interaction.stationId,
      kind: "station",
      action: "craft",
      name: interaction.label,
      position,
      root,
      maxDistance: 4.5,
      hitsRequired: 0,
      hits: 0,
      stationId: interaction.stationId,
      stationKind: interaction.stationKind,
    };
  }
  if (interaction.type === "rest") {
    return {
      id: interaction.site.id,
      kind: "rest",
      action: "rest",
      name: interaction.site.label,
      position,
      root,
      maxDistance: 4.5,
      hitsRequired: 0,
      hits: 0,
      restSite: interaction.site,
    };
  }
  const state = containerStates[interaction.containerId];
  return {
    id: interaction.containerId,
    kind: "container",
    action: "loot",
    name: interaction.label,
    position,
    root,
    maxDistance: 4.5,
    hitsRequired: 0,
    hits: 0,
    containerId: interaction.containerId,
    lootTableId: interaction.tableId,
    empty: Boolean(state && Object.keys(state.remaining).length === 0),
  };
}

export interface SpawnFeatureRuntime {
  root: THREE.Group;
  colliders: PlanarCollider[];
  targets: WorldTarget[];
}

export function createSpawnGameplayFeatures(
  quality: QualityLevel,
  totalMinutes: number,
  containerStates: Readonly<ContainerStates>,
): SpawnFeatureRuntime {
  const root = new THREE.Group();
  root.name = "spawn-gameplay-features:v1";
  const colliders: PlanarCollider[] = [];
  const targets: WorldTarget[] = [];
  for (const placement of INTERIOR_PLACEMENTS) {
    const frame = BUILDING_FRAMES[placement.buildingId];
    const floorY = frame.floorYs[placement.floor];
    if (floorY === undefined) continue;
    const point = localToWorld(frame, placement.localX, placement.localZ);
    const group = new THREE.Group();
    group.name = `interior:${placement.buildingId}:v1:${placement.id}`;
    group.position.set(point.x, floorY, point.z);
    group.rotation.y = frame.rotation;
    const material = new THREE.MeshStandardMaterial({
      color: placement.color,
      roughness: 0.9,
      metalness: placement.emissive ? 0.18 : 0.04,
      emissive: placement.emissive ?? 0x000000,
      emissiveIntensity: placement.emissive ? 0.65 : 0,
    });
    const prop = new THREE.Mesh(
      new THREE.BoxGeometry(placement.width, placement.height, placement.depth),
      material,
    );
    prop.position.y = placement.height * 0.5;
    prop.castShadow = qualityUsesShadows(quality);
    prop.receiveShadow = true;
    group.add(prop);
    root.add(group);
    if (placement.solid) {
      colliders.push({
        shape: "box",
        id: group.name,
        x: point.x,
        z: point.z,
        halfWidth: placement.width * 0.5,
        halfDepth: placement.depth * 0.5,
        rotation: frame.rotation,
        minY: floorY,
        maxY: floorY + placement.height,
      });
    }
    const target = targetFromInteraction(
      placement,
      group,
      point.x,
      floorY,
      point.z,
      containerStates,
    );
    if (target) targets.push(target);
  }

  const mastRoot = new THREE.Group();
  mastRoot.name = "scan-subject:field-unit-weather-mast";
  const mastX = -1.8;
  const mastZ = 3.4;
  const mastY = sampleTerrainHeight(mastX, mastZ);
  mastRoot.position.set(mastX, mastY, mastZ);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.1, 2.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x46504d, roughness: 0.72 }),
  );
  mast.position.y = 1.35;
  const sensor = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28, 0),
    new THREE.MeshStandardMaterial({ color: 0x8eb8a5, emissive: 0x274f40, emissiveIntensity: 1 }),
  );
  sensor.position.y = 2.82;
  mastRoot.add(mast, sensor);
  root.add(mastRoot);
  targets.push({
    id: "scan-subject:field-unit-weather-mast",
    kind: "scannable",
    action: "scan",
    name: "Field Unit weather mast",
    position: new THREE.Vector3(mastX, mastY + 2.2, mastZ),
    root: mastRoot,
    maxDistance: 35,
    hitsRequired: 0,
    hits: 0,
    fieldGuideId: "guide:landmark:field-unit-weather-mast:v1",
  });

  for (const npc of AUTHORED_NPCS) {
    const target = createAuthoredNpcTarget(npc, quality, totalMinutes);
    root.add(target.root);
    targets.push(target);
  }
  return { root, colliders, targets };
}
