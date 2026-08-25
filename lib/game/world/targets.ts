import type * as THREE from "three";
import type { BeaconId } from "../config";
import type { CraftingStationKind } from "../gameplay/crafting";
import type { ItemId } from "../gameplay/items";
import type { LootTableId } from "../gameplay/loot";
import type { RestSiteDefinition } from "../gameplay/resting";
import type { InspectionRecord } from "./inspectables";

export type WorldTargetKind =
  | "beacon"
  | "pickup"
  | "resource"
  | "door"
  | "inspectable"
  | "station"
  | "container"
  | "rest"
  | "npc"
  | "scannable"
  | "animal";

export type WorldTargetAction =
  | "scan"
  | "collect"
  | "harvest"
  | "toggle"
  | "inspect"
  | "craft"
  | "loot"
  | "rest"
  | "talk";

export interface InstancedTargetVisual {
  mesh: THREE.InstancedMesh;
  index: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  groundY: number;
}

/** Stable interaction contract shared by streaming, NPC and gameplay systems. */
export interface WorldTarget {
  id: string;
  kind: WorldTargetKind;
  action: WorldTargetAction;
  name: string;
  position: THREE.Vector3;
  root: THREE.Group;
  maxDistance: number;
  interactionRadius?: number;
  hitsRequired: number;
  hits: number;
  instanceVisuals?: readonly InstancedTargetVisual[];
  item?: ItemId;
  yieldAmount?: number;
  beaconId?: BeaconId;
  code?: string;
  note?: string;
  doorId?: string;
  open?: boolean;
  inspection?: InspectionRecord;
  fieldGuideId?: string;
  stationId?: string;
  stationKind?: CraftingStationKind;
  containerId?: string;
  lootTableId?: LootTableId;
  empty?: boolean;
  restSite?: RestSiteDefinition;
  npcId?: string;
}

export interface WorldLineOfSightOptions {
  ignoredColliderIds?: readonly string[];
  maxVerticalDelta?: number;
  checkTerrain?: boolean;
  requireSameSupport?: boolean;
  supportTolerance?: number;
}
