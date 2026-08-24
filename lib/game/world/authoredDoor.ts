import * as THREE from "three";
import type { PlanarCollider } from "../systems/collision";

export interface AuthoredDoorDefinition {
  id: string;
  name: string;
  buildingX: number;
  buildingZ: number;
  buildingRotation?: number;
  floorY: number;
  hingeX: number;
  hingeZ: number;
  width: number;
  height: number;
  thickness: number;
  opensInwardRotation?: number;
}

export interface AuthoredDoorRuntime {
  readonly id: string;
  readonly name: string;
  readonly pivot: THREE.Group;
  readonly targetPosition: THREE.Vector3;
  readonly collider: PlanarCollider;
  readonly isOpen: boolean;
  setOpen(open: boolean): void;
  colliderFor(open: boolean): PlanarCollider;
}

function colliderAt(
  definition: AuthoredDoorDefinition,
  localRotation: number,
): PlanarCollider {
  const buildingRotation = definition.buildingRotation ?? 0;
  const cosine = Math.cos(buildingRotation);
  const sine = Math.sin(buildingRotation);
  const halfWidth = definition.width * 0.5;
  const worldHingeX =
    definition.buildingX + cosine * definition.hingeX + sine * definition.hingeZ;
  const worldHingeZ =
    definition.buildingZ - sine * definition.hingeX + cosine * definition.hingeZ;
  const worldRotation = buildingRotation + localRotation;
  return {
    shape: "box",
    id: `authored-door:${definition.id}`,
    x: worldHingeX + Math.cos(worldRotation) * halfWidth,
    z: worldHingeZ - Math.sin(worldRotation) * halfWidth,
    halfWidth,
    halfDepth: definition.thickness * 0.5,
    rotation: worldRotation,
    minY: definition.floorY,
    maxY: definition.floorY + definition.height,
  };
}

/**
 * Creates a deterministic hinged door that snaps between closed and open.
 * The deliberately animation-free transition matches the project's low-motion
 * style while keeping the visible leaf and collision transform atomic.
 */
export function createAuthoredDoor(
  definition: AuthoredDoorDefinition,
  material: THREE.Material,
  initiallyOpen = false,
): AuthoredDoorRuntime {
  const openRotation = definition.opensInwardRotation ?? Math.PI * 0.5;
  const buildingRotation = definition.buildingRotation ?? 0;
  const cosine = Math.cos(buildingRotation);
  const sine = Math.sin(buildingRotation);
  const targetLocalX = definition.hingeX + definition.width * 0.5;
  const targetLocalZ = definition.hingeZ;
  const pivot = new THREE.Group();
  pivot.name = `authored-door:${definition.id}:pivot`;
  pivot.position.set(definition.hingeX, 0, definition.hingeZ);

  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(
      definition.width,
      definition.height,
      definition.thickness,
    ),
    material.clone(),
  );
  leaf.name = `authored-door:${definition.id}:leaf`;
  leaf.position.set(definition.width * 0.5, definition.height * 0.5, 0);
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  leaf.userData.shadow = true;
  pivot.add(leaf);

  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0xb28a4a,
    roughness: 0.38,
    metalness: 0.72,
  });
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.18, 0.09),
    handleMaterial,
  );
  handle.name = `authored-door:${definition.id}:handle`;
  handle.position.set(definition.width * 0.84, definition.height * 0.47, 0.08);
  handle.castShadow = true;
  handle.userData.shadow = true;
  pivot.add(handle);

  const collider = colliderAt(definition, 0);
  let open = false;
  const runtime: AuthoredDoorRuntime = {
    id: definition.id,
    name: definition.name,
    pivot,
    targetPosition: new THREE.Vector3(
      definition.buildingX + cosine * targetLocalX + sine * targetLocalZ,
      definition.floorY + Math.min(1.45, definition.height * 0.5),
      definition.buildingZ - sine * targetLocalX + cosine * targetLocalZ,
    ),
    collider,
    get isOpen() {
      return open;
    },
    setOpen(nextOpen: boolean) {
      open = nextOpen;
      const localRotation = open ? openRotation : 0;
      pivot.rotation.y = localRotation;
      const nextCollider = colliderAt(definition, localRotation);
      Object.assign(collider, nextCollider);
      pivot.userData.open = open;
      leaf.userData.open = open;
    },
    colliderFor(nextOpen: boolean) {
      return colliderAt(definition, nextOpen ? openRotation : 0);
    },
  };
  runtime.setOpen(initiallyOpen);
  return runtime;
}
