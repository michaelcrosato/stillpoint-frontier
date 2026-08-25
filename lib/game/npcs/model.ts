export interface NpcDialogueTopic {
  id: string;
  label: string;
  text: string;
}

export type NpcAnchorReference =
  | {
      kind: "building";
      buildingId: string;
      floor: number;
      localX: number;
      localZ: number;
      localYOffset?: number;
      localYaw?: number;
    }
  | {
      kind: "world";
      x: number;
      y: number;
      z: number;
      yaw: number;
    };

export interface NpcScheduleEntry {
  id: string;
  startMinute: number;
  endMinute: number;
  anchor: NpcAnchorReference;
}

export interface NpcGreeting {
  id: string;
  startMinute: number;
  endMinute: number;
  text: string;
}

export interface NpcAppearance {
  presenter: "rigid-humanoid-v1";
  torso: number;
  head: number;
  coat: number;
  legs: number;
}

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  introduction: string;
  topics: readonly NpcDialogueTopic[];
  greetings: readonly NpcGreeting[];
  schedule: readonly NpcScheduleEntry[];
  appearance: NpcAppearance;
  residentChunkKey: string;
}

export interface NpcPose {
  scheduleEntryId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface NpcDefinitionValidationOptions {
  /** World/catalog adapter used to verify structurally valid anchors. */
  isAnchorResolvable?(anchor: Readonly<NpcAnchorReference>): boolean;
}

export function minuteOfDay(totalMinutes: number) {
  const safeMinutes = Number.isFinite(totalMinutes) ? totalMinutes : 0;
  return ((safeMinutes % 1_440) + 1_440) % 1_440;
}

function intervalContains(minute: number, start: number, end: number) {
  if (start === end) return true;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

export function npcScheduleEntryAt(
  schedule: readonly NpcScheduleEntry[],
  totalMinutes: number,
) {
  const minute = minuteOfDay(totalMinutes);
  return (
    schedule.find((entry) =>
      intervalContains(minute, entry.startMinute, entry.endMinute),
    ) ?? null
  );
}

export function npcGreetingAt(
  greetings: readonly NpcGreeting[],
  totalMinutes: number,
) {
  const minute = minuteOfDay(totalMinutes);
  return (
    greetings.find((entry) =>
      intervalContains(minute, entry.startMinute, entry.endMinute),
    )?.text ?? ""
  );
}

const validMinute = (value: number) =>
  Number.isFinite(value) && value >= 0 && value < 1_440;

function anchorIsStructurallyValid(anchor: Readonly<NpcAnchorReference>) {
  if (anchor.kind === "world") {
    return [anchor.x, anchor.y, anchor.z, anchor.yaw].every(Number.isFinite);
  }
  return (
    anchor.buildingId.trim().length > 0 &&
    Number.isInteger(anchor.floor) &&
    anchor.floor >= 0 &&
    [
      anchor.localX,
      anchor.localZ,
      anchor.localYOffset ?? 0,
      anchor.localYaw ?? 0,
    ].every(Number.isFinite)
  );
}

/** Pure catalogue checks keep authored data failures out of runtime systems. */
export function npcDefinitionIssues(
  definitions: readonly NpcDefinition[],
  options: Readonly<NpcDefinitionValidationOptions> = {},
) {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) issues.push(`${definition.id}:duplicate-id`);
    ids.add(definition.id);
    const topicIds = new Set<string>();
    for (const topic of definition.topics) {
      if (topicIds.has(topic.id)) {
        issues.push(`${definition.id}:${topic.id}:duplicate-topic`);
      }
      topicIds.add(topic.id);
    }
    const scheduleIds = new Set<string>();
    for (const entry of definition.schedule) {
      if (scheduleIds.has(entry.id)) {
        issues.push(`${definition.id}:${entry.id}:duplicate-schedule-entry`);
      }
      scheduleIds.add(entry.id);
      if (
        !validMinute(entry.startMinute) ||
        !validMinute(entry.endMinute)
      ) {
        issues.push(`${definition.id}:${entry.id}:invalid-schedule`);
      }
      const structurallyValid = anchorIsStructurallyValid(entry.anchor);
      if (!structurallyValid) {
        issues.push(`${definition.id}:${entry.id}:invalid-anchor`);
      } else if (options.isAnchorResolvable) {
        let resolvable = false;
        try {
          resolvable = options.isAnchorResolvable(entry.anchor);
        } catch {
          resolvable = false;
        }
        if (!resolvable) {
          issues.push(`${definition.id}:${entry.id}:unresolvable-anchor`);
        }
      }
    }
    const greetingIds = new Set<string>();
    for (const greeting of definition.greetings) {
      if (greetingIds.has(greeting.id)) {
        issues.push(`${definition.id}:${greeting.id}:duplicate-greeting`);
      }
      greetingIds.add(greeting.id);
      if (
        !validMinute(greeting.startMinute) ||
        !validMinute(greeting.endMinute) ||
        greeting.text.trim().length === 0
      ) {
        issues.push(`${definition.id}:${greeting.id}:invalid-greeting`);
      }
    }
    for (let minute = 0; minute < 1_440; minute += 1) {
      const matches = definition.schedule.filter((entry) =>
        intervalContains(minute, entry.startMinute, entry.endMinute),
      ).length;
      if (matches !== 1) {
        issues.push(`${definition.id}:schedule-coverage:${minute}`);
        break;
      }
    }
    for (let minute = 0; minute < 1_440; minute += 1) {
      const matches = definition.greetings.filter((entry) =>
        intervalContains(minute, entry.startMinute, entry.endMinute),
      ).length;
      if (matches !== 1) {
        issues.push(`${definition.id}:greeting-coverage:${minute}`);
        break;
      }
    }
  }
  return issues;
}
