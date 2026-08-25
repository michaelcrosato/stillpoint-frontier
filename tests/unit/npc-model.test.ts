import { describe, expect, it } from "vitest";
import {
  minuteOfDay,
  npcDefinitionIssues,
  npcScheduleEntryAt,
  type NpcScheduleEntry,
} from "../../lib/game/npcs/model";
import {
  AUTHORED_NPCS,
  authoredNpcDefinitionIssues,
  npcPoseAt,
} from "../../lib/game/npcs/stillpointNpcs";

describe("named NPC model", () => {
  it("validates the catalogue and resolves wraparound schedules", () => {
    expect(npcDefinitionIssues(AUTHORED_NPCS)).toEqual([]);
    expect(authoredNpcDefinitionIssues()).toEqual([]);
    expect(npcPoseAt(AUTHORED_NPCS[0].id, 6 * 60)?.scheduleEntryId)
      .toBe("field-desk");
    expect(npcPoseAt(AUTHORED_NPCS[0].id, 22 * 60)?.scheduleEntryId)
      .toBe("survey-quarters");
    expect(npcPoseAt(AUTHORED_NPCS[0].id, -60)?.scheduleEntryId)
      .toBe("survey-quarters");
    expect(npcPoseAt("missing", 0)).toBeNull();
  });

  it("supports reusable world schedules independently of presentation", () => {
    const schedule: NpcScheduleEntry[] = [
      {
        id: "day",
        startMinute: 360,
        endMinute: 1_320,
        anchor: { kind: "world", x: 1, y: 2, z: 3, yaw: 0 },
      },
      {
        id: "night",
        startMinute: 1_320,
        endMinute: 360,
        anchor: { kind: "world", x: 4, y: 5, z: 6, yaw: 1 },
      },
    ];
    expect(npcScheduleEntryAt(schedule, 500)?.id).toBe("day");
    expect(npcScheduleEntryAt(schedule, 30)?.id).toBe("night");
    expect(npcScheduleEntryAt(schedule, Number.NaN)?.id).toBe("night");
    expect(minuteOfDay(-1)).toBe(1_439);
  });

  it("detects duplicate catalogue and incomplete schedule data", () => {
    const broken = {
      ...AUTHORED_NPCS[0],
      topics: [AUTHORED_NPCS[0].topics[0], AUTHORED_NPCS[0].topics[0]],
      schedule: [AUTHORED_NPCS[0].schedule[0]],
    };
    const issues = npcDefinitionIssues([broken, broken]);
    expect(issues).toContain(`${broken.id}:duplicate-id`);
    expect(issues.some((issue) => issue.includes("duplicate-topic"))).toBe(true);
    expect(issues.some((issue) => issue.includes("schedule-coverage"))).toBe(true);
  });

  it("rejects malformed and unresolved schedule and greeting authoring", () => {
    const exemplar = AUTHORED_NPCS[0];
    const broken = {
      ...exemplar,
      schedule: [
        {
          ...exemplar.schedule[0],
          anchor: {
            ...exemplar.schedule[0].anchor,
            buildingId: "missing-building",
            floor: 99,
          },
        },
        { ...exemplar.schedule[0] },
      ],
      greetings: [
        exemplar.greetings[0],
        { ...exemplar.greetings[0], text: "" },
      ],
    };
    const structuralIssues = npcDefinitionIssues([broken]);
    expect(structuralIssues).toEqual(expect.arrayContaining([
      `${broken.id}:field-desk:duplicate-schedule-entry`,
      `${broken.id}:late-watch:duplicate-greeting`,
      `${broken.id}:late-watch:invalid-greeting`,
    ]));
    expect(authoredNpcDefinitionIssues([broken])).toContain(
      `${broken.id}:field-desk:unresolvable-anchor`,
    );

    const invalidWorldAnchor = {
      ...exemplar,
      schedule: exemplar.schedule.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              anchor: { kind: "world" as const, x: Number.NaN, y: 0, z: 0, yaw: 0 },
            }
          : entry,
      ),
    };
    expect(npcDefinitionIssues([invalidWorldAnchor])).toContain(
      `${exemplar.id}:field-desk:invalid-anchor`,
    );
  });
});
