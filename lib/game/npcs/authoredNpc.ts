import type { QualityLevel } from "../config";
import type { WorldTarget } from "../world/targets";
import type {
  NpcAppearance,
  NpcDefinition,
  NpcDialogueTopic,
  NpcGreeting,
  NpcScheduleEntry,
} from "./model";
import {
  createAuthoredNpcTarget as createNpcPresentation,
  updateAuthoredNpcTarget,
} from "./presentation";
import { AUTHORED_NPCS, npcById } from "./stillpointNpcs";

/**
 * Backward-compatible authored shape. The optional fields are the modular
 * schedule/presentation additions; older definitions inherit initial defaults.
 */
export interface AuthoredNpcDefinition {
  id: string;
  name: string;
  role: string;
  introduction: string;
  topics: readonly NpcDialogueTopic[];
  greetings?: readonly NpcGreeting[];
  schedule?: readonly NpcScheduleEntry[];
  appearance?: NpcAppearance;
  residentChunkKey?: string;
}

function completeDefinition(
  definition: Readonly<AuthoredNpcDefinition>,
): NpcDefinition {
  const known = npcById(definition.id);
  const defaults = known ?? AUTHORED_NPCS[0];
  return {
    id: definition.id,
    name: definition.name,
    role: definition.role,
    introduction: definition.introduction,
    topics: definition.topics,
    greetings: definition.greetings ?? defaults.greetings,
    schedule: definition.schedule ?? defaults.schedule,
    appearance: definition.appearance ?? defaults.appearance,
    residentChunkKey:
      definition.residentChunkKey ?? defaults.residentChunkKey,
  };
}

export function createAuthoredNpcTarget(
  definition: Readonly<AuthoredNpcDefinition>,
  quality: QualityLevel,
  totalMinutes: number,
): WorldTarget {
  return createNpcPresentation(
    completeDefinition(definition),
    quality,
    totalMinutes,
  );
}

export { updateAuthoredNpcTarget };

/** Transitional public barrel: data/model/presentation now have separate ports. */
export type {
  NpcAnchorReference,
  NpcAppearance,
  NpcDefinition,
  NpcDialogueTopic,
  NpcGreeting,
  NpcPose,
  NpcScheduleEntry,
} from "./model";
export {
  minuteOfDay,
  npcDefinitionIssues,
  npcGreetingAt,
  npcScheduleEntryAt,
} from "./model";
export {
  AUTHORED_NPCS,
  authoredNpcDefinitionIssues,
  authoredNpcScheduleAnchor,
  npcById,
  npcGreeting,
  npcPoseAt,
  npcPoseForDefinition,
  type NpcId,
  type NpcScheduleAnchor,
} from "./stillpointNpcs";
