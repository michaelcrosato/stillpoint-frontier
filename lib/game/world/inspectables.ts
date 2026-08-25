import * as THREE from "three";
import { qualityUsesShadows, type QualityLevel } from "../config";
import type { WorldTarget } from "./targets";
import { chunkKey, sampleTerrainHeight, worldToChunk } from "./terrain";

export interface InspectionRecord {
  id: string;
  title: string;
  kicker: string;
  body: string;
  source: string;
}

interface InspectableDefinition extends InspectionRecord {
  x: number;
  z: number;
  rotation: number;
}

export const INSPECTABLES: readonly InspectableDefinition[] = Object.freeze([
  {
    id: "field-unit-noticeboard",
    title: "Field Unit Standing Orders",
    kicker: "OPERATIONS / NOTICE 01",
    body: "Keep the relay road clear. Record weather shifts before departure. Material gathered beyond the compound is expedition property until a fabrication bench is commissioned.",
    source: "Greywater Survey Authority",
    x: 3,
    z: 4.5,
    rotation: -0.35,
  },
  {
    id: "survey-house-ledger",
    title: "A Margin in the Survey Ledger",
    kicker: "FIELD NOTE / UNDATED",
    body: "The old roads still decide where people gather. Water explains the villages; ore explains Ironvale; the river crossing explains everything else. Follow infrastructure when the map feels empty.",
    source: "Signed only: M.",
    x: 16.4,
    z: 7.7,
    rotation: Math.PI,
  },
  {
    id: "meridian-tower-directory",
    title: "Meridian Tower Directory",
    kicker: "FACILITY INDEX / 03",
    body: "Floors 01–03: records. Floors 04–07: cartography. Floors 08–10: atmospheric observation. Roof access remains open to field personnel during clear wind conditions.",
    source: "Meridian Civil Survey",
    x: 4,
    z: 27.6,
    rotation: Math.PI,
  },
]);

export function inspectablesForChunk(targetChunkKey: string) {
  return INSPECTABLES.filter((definition) => {
    const coordinate = worldToChunk(definition.x, definition.z);
    return chunkKey(coordinate.x, coordinate.z) === targetChunkKey;
  });
}

export function createInspectableTarget(
  definition: Readonly<InspectableDefinition>,
  quality: QualityLevel,
): WorldTarget {
  const root = new THREE.Group();
  root.name = `inspectable:${definition.id}`;
  root.position.set(definition.x, sampleTerrainHeight(definition.x, definition.z), definition.z);
  root.rotation.y = definition.rotation;

  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0x252826,
    roughness: 0.76,
    metalness: 0.28,
  });
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8ad90,
    roughness: 0.9,
    metalness: 0.02,
    emissive: 0x1c241d,
    emissiveIntensity: 0.3,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.45, 0.16), postMaterial);
  post.position.y = 0.72;
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.86, 0.08), faceMaterial);
  face.position.y = 1.35;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 0.055, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xb8672f }),
  );
  stripe.position.set(0, 1.55, 0.052);
  for (const mesh of [post, face]) {
    mesh.castShadow = qualityUsesShadows(quality);
    mesh.receiveShadow = true;
  }
  root.add(post, face, stripe);

  return {
    id: `inspectable:${definition.id}`,
    kind: "inspectable",
    action: "inspect",
    name: definition.title,
    position: new THREE.Vector3(definition.x, root.position.y + 1.35, definition.z),
    root,
    maxDistance: 4.8,
    hitsRequired: 0,
    hits: 0,
    inspection: {
      id: definition.id,
      title: definition.title,
      kicker: definition.kicker,
      body: definition.body,
      source: definition.source,
    },
  };
}
