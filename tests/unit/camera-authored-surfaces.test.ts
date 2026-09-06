import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CameraRig } from "../../lib/game/camera/CameraRig";
import { PLAYER_HEIGHT } from "../../lib/game/config";
import { ChunkManager } from "../../lib/game/world/ChunkManager";
import { createSpawnBuilding, SPAWN_BUILDING as b } from "../../lib/game/world/spawnBuilding";

describe("camera boom against authored geometry", () => {
  it.each(["stairs", "doorway"] as const)("keeps the player visible at the %s", (fixture) => {
    const building = createSpawnBuilding("performance", true);
    building.root.updateMatrixWorld(true);
    const playerPosition = fixture === "stairs"
      ? new THREE.Vector3(b.x + b.roofStairCenterX, b.floorY + 2 * b.roofStairRise,
        b.z + b.roofStairStartZ - 1.5 * b.roofStairTread)
      : new THREE.Vector3(b.x, b.floorY, b.z + 1.5);
    const yaw = fixture === "stairs" ? 8 * Math.PI / 9 : 0;
    const pitch = fixture === "stairs" ? 0.58 : 0;
    const playerCamera = new THREE.PerspectiveCamera(67, 16 / 9, 0.08, 4_800);
    playerCamera.position.copy(playerPosition).add(new THREE.Vector3(0, PLAYER_HEIGHT, 0));
    playerCamera.rotation.set(pitch, yaw, 0, "YXZ");
    playerCamera.updateMatrixWorld(true);
    const renderCamera = playerCamera.clone();
    const diagnostics = new CameraRig(3).present({
      playerCamera, renderCamera, playerPosition, eyeHeight: PLAYER_HEIGHT, yaw, pitch,
      baseFov: 67, baseFar: 4_800, deltaSeconds: 1 / 60, snap: true,
      world: {
        sampleGroundHeight: ChunkManager.prototype.sampleGroundHeight,
        sampleOverheadHeight: ChunkManager.prototype.sampleOverheadHeight,
        queryColliders: () => building.colliders,
      },
    });
    try {
      expect(diagnostics.collisionLimited).toBe(fixture === "stairs");
      if (fixture === "stairs") expect(diagnostics.distance).toBeLessThan(3);
      else expect(diagnostics.distance).toBe(3);
      const boom = renderCamera.position.clone().sub(playerCamera.position);
      const ray = new THREE.Raycaster(playerCamera.position, boom.clone().normalize(), 0, boom.length());
      const slabs: THREE.Object3D[] = [];
      building.root.traverse((object) => {
        if (object.name.includes("roof-stair:steps") || object.name === "spawn-building:roof") slabs.push(object);
      });
      expect(slabs.length).toBeGreaterThan(0);
      expect(ray.intersectObjects(slabs, false)).toHaveLength(0);
    } finally {
      building.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object instanceof THREE.InstancedMesh) object.dispose();
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    }
  });
});
