import { ANIMAL_SPECIES } from "../animals/animalRecipes";
import { BEACONS } from "../config";

export type FieldGuideCategory = "fauna" | "flora" | "resource" | "landmark";

export interface FieldGuideEntry {
  id: string;
  category: FieldGuideCategory;
  title: string;
  summary: string;
}

const FAUNA_ENTRIES: FieldGuideEntry[] = Object.values(ANIMAL_SPECIES).map((species) => ({
  id: `guide:animal:${species.id}:v1`,
  category: "fauna",
  title: species.label,
  summary: species.flying
    ? "A regional flying species tracked through rigid silhouette and habitat records."
    : "A regional ground species whose range follows climate, water and settlement pressure.",
}));

const FLORA_ENTRIES: FieldGuideEntry[] = [
  ["meadow-grass", "Grey meadow grass", "Hardy grassland cover that stabilizes the basin soil."],
  ["sable-fern", "Sablewood fern", "Dense shade flora adapted to the western forest floor."],
  ["river-reed", "Greywater reed", "Wetland cover concentrated near the river and estuary."],
  ["steppe-sage", "Warden sage", "Low aromatic scrub adapted to dry wind and shallow soil."],
  ["badland-succulent", "Glassland succulent", "Water-storing flora rooted in fractured mineral soil."],
  ["coast-dunegrass", "Salt dunegrass", "Salt-tolerant grass that binds exposed coastal sand."],
  ["crown-heather", "Crown heather", "Compact highland vegetation resistant to frost and wind."],
].map(([slug, title, summary]) => ({
  id: `guide:flora:${slug}:v1`,
  category: "flora" as const,
  title,
  summary,
}));

const RESOURCE_ENTRIES: FieldGuideEntry[] = [
  ["stone", "Structural stone", "Common aggregate and masonry material."],
  ["wood", "Workable timber", "Renewable structural material gathered from woody vegetation."],
  ["fiber", "Plant fiber", "Flexible field material used for fabric and cordage."],
  ["ore", "Mineral-bearing ore", "Unrefined rock containing useful metallic compounds."],
  ["relic", "Old-world salvage", "Recoverable machinery and pre-migration components."],
].map(([slug, title, summary]) => ({
  id: `guide:resource:${slug}:v1`,
  category: "resource" as const,
  title,
  summary,
}));

const LANDMARK_ENTRIES: FieldGuideEntry[] = [
  {
    id: "guide:landmark:field-unit-weather-mast:v1",
    category: "landmark",
    title: "Field Unit weather mast",
    summary: "A calibrated compound instrument used as the scanner baseline.",
  },
  ...BEACONS.map((beacon) => ({
    id: `guide:landmark:${beacon.id}:v1`,
    category: "landmark" as const,
    title: beacon.name,
    summary: beacon.note,
  })),
];

export const FIELD_GUIDE_ENTRIES: readonly FieldGuideEntry[] = Object.freeze([
  ...FAUNA_ENTRIES,
  ...FLORA_ENTRIES,
  ...RESOURCE_ENTRIES,
  ...LANDMARK_ENTRIES,
]);

const KNOWN_ENTRY_IDS = new Set(FIELD_GUIDE_ENTRIES.map((entry) => entry.id));

export function isKnownFieldGuideEntry(id: unknown): id is string {
  return typeof id === "string" && KNOWN_ENTRY_IDS.has(id);
}

export function fieldGuideEntry(id: string) {
  return FIELD_GUIDE_ENTRIES.find((entry) => entry.id === id) ?? null;
}

export function addFieldGuideEntry(entries: readonly string[], entryId: string) {
  if (!isKnownFieldGuideEntry(entryId) || entries.includes(entryId)) return [...entries];
  return [...entries, entryId].sort();
}

export function normalizeFieldGuideEntries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter(isKnownFieldGuideEntry)
    .slice(0, FIELD_GUIDE_ENTRIES.length)
    .sort();
}

export interface ScanCandidate {
  id: string;
  entryId: string;
  name: string;
  position: { x: number; y: number; z: number };
  maxDistance: number;
}

export function selectScanCandidate(
  candidates: readonly ScanCandidate[],
  origin: Readonly<{ x: number; y: number; z: number }>,
  forward: Readonly<{ x: number; y: number; z: number }>,
  isCandidateVisible: (candidate: Readonly<ScanCandidate>) => boolean = () => true,
) {
  let best: { candidate: ScanCandidate; distance: number; alignment: number } | null = null;
  for (const candidate of candidates) {
    if (!isKnownFieldGuideEntry(candidate.entryId)) continue;
    const dx = candidate.position.x - origin.x;
    const dy = candidate.position.y - origin.y;
    const dz = candidate.position.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(distance) || distance <= 0 || distance > candidate.maxDistance) continue;
    const alignment = (forward.x * dx + forward.y * dy + forward.z * dz) / distance;
    if (alignment < 0.9) continue;
    if (!isCandidateVisible(candidate)) continue;
    const score = distance + (1 - alignment) * 32;
    if (best && score >= best.distance + (1 - best.alignment) * 32) continue;
    best = { candidate, distance, alignment };
  }
  return best;
}
