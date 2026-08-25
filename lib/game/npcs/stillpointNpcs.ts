import { resolveBuildingAnchor } from "../world/authoredBuildings";
import {
  npcDefinitionIssues,
  npcGreetingAt,
  npcScheduleEntryAt,
  type NpcDefinition,
  type NpcPose,
} from "./model";

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
    greetings: [
      {
        id: "late-watch",
        startMinute: 0,
        endMinute: 360,
        text: "You are keeping difficult hours. Make the darkness useful.",
      },
      {
        id: "morning",
        startMinute: 360,
        endMinute: 720,
        text: "Morning. The instruments have already logged the first weather shift.",
      },
      {
        id: "afternoon",
        startMinute: 720,
        endMinute: 1_080,
        text: "The afternoon wind is up. Keep an eye on visibility before leaving the basin.",
      },
      {
        id: "evening",
        startMinute: 1_080,
        endMinute: 0,
        text: "Evening. File what you have before the night crews rotate through.",
      },
    ],
    schedule: [
      {
        id: "field-desk",
        startMinute: 360,
        endMinute: 1_320,
        anchor: {
          kind: "building",
          buildingId: "field-unit",
          floor: 0,
          localX: -2.45,
          localZ: -2.28,
          localYaw: 0,
        },
      },
      {
        id: "survey-quarters",
        startMinute: 1_320,
        endMinute: 360,
        anchor: {
          kind: "building",
          buildingId: "survey-house",
          floor: 1,
          localX: -1.35,
          localZ: 1.15,
          localYaw: 0,
        },
      },
    ],
    appearance: {
      presenter: "rigid-humanoid-v1",
      torso: 0x4f625b,
      head: 0xb49378,
      coat: 0x303a38,
      legs: 0x282e2d,
    },
    residentChunkKey: "0:0",
  },
] as const satisfies readonly NpcDefinition[];

export type NpcId = (typeof AUTHORED_NPCS)[number]["id"];

export function npcById(id: string): NpcDefinition | null {
  return AUTHORED_NPCS.find((npc) => npc.id === id) ?? null;
}

export function authoredNpcDefinitionIssues(
  definitions: readonly NpcDefinition[] = AUTHORED_NPCS,
) {
  return npcDefinitionIssues(definitions, {
    isAnchorResolvable: (anchor) =>
      anchor.kind === "world" || resolveBuildingAnchor(anchor) !== null,
  });
}

export function npcPoseForDefinition(
  definition: Readonly<NpcDefinition>,
  totalMinutes: number,
): NpcPose | null {
  const schedule = npcScheduleEntryAt(definition.schedule, totalMinutes);
  if (!schedule) return null;
  if (schedule.anchor.kind === "world") {
    const { x, y, z, yaw } = schedule.anchor;
    if (![x, y, z, yaw].every(Number.isFinite)) return null;
    return { scheduleEntryId: schedule.id, x, y, z, yaw };
  }
  const anchor = resolveBuildingAnchor(schedule.anchor);
  return anchor ? { scheduleEntryId: schedule.id, ...anchor } : null;
}

export function npcPoseAt(id: string, totalMinutes: number): NpcPose | null {
  const definition = npcById(id);
  return definition ? npcPoseForDefinition(definition, totalMinutes) : null;
}

export interface NpcScheduleAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Compatibility wrapper for callers that still address the initial NPC. */
export function authoredNpcScheduleAnchor(totalMinutes: number): NpcScheduleAnchor {
  const pose = npcPoseAt(AUTHORED_NPCS[0].id, totalMinutes);
  if (!pose) return { id: "unresolved", x: 0, y: 0, z: 0, yaw: 0 };
  return {
    id: pose.scheduleEntryId,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    yaw: pose.yaw,
  };
}

export function npcGreeting(
  totalMinutes: number,
  npcId: string = AUTHORED_NPCS[0].id,
) {
  const npc = npcById(npcId);
  return npc ? npcGreetingAt(npc.greetings, totalMinutes) : "";
}
