import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { tagWorldMaterial } from "../rendering/WorldMaterialLibrary";
import { prepareVegetationGeometry } from "../rendering/VegetationWind";
import type { BiomeId } from "./macroWorld";

export type WoodySpeciesId =
  | "river_willow"
  | "grey_alder"
  | "sable_pine"
  | "frost_spruce"
  | "crown_juniper"
  | "ridge_birch"
  | "wind_acacia"
  | "steppe_juniper"
  | "salt_cedar"
  | "shore_pine"
  | "field_oak"
  | "silver_aspen";

export type WoodyForm =
  | "willow"
  | "round"
  | "conifer"
  | "tiered_conifer"
  | "columnar"
  | "acacia";

export type GroundcoverKind =
  | "reeds"
  | "ferns"
  | "heather"
  | "sage"
  | "succulents"
  | "dune_grass"
  | "meadow";

export interface WoodySpeciesDefinition {
  id: WoodySpeciesId;
  label: string;
  form: WoodyForm;
  trunkColor: number;
  foliageColor: number;
  accentColor: number;
  relativeHeight: number;
  relativeWidth: number;
  harvestName: string;
}

export interface VegetationProfile {
  woody: readonly WoodySpeciesId[];
  groundcover: GroundcoverKind;
  groundcoverDensity: number;
  groundcoverColors: readonly [number, number, number];
}

export const WOODY_SPECIES: Readonly<Record<WoodySpeciesId, WoodySpeciesDefinition>> = {
  river_willow: {
    id: "river_willow",
    label: "Greywater willow",
    form: "willow",
    trunkColor: 0x44392c,
    foliageColor: 0x50684d,
    accentColor: 0x708068,
    relativeHeight: 0.92,
    relativeWidth: 1.18,
    harvestName: "Workable willow",
  },
  grey_alder: {
    id: "grey_alder",
    label: "Grey alder",
    form: "round",
    trunkColor: 0x51483c,
    foliageColor: 0x465c45,
    accentColor: 0x68765b,
    relativeHeight: 0.88,
    relativeWidth: 0.96,
    harvestName: "Workable alder",
  },
  sable_pine: {
    id: "sable_pine",
    label: "Sable pine",
    form: "conifer",
    trunkColor: 0x393329,
    foliageColor: 0x283b2e,
    accentColor: 0x354c39,
    relativeHeight: 1,
    relativeWidth: 1,
    harvestName: "Workable sable pine",
  },
  frost_spruce: {
    id: "frost_spruce",
    label: "Frost spruce",
    form: "tiered_conifer",
    trunkColor: 0x3b352d,
    foliageColor: 0x31473d,
    accentColor: 0x4d6255,
    relativeHeight: 1.12,
    relativeWidth: 0.86,
    harvestName: "Workable frost spruce",
  },
  crown_juniper: {
    id: "crown_juniper",
    label: "Crown juniper",
    form: "columnar",
    trunkColor: 0x493d31,
    foliageColor: 0x425246,
    accentColor: 0x637062,
    relativeHeight: 0.72,
    relativeWidth: 0.72,
    harvestName: "Workable crown juniper",
  },
  ridge_birch: {
    id: "ridge_birch",
    label: "Ridge birch",
    form: "round",
    trunkColor: 0xb1aa96,
    foliageColor: 0x6b7454,
    accentColor: 0x8a8e65,
    relativeHeight: 0.9,
    relativeWidth: 0.82,
    harvestName: "Workable ridge birch",
  },
  wind_acacia: {
    id: "wind_acacia",
    label: "Wind acacia",
    form: "acacia",
    trunkColor: 0x58452f,
    foliageColor: 0x686846,
    accentColor: 0x85805a,
    relativeHeight: 0.74,
    relativeWidth: 1.2,
    harvestName: "Workable wind acacia",
  },
  steppe_juniper: {
    id: "steppe_juniper",
    label: "Steppe juniper",
    form: "columnar",
    trunkColor: 0x4b3c2c,
    foliageColor: 0x545b3c,
    accentColor: 0x74734e,
    relativeHeight: 0.62,
    relativeWidth: 0.7,
    harvestName: "Workable steppe juniper",
  },
  salt_cedar: {
    id: "salt_cedar",
    label: "Salt cedar",
    form: "willow",
    trunkColor: 0x59493a,
    foliageColor: 0x697064,
    accentColor: 0x85897b,
    relativeHeight: 0.72,
    relativeWidth: 0.88,
    harvestName: "Workable salt cedar",
  },
  shore_pine: {
    id: "shore_pine",
    label: "Wind-bent shore pine",
    form: "conifer",
    trunkColor: 0x41372c,
    foliageColor: 0x3e5147,
    accentColor: 0x5b6b5d,
    relativeHeight: 0.76,
    relativeWidth: 0.86,
    harvestName: "Workable shore pine",
  },
  field_oak: {
    id: "field_oak",
    label: "Field oak",
    form: "round",
    trunkColor: 0x4b3b2c,
    foliageColor: 0x4f5b3d,
    accentColor: 0x707451,
    relativeHeight: 0.96,
    relativeWidth: 1.14,
    harvestName: "Workable field oak",
  },
  silver_aspen: {
    id: "silver_aspen",
    label: "Silver aspen",
    form: "columnar",
    trunkColor: 0xaca58f,
    foliageColor: 0x667052,
    accentColor: 0x878c67,
    relativeHeight: 1.02,
    relativeWidth: 0.72,
    harvestName: "Workable silver aspen",
  },
};

export const VEGETATION_PROFILES: Readonly<Record<BiomeId, VegetationProfile>> = {
  riverlands: {
    woody: ["river_willow", "grey_alder"],
    groundcover: "reeds",
    groundcoverDensity: 0.92,
    groundcoverColors: [0x5c684a, 0x7a7650, 0x8b7041],
  },
  pine_forest: {
    woody: ["sable_pine", "frost_spruce"],
    groundcover: "ferns",
    groundcoverDensity: 0.72,
    groundcoverColors: [0x314735, 0x455a3e, 0x5a6648],
  },
  crown_highlands: {
    woody: ["crown_juniper", "ridge_birch"],
    groundcover: "heather",
    groundcoverDensity: 0.48,
    groundcoverColors: [0x59604c, 0x6c5961, 0x84706f],
  },
  warden_steppe: {
    woody: ["wind_acacia", "steppe_juniper"],
    groundcover: "sage",
    groundcoverDensity: 0.7,
    groundcoverColors: [0x7b7658, 0x8b7d57, 0x69694f],
  },
  glass_badlands: {
    woody: [],
    groundcover: "succulents",
    groundcoverDensity: 0.3,
    groundcoverColors: [0x59634e, 0x746c48, 0x875942],
  },
  salt_coast: {
    woody: ["salt_cedar", "shore_pine"],
    groundcover: "dune_grass",
    groundcoverDensity: 0.56,
    groundcoverColors: [0x7d7b62, 0x909078, 0x6c765f],
  },
  grey_meadow: {
    woody: ["field_oak", "silver_aspen"],
    groundcover: "meadow",
    groundcoverDensity: 1,
    groundcoverColors: [0x6c704d, 0x87835a, 0x8d724d],
  },
};

export const MAX_GROUNDCOVER_PER_CHUNK = 68;

export function selectWoodySpecies(biomeId: BiomeId, randomValue: number) {
  const candidates = VEGETATION_PROFILES[biomeId].woody;
  if (candidates.length === 0) return null;
  const normalized = Number.isFinite(randomValue)
    ? THREE.MathUtils.clamp(randomValue, 0, 0.999999)
    : 0;
  return WOODY_SPECIES[candidates[Math.floor(normalized * candidates.length)]];
}

export function groundcoverCount(biomeId: BiomeId, qualityScale = 1) {
  const density = VEGETATION_PROFILES[biomeId].groundcoverDensity;
  const safeScale = Number.isFinite(qualityScale)
    ? THREE.MathUtils.clamp(qualityScale, 0, 1)
    : 1;
  return Math.min(
    MAX_GROUNDCOVER_PER_CHUNK,
    Math.floor((18 + density * 50) * safeScale),
  );
}

function coloredPart(source: THREE.BufferGeometry, color: number) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  source.dispose();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = tint.r;
    colors[index + 1] = tint.g;
    colors[index + 2] = tint.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function mergeColored(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Vegetation geometry could not be assembled");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createWoodyGeometry(species: WoodySpeciesDefinition) {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = coloredPart(
    new THREE.CylinderGeometry(0.31, 0.46, 3.7, 6),
    species.trunkColor,
  );
  trunk.translate(0, 1.85, 0);
  parts.push(trunk);

  const addCrown = (
    geometry: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const crown = coloredPart(geometry, color);
    crown.scale(sx, sy, sz);
    crown.translate(x, y, z);
    parts.push(crown);
  };

  switch (species.form) {
    case "conifer":
      addCrown(new THREE.ConeGeometry(1.75, 4.8, 7), species.foliageColor, 0, 5, 0);
      addCrown(new THREE.ConeGeometry(1.2, 3.2, 7), species.accentColor, 0, 6.7, 0);
      break;
    case "tiered_conifer":
      addCrown(new THREE.ConeGeometry(1.8, 2.5, 7), species.foliageColor, 0, 4.2, 0);
      addCrown(new THREE.ConeGeometry(1.45, 2.7, 7), species.accentColor, 0, 5.6, 0);
      addCrown(new THREE.ConeGeometry(1.05, 2.8, 7), species.foliageColor, 0, 7, 0);
      break;
    case "willow":
      addCrown(new THREE.DodecahedronGeometry(1.25, 0), species.foliageColor, -0.8, 5.5, 0, 1.15, 1.5, 1);
      addCrown(new THREE.DodecahedronGeometry(1.3, 0), species.accentColor, 0.75, 5.35, 0.15, 1.1, 1.65, 1.05);
      addCrown(new THREE.DodecahedronGeometry(1.1, 0), species.foliageColor, 0, 6.25, -0.35, 1.25, 1.25, 1.1);
      break;
    case "acacia":
      addCrown(new THREE.DodecahedronGeometry(1.35, 0), species.foliageColor, -0.75, 5.05, 0, 1.25, 0.55, 1);
      addCrown(new THREE.DodecahedronGeometry(1.45, 0), species.accentColor, 0.75, 5.15, 0.1, 1.25, 0.58, 1);
      break;
    case "columnar":
      addCrown(new THREE.DodecahedronGeometry(1.25, 0), species.foliageColor, 0, 4.65, 0, 0.85, 1.65, 0.85);
      addCrown(new THREE.DodecahedronGeometry(0.95, 0), species.accentColor, 0.15, 6.2, 0, 0.75, 1.35, 0.75);
      break;
    case "round":
      addCrown(new THREE.DodecahedronGeometry(1.5, 0), species.foliageColor, -0.65, 5.2, 0, 1.05, 0.9, 1);
      addCrown(new THREE.DodecahedronGeometry(1.35, 0), species.accentColor, 0.75, 5.25, 0.1, 1.05, 0.95, 1);
      addCrown(new THREE.DodecahedronGeometry(1.25, 0), species.foliageColor, 0, 6.1, -0.25, 1, 0.9, 1);
      break;
  }

  const geometry = mergeColored(parts);
  geometry.scale(species.relativeWidth, species.relativeHeight, species.relativeWidth);
  return prepareVegetationGeometry(geometry, 0.42);
}

export function createGroundcoverGeometry(profile: VegetationProfile) {
  const [base, middle, accent] = profile.groundcoverColors;
  const parts: THREE.BufferGeometry[] = [];
  const add = (
    geometry: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const part = coloredPart(geometry, color);
    part.scale(sx, sy, sz);
    part.translate(x, y, z);
    parts.push(part);
  };

  switch (profile.groundcover) {
    case "reeds":
      for (const [index, x] of [-0.34, 0, 0.31].entries()) {
        const height = 0.82 + index * 0.16;
        add(new THREE.CylinderGeometry(0.035, 0.045, height, 5), base, x, height / 2, index % 2 ? 0.15 : -0.12);
        add(new THREE.CapsuleGeometry(0.07, 0.22, 2, 5), accent, x, height + 0.11, index % 2 ? 0.15 : -0.12, 0.75, 1, 0.75);
      }
      break;
    case "ferns":
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.18, 0.88, 4), index % 2 ? middle : base, Math.cos(angle) * 0.22, 0.31, Math.sin(angle) * 0.22, 0.75, 0.7, 1.8);
      }
      break;
    case "succulents":
      add(new THREE.CylinderGeometry(0.16, 0.2, 0.86, 6), base, 0, 0.43, 0);
      add(new THREE.CylinderGeometry(0.08, 0.1, 0.44, 5), middle, 0.2, 0.43, 0, 1, 1, 1);
      add(new THREE.CylinderGeometry(0.08, 0.1, 0.36, 5), accent, -0.18, 0.34, 0.06, 1, 1, 1);
      break;
    case "heather":
      add(new THREE.DodecahedronGeometry(0.36, 0), base, -0.2, 0.25, 0, 1, 0.7, 1);
      add(new THREE.DodecahedronGeometry(0.32, 0), middle, 0.2, 0.22, 0.08, 1, 0.75, 1);
      add(new THREE.DodecahedronGeometry(0.18, 0), accent, 0, 0.48, 0, 1, 0.8, 1);
      break;
    case "sage":
      add(new THREE.IcosahedronGeometry(0.42, 0), base, -0.2, 0.28, 0, 1.1, 0.7, 1);
      add(new THREE.IcosahedronGeometry(0.36, 0), middle, 0.24, 0.25, 0.08, 1.1, 0.7, 1);
      break;
    case "dune_grass":
    case "meadow":
      for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        const height = 0.46 + (index % 3) * 0.16;
        add(new THREE.ConeGeometry(0.075, height, 3), index % 3 === 2 ? accent : index % 2 ? middle : base, Math.cos(angle) * 0.2, height / 2, Math.sin(angle) * 0.2, 0.7, 1, 0.7);
      }
      break;
  }

  return prepareVegetationGeometry(mergeColored(parts), 0.12);
}

export function vegetationMaterial(
  layer: "woody" | "groundcover" = "woody",
  side: THREE.Side = THREE.FrontSide,
) {
  return tagWorldMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
      side,
    }),
    {
      role: "vegetation",
      weatherExposure: 0.82,
      wetRoughness: 0.62,
      environmentScale: 0.5,
      wetReflectionBoost: 0.18,
      detail: false,
      windAmplitude: layer === "woody" ? 0.42 : 0.12,
    },
  );
}
