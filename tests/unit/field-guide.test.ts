import { describe, expect, it } from "vitest";
import { ANIMAL_SPECIES } from "../../lib/game/animals/animalRecipes";
import { BEACONS } from "../../lib/game/config";
import {
  FIELD_GUIDE_ENTRIES,
  addFieldGuideEntry,
  fieldGuideEntry,
  isKnownFieldGuideEntry,
  normalizeFieldGuideEntries,
  selectScanCandidate,
} from "../../lib/game/gameplay/fieldGuide";

const MAST = "guide:landmark:field-unit-weather-mast:v1";
const FIBER = "guide:resource:fiber:v1";

describe("field guide and scanner selection", () => {
  it("publishes a unique complete catalog for fauna and authored beacons", () => {
    expect(new Set(FIELD_GUIDE_ENTRIES.map((entry) => entry.id)).size)
      .toBe(FIELD_GUIDE_ENTRIES.length);
    expect(FIELD_GUIDE_ENTRIES.every((entry) => entry.title && entry.summary)).toBe(true);
    for (const speciesId of Object.keys(ANIMAL_SPECIES)) {
      expect(isKnownFieldGuideEntry(`guide:animal:${speciesId}:v1`)).toBe(true);
    }
    for (const beacon of BEACONS) {
      expect(fieldGuideEntry(`guide:landmark:${beacon.id}:v1`)?.title).toBe(beacon.name);
    }
    expect(fieldGuideEntry("guide:invented")).toBeNull();
  });

  it("adds known entries once and normalizes corrupt persisted IDs", () => {
    const first = addFieldGuideEntry([], MAST);
    const duplicate = addFieldGuideEntry(first, MAST);
    expect(first).toEqual([MAST]);
    expect(duplicate).toEqual(first);
    expect(duplicate).not.toBe(first);
    expect(addFieldGuideEntry(first, "guide:invented")).toEqual(first);
    expect(normalizeFieldGuideEntries([
      FIBER,
      MAST,
      FIBER,
      "guide:invented",
      42,
    ])).toEqual([MAST, FIBER].sort());
    expect(normalizeFieldGuideEntries("corrupt")).toEqual([]);
  });

  it("selects only a known, in-range subject inside the scanner cone", () => {
    const selected = selectScanCandidate([
      {
        id: "unknown-near",
        entryId: "guide:invented",
        name: "Invented",
        position: { x: 0, y: 1.6, z: -1 },
        maxDistance: 20,
      },
      {
        id: "known-off-axis",
        entryId: FIBER,
        name: "Fiber",
        position: { x: 4, y: 1.6, z: -1 },
        maxDistance: 20,
      },
      {
        id: "known-too-far",
        entryId: FIBER,
        name: "Fiber",
        position: { x: 0, y: 1.6, z: -30 },
        maxDistance: 12,
      },
      {
        id: "weather-mast",
        entryId: MAST,
        name: "Weather mast",
        position: { x: 0, y: 1.6, z: -8 },
        maxDistance: 20,
      },
    ], { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(selected?.candidate.id).toBe("weather-mast");
    expect(selected?.distance).toBeCloseTo(8);
    expect(selected?.alignment).toBeCloseTo(1);
  });

  it("uses deterministic distance/alignment scoring and retains source order on ties", () => {
    const candidates = [
      {
        id: "first",
        entryId: MAST,
        name: "First",
        position: { x: 0, y: 0, z: -5 },
        maxDistance: 20,
      },
      {
        id: "tie",
        entryId: FIBER,
        name: "Tie",
        position: { x: 0, y: 0, z: -5 },
        maxDistance: 20,
      },
    ];
    expect(selectScanCandidate(
      candidates,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
    )?.candidate.id).toBe("first");
    expect(selectScanCandidate(
      candidates,
      { x: 0, y: 0, z: -5 },
      { x: 0, y: 0, z: -1 },
    )).toBeNull();
  });

  it("skips occluded subjects before applying deterministic scoring", () => {
    const candidates = [
      {
        id: "blocked-near",
        entryId: MAST,
        name: "Blocked near subject",
        position: { x: 0, y: 1.6, z: -4 },
        maxDistance: 20,
      },
      {
        id: "visible-far",
        entryId: FIBER,
        name: "Visible far subject",
        position: { x: 0, y: 1.6, z: -8 },
        maxDistance: 20,
      },
    ];
    expect(selectScanCandidate(
      candidates,
      { x: 0, y: 1.6, z: 0 },
      { x: 0, y: 0, z: -1 },
      (candidate) => candidate.id !== "blocked-near",
    )?.candidate.id).toBe("visible-far");
  });
});
