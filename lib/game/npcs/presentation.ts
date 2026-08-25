import * as THREE from "three";
import { qualityUsesShadows, type QualityLevel } from "../config";
import type { WorldTarget } from "../world/targets";
import type { NpcDefinition } from "./model";
import { npcPoseAt, npcPoseForDefinition } from "./stillpointNpcs";

const definitionByRoot = new WeakMap<THREE.Group, Readonly<NpcDefinition>>();

function bodyPart(
  geometry: THREE.BufferGeometry,
  color: number,
  quality: QualityLevel,
) {
  const part = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true }),
  );
  part.castShadow = qualityUsesShadows(quality);
  part.receiveShadow = true;
  return part;
}

export function createAuthoredNpcTarget(
  definition: Readonly<NpcDefinition>,
  quality: QualityLevel,
  totalMinutes: number,
): WorldTarget {
  const root = new THREE.Group();
  root.name = definition.id;
  const torso = bodyPart(
    new THREE.BoxGeometry(0.58, 0.82, 0.34),
    definition.appearance.torso,
    quality,
  );
  torso.position.y = 1.18;
  const head = bodyPart(
    new THREE.DodecahedronGeometry(0.24, 0),
    definition.appearance.head,
    quality,
  );
  head.position.y = 1.83;
  const coat = bodyPart(
    new THREE.BoxGeometry(0.7, 0.42, 0.4),
    definition.appearance.coat,
    quality,
  );
  coat.position.y = 0.7;
  const leftLeg = bodyPart(
    new THREE.BoxGeometry(0.18, 0.7, 0.2),
    definition.appearance.legs,
    quality,
  );
  leftLeg.position.set(-0.17, 0.35, 0);
  const rightLeg = leftLeg.clone();
  rightLeg.material = leftLeg.material;
  rightLeg.position.x = 0.17;
  root.add(torso, head, coat, leftLeg, rightLeg);
  definitionByRoot.set(root, definition);
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
  const authoredDefinition = definitionByRoot.get(target.root);
  const pose = authoredDefinition
    ? npcPoseForDefinition(authoredDefinition, totalMinutes)
    : npcPoseAt(target.npcId, totalMinutes);
  if (!pose) return;
  target.root.position.set(pose.x, pose.y, pose.z);
  target.root.rotation.y = pose.yaw;
  target.root.userData.scheduleAnchor = pose.scheduleEntryId;
  target.position.set(pose.x, pose.y + 1.35, pose.z);
}
