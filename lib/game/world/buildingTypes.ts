import type * as THREE from "three";
import { MAX_STEP_HEIGHT, type QualityLevel } from "../config";
import type { PlanarCollider } from "../systems/collision";
import type { AuthoredDoorRuntime } from "./authoredDoor";

export interface BuildingReservation {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Geometry-independent metadata used by placement, navigation and streaming. */
export interface AuthoredBuildingFrame<Id extends string = string> {
  id: Id;
  definitionId: string;
  /** Optional discovery/location group; unrelated buildings stay independent. */
  landmarkId?: string;
  name: string;
  chunkKey: string;
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  wallThickness: number;
  floorYs: readonly number[];
  roofY: number;
  clearanceRadius: number;
  reservations: readonly BuildingReservation[];
}

export interface AuthoredBuildingRuntime {
  root: THREE.Group;
  colliders: PlanarCollider[];
  doors: AuthoredDoorRuntime[];
}

export interface BuildingCreateContext {
  quality: QualityLevel;
  isDoorOpen(id: string): boolean;
}

export interface AuthoredBuildingRecipe<Id extends string = string> {
  frame: AuthoredBuildingFrame<Id>;
  doorIds: readonly string[];
  create(context: Readonly<BuildingCreateContext>): AuthoredBuildingRuntime;
  supportCandidates(x: number, z: number): readonly number[];
}

export interface BuildingAnchor {
  buildingId: string;
  floor: number;
  localX: number;
  localZ: number;
  localYOffset?: number;
  localYaw?: number;
}

export interface ResolvedBuildingAnchor {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function selectWalkableSupport(
  supports: readonly number[],
  referenceY?: number,
) {
  if (supports.length === 0) return null;
  const ordered = [...supports].sort((left, right) => left - right);
  if (referenceY === undefined || !Number.isFinite(referenceY)) return ordered[0];
  const reachable = ordered.filter((height) => height <= referenceY + MAX_STEP_HEIGHT);
  return reachable.at(-1) ?? ordered[0];
}
