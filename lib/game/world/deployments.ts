import * as THREE from "three";
import {
  qualityUsesHighDetail,
  qualityUsesShadows,
  type QualityLevel,
} from "../config";
import type { RestSiteDefinition } from "../gameplay/resting";
import type { PlanarCollider } from "../systems/collision";
import type { WorldTarget } from "./ChunkManager";
import { WORLD_HALF_EXTENT } from "./macroWorld";

export type PlacementArchetype =
  | "bedroll"
  | "campfire"
  | "survey_marker"
  | "weather_shelter"
  | "field_torch";

export interface PlacedEntity {
  id: string;
  archetypeId: PlacementArchetype;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PlacedRuntime {
  root: THREE.Group;
  targets: WorldTarget[];
  colliders: PlanarCollider[];
  lights: PlacedLightRuntime[];
}

export interface PlacedLightRuntime {
  light: THREE.PointLight;
  x: number;
  z: number;
  baseIntensity: number;
}

/**
 * Real-time lights are intentionally capped independently from the persistent
 * placement cap. Every torch keeps its emissive marker, while only the nearest
 * lights participate in the renderer's light list.
 */
export const FIELD_TORCH_LIGHT_CAP: Readonly<Record<QualityLevel, number>> = {
  ultra: 12,
  cinematic: 12,
  performance: 6,
};

export const FIELD_TORCH_LIGHT_RANGE: Readonly<Record<QualityLevel, number>> = {
  ultra: 15,
  cinematic: 15,
  performance: 11,
};

const FIELD_TORCH_BASE_INTENSITY = 72;
const CAMP_VERTICAL_MINIMUM = -0.8;
const CAMP_VERTICAL_MAXIMUM = 2.2;

export const MAX_PLACED_SERIAL = 999_999;
const PLACED_ID = /^placed:(?:bedroll|campfire|survey_marker|weather_shelter|field_torch):[0-9]{1,6}$/;
const ARCHETYPES = new Set<PlacementArchetype>([
  "bedroll",
  "campfire",
  "survey_marker",
  "weather_shelter",
  "field_torch",
]);

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  quality: QualityLevel,
) {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = qualityUsesShadows(quality);
  result.receiveShadow = true;
  return result;
}

function restTarget(
  record: Readonly<PlacedEntity>,
  root: THREE.Group,
  label: string,
  site: RestSiteDefinition,
): WorldTarget {
  return {
    id: `${record.id}:rest`,
    kind: "rest",
    action: "rest",
    name: label,
    position: new THREE.Vector3(record.x, record.y + 0.75, record.z),
    root,
    maxDistance: 4.5,
    hitsRequired: 0,
    hits: 0,
    restSite: site,
  };
}

export function createPlacedRuntime(
  records: readonly PlacedEntity[],
  quality: QualityLevel,
): PlacedRuntime {
  const root = new THREE.Group();
  root.name = "player-placed-entities";
  const targets: WorldTarget[] = [];
  const colliders: PlanarCollider[] = [];
  const lights: PlacedLightRuntime[] = [];
  for (const record of records) {
    const group = new THREE.Group();
    group.name = record.id;
    group.position.set(record.x, record.y, record.z);
    group.rotation.y = record.yaw;
    if (record.archetypeId === "bedroll") {
      const bed = mesh(
        new THREE.BoxGeometry(1.7, 0.13, 0.72),
        new THREE.MeshStandardMaterial({ color: 0x566a5c, roughness: 0.96 }),
        quality,
      );
      bed.position.y = 0.08;
      group.add(bed);
      targets.push(restTarget(record, group, "Survey bedroll", {
        id: `${record.id}:rest`,
        label: "Survey bedroll",
        safe: false,
        sheltered: false,
        warmth: 0,
      }));
    } else if (record.archetypeId === "campfire") {
      const ring = mesh(
        new THREE.CylinderGeometry(0.48, 0.58, 0.18, 8),
        new THREE.MeshStandardMaterial({ color: 0x4b4337, roughness: 1 }),
        quality,
      );
      ring.position.y = 0.1;
      const ember = mesh(
        new THREE.ConeGeometry(0.28, 0.7, 6),
        new THREE.MeshStandardMaterial({
          color: 0xd07a35,
          emissive: 0xe25f24,
          emissiveIntensity: 1.5,
          roughness: 0.7,
        }),
        quality,
      );
      ember.position.y = 0.48;
      group.add(ring, ember);
      colliders.push({
        shape: "circle",
        id: record.id,
        x: record.x,
        z: record.z,
        radius: 0.5,
        minY: record.y,
        maxY: record.y + 0.75,
      });
      targets.push(restTarget(record, group, "Warm campfire", {
        id: `${record.id}:rest`,
        label: "Warm campfire",
        safe: false,
        sheltered: false,
        warmth: 1,
      }));
    } else if (record.archetypeId === "survey_marker") {
      const pole = mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 2.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x303b37, roughness: 0.72 }),
        quality,
      );
      pole.position.y = 1.1;
      const cap = mesh(
        new THREE.OctahedronGeometry(0.22, 0),
        new THREE.MeshStandardMaterial({ color: 0x8bc3aa, emissive: 0x315b4a, emissiveIntensity: 1 }),
        quality,
      );
      cap.position.y = 2.25;
      group.add(pole, cap);
    } else if (record.archetypeId === "weather_shelter") {
      const canopy = mesh(
        new THREE.ConeGeometry(1.75, 1.15, 4),
        new THREE.MeshStandardMaterial({ color: 0x59675d, roughness: 0.92, side: THREE.DoubleSide }),
        quality,
      );
      canopy.rotation.y = Math.PI * 0.25;
      canopy.position.y = 1.75;
      group.add(canopy);
      colliders.push({
        shape: "circle",
        id: record.id,
        x: record.x,
        z: record.z,
        radius: 0.32,
        minY: record.y,
        maxY: record.y + 2.35,
      });
      targets.push(restTarget(record, group, "Weather shelter", {
        id: `${record.id}:rest`,
        label: "Weather shelter",
        safe: false,
        sheltered: true,
        warmth: 0.25,
      }));
    } else {
      const pole = mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 1.55, 6),
        new THREE.MeshStandardMaterial({ color: 0x2e3230, roughness: 0.74 }),
        quality,
      );
      pole.position.y = 0.78;
      const lamp = mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xf1b86f, emissive: 0xf28a3a, emissiveIntensity: 1.8 }),
        quality,
      );
      lamp.position.y = 1.62;
      const light = new THREE.PointLight(
        0xffad68,
        0,
        FIELD_TORCH_LIGHT_RANGE[quality],
        2,
      );
      light.name = `${record.id}:light`;
      light.position.y = 1.64;
      light.castShadow = false;
      light.visible = false;
      group.add(pole, lamp, light);
      lights.push({
        light,
        x: record.x,
        z: record.z,
        baseIntensity: FIELD_TORCH_BASE_INTENSITY,
      });
    }
    root.add(group);
  }
  return { root, targets, colliders, lights };
}

/**
 * Applies one bounded lighting policy to a placed-entity runtime. Lighting is
 * night-driven and selects the nearest torches so a large save cannot grow the
 * renderer's active light list without bound.
 */
export function applyPlacedRuntimeLighting(
  runtime: Readonly<PlacedRuntime>,
  quality: QualityLevel,
  nightStrength: number,
  focusX = 0,
  focusZ = 0,
) {
  const safeNight = Number.isFinite(nightStrength)
    ? THREE.MathUtils.clamp(nightStrength, 0, 1)
    : 0;
  const safeFocusX = Number.isFinite(focusX) ? focusX : 0;
  const safeFocusZ = Number.isFinite(focusZ) ? focusZ : 0;
  const activeIds = new Set(
    safeNight <= 0.015
      ? []
      : runtime.lights
        .map((entry, index) => ({
          index,
          distanceSquared:
            (entry.x - safeFocusX) ** 2 + (entry.z - safeFocusZ) ** 2,
        }))
        .sort((left, right) =>
          left.distanceSquared - right.distanceSquared || left.index - right.index)
        .slice(0, FIELD_TORCH_LIGHT_CAP[quality])
        .map(({ index }) => index),
  );
  const qualityIntensity = qualityUsesHighDetail(quality) ? 1 : 0.72;
  let active = 0;
  runtime.lights.forEach((entry, index) => {
    const enabled = activeIds.has(index);
    entry.light.visible = enabled;
    entry.light.intensity = enabled
      ? entry.baseIntensity * qualityIntensity * safeNight
      : 0;
    entry.light.distance = FIELD_TORCH_LIGHT_RANGE[quality];
    entry.light.castShadow = false;
    if (enabled) active += 1;
  });
  return active;
}

export function normalizePlacedEntities(value: unknown) {
  if (!Array.isArray(value)) return [];
  const records: PlacedEntity[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    if (records.length >= 64 || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const source = raw as Partial<PlacedEntity>;
    const serialToken = typeof source.id === "string"
      ? source.id.split(":").at(-1) ?? ""
      : "";
    const serial = Number(serialToken);
    if (
      typeof source.id !== "string" ||
      !PLACED_ID.test(source.id) ||
      !Number.isSafeInteger(serial) ||
      serial < 1 ||
      serial > MAX_PLACED_SERIAL ||
      String(serial) !== serialToken ||
      ids.has(source.id) ||
      typeof source.archetypeId !== "string" ||
      !ARCHETYPES.has(source.archetypeId as PlacementArchetype) ||
      typeof source.x !== "number" ||
      typeof source.y !== "number" ||
      typeof source.z !== "number" ||
      typeof source.yaw !== "number" ||
      ![source.x, source.y, source.z, source.yaw].every(Number.isFinite) ||
      Math.abs(source.x) > WORLD_HALF_EXTENT ||
      Math.abs(source.z) > WORLD_HALF_EXTENT ||
      source.y < -100 || source.y > 5_000
    ) continue;
    const wrapped = ((source.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    records.push({
      id: source.id,
      archetypeId: source.archetypeId as PlacementArchetype,
      x: source.x,
      y: source.y,
      z: source.z,
      yaw: wrapped,
    });
    ids.add(source.id);
  }
  return records;
}

export function nearbyCampModifiers(
  records: readonly PlacedEntity[],
  x: number,
  z: number,
  referenceY?: number,
) {
  let sheltered = false;
  let warmth = 0;
  for (const record of records) {
    const verticalOffset = referenceY === undefined
      ? 0
      : Number.isFinite(referenceY)
        ? referenceY - record.y
        : Number.POSITIVE_INFINITY;
    if (
      verticalOffset < CAMP_VERTICAL_MINIMUM ||
      verticalOffset > CAMP_VERTICAL_MAXIMUM
    ) continue;
    const distance = Math.hypot(record.x - x, record.z - z);
    if (record.archetypeId === "weather_shelter" && distance <= 3.2) sheltered = true;
    if (record.archetypeId === "campfire" && distance <= 4.5) warmth = Math.max(warmth, 1);
  }
  return { sheltered, warmth };
}
