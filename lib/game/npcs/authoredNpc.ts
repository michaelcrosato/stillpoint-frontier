import * as THREE from "three";
import type { QualityLevel } from "../config";
import type { WorldTarget } from "../world/ChunkManager";
import { SPAWN_BUILDING } from "../world/spawnBuilding";
import { TWO_STORY_BUILDING } from "../world/twoStoryBuilding";

export interface NpcDialogueTopic {
  id: string;
  label: string;
  text: string;
}

export interface AuthoredNpcDefinition {
  id: string;
  name: string;
  role: string;
  introduction: string;
  topics: readonly NpcDialogueTopic[];
}

export const AUTHORED_NPCS = [
  {
    id: "npc:mara-venn:v1",
    name: "Mara Venn",
    role: "Field Coordinator",
    introduction: "You made it through the grid handshake. I keep assignments small until a surveyor proves the equipment—and their judgment—works outside a briefing room.",
    topics: [
      {
        id: "territory",
        label: "The territory",
        text: "Water explains the villages, ore explains Ironvale, and trade explains Vesper Crown. If a settlement seems misplaced, follow the road behind it.",
      },
      {
        id: "citizens",
        label: "Ambient citizens",
        text: "Most people you see are commuters, crews and market traffic. They are part of the place, not part of your assignment. Look for named field personnel when you need a response.",
      },
      {
        id: "fieldwork",
        label: "Field procedure",
        text: "Read the local record, gather only what you need, log unfamiliar subjects, and establish shelter before weather or distance makes the decision for you.",
      },
    ],
  },
] as const satisfies readonly AuthoredNpcDefinition[];

export type NpcId = (typeof AUTHORED_NPCS)[number]["id"];

export function npcById(id: string) {
  return AUTHORED_NPCS.find((npc) => npc.id === id) ?? null;
}

export interface NpcScheduleAnchor {
  id: "field-desk" | "survey-quarters";
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function localToWorld(
  building: Readonly<{ x: number; z: number; rotation: number }>,
  localX: number,
  localZ: number,
) {
  const cosine = Math.cos(building.rotation);
  const sine = Math.sin(building.rotation);
  return {
    x: building.x + cosine * localX + sine * localZ,
    z: building.z - sine * localX + cosine * localZ,
  };
}

/**
 * A deterministic schedule derived from the world clock. Anchors use authored
 * floor elevations, never sampled terrain, so Mara cannot sink through an
 * interior when the terrain recipe changes.
 */
export function authoredNpcScheduleAnchor(totalMinutes: number): NpcScheduleAnchor {
  const safeMinutes = Number.isFinite(totalMinutes) ? totalMinutes : 0;
  const minuteOfDay = ((safeMinutes % 1_440) + 1_440) % 1_440;
  if (minuteOfDay >= 6 * 60 && minuteOfDay < 22 * 60) {
    const point = localToWorld(
      { x: SPAWN_BUILDING.x, z: SPAWN_BUILDING.z, rotation: 0 },
      -2.45,
      -2.28,
    );
    return {
      id: "field-desk",
      x: point.x,
      y: SPAWN_BUILDING.floorY,
      z: point.z,
      // Face the public side of the operations desk.
      yaw: 0,
    };
  }
  const point = localToWorld(TWO_STORY_BUILDING, -1.35, 1.15);
  return {
    id: "survey-quarters",
    x: point.x,
    y: TWO_STORY_BUILDING.upperFloorY,
    z: point.z,
    yaw: TWO_STORY_BUILDING.rotation,
  };
}

function bodyPart(
  geometry: THREE.BufferGeometry,
  color: number,
  quality: QualityLevel,
) {
  const part = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true }),
  );
  part.castShadow = quality === "cinematic";
  part.receiveShadow = true;
  return part;
}

export function createAuthoredNpcTarget(
  definition: Readonly<AuthoredNpcDefinition>,
  quality: QualityLevel,
  totalMinutes: number,
): WorldTarget {
  const root = new THREE.Group();
  root.name = definition.id;
  const torso = bodyPart(new THREE.BoxGeometry(0.58, 0.82, 0.34), 0x4f625b, quality);
  torso.position.y = 1.18;
  const head = bodyPart(new THREE.DodecahedronGeometry(0.24, 0), 0xb49378, quality);
  head.position.y = 1.83;
  const coat = bodyPart(new THREE.BoxGeometry(0.7, 0.42, 0.4), 0x303a38, quality);
  coat.position.y = 0.7;
  const leftLeg = bodyPart(new THREE.BoxGeometry(0.18, 0.7, 0.2), 0x282e2d, quality);
  leftLeg.position.set(-0.17, 0.35, 0);
  const rightLeg = leftLeg.clone();
  rightLeg.material = leftLeg.material;
  rightLeg.position.x = 0.17;
  root.add(torso, head, coat, leftLeg, rightLeg);
  const target: WorldTarget = {
    id: definition.id,
    kind: "npc",
    action: "talk",
    name: definition.name,
    position: new THREE.Vector3(),
    root,
    maxDistance: 4.8,
    hitsRequired: 0,
    hits: 0,
    npcId: definition.id,
  };
  updateAuthoredNpcTarget(target, totalMinutes);
  return target;
}

export function updateAuthoredNpcTarget(target: WorldTarget, totalMinutes: number) {
  if (!target.npcId) return;
  const anchor = authoredNpcScheduleAnchor(totalMinutes);
  target.root.position.set(anchor.x, anchor.y, anchor.z);
  target.root.rotation.y = anchor.yaw;
  target.root.userData.scheduleAnchor = anchor.id;
  target.position.set(anchor.x, anchor.y + 1.35, anchor.z);
}

export function npcGreeting(totalMinutes: number) {
  const hour = Math.floor((((totalMinutes % 1_440) + 1_440) % 1_440) / 60);
  if (hour < 6) return "You are keeping difficult hours. Make the darkness useful.";
  if (hour < 12) return "Morning. The instruments have already logged the first weather shift.";
  if (hour < 18) return "The afternoon wind is up. Keep an eye on visibility before leaving the basin.";
  return "Evening. File what you have before the night crews rotate through.";
}
