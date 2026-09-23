import * as THREE from "three";
import { markBloomOnly } from "./Bloom";

/** Angular radii at the midpoint of the sky shader's own disc edges. */
export const SUN_DISC_ANGULAR_RADIUS = Math.acos((0.99972 + 0.99991) / 2);
export const MOON_DISC_ANGULAR_RADIUS = Math.acos((0.99942 + 0.99978) / 2);
/** A disc whose centre is lower than this is under the horizon. */
const HORIZON_CUTOFF = -0.02;

export interface CelestialDiscInput {
  viewPosition: Readonly<THREE.Vector3>;
  sunDirection: Readonly<THREE.Vector3>;
  moonDirection: Readonly<THREE.Vector3>;
  sunColor: Readonly<THREE.Color>;
  moonColor: Readonly<THREE.Color>;
  daylight: number;
  night: number;
  cloudCover: number;
  /** How far from the view to place the discs; keep it inside the far plane. */
  distance: number;
}

const unit = (value: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);

/**
 * Two small unlit discs that give the sun and moon a bloom source. The sky
 * shader already draws both discs in the main pass, under its clouds, so these
 * live only on BLOOM_LAYER and add glow without a second, cloud-free disc.
 * Placed near the far plane, anything in front of them, the horizon included,
 * occludes their glow.
 */
export class CelestialDiscs {
  readonly sun: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly moon: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly geometry = new THREE.CircleGeometry(1, 32);
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.sun = this.createDisc("celestial-sun");
    this.moon = this.createDisc("celestial-moon");
  }

  present(input: Readonly<CelestialDiscInput>) {
    if (this.disposed) return;
    const clearSky = 1 - unit(input.cloudCover) * 0.85;
    this.place(this.sun, input, input.sunDirection, SUN_DISC_ANGULAR_RADIUS);
    this.sun.visible = input.sunDirection.y > HORIZON_CUTOFF && unit(input.daylight) > 0.001;
    this.sun.material.color
      .copy(input.sunColor)
      .multiplyScalar(2.2 * unit(input.daylight) * clearSky);
    this.place(this.moon, input, input.moonDirection, MOON_DISC_ANGULAR_RADIUS);
    this.moon.visible = input.moonDirection.y > HORIZON_CUTOFF && unit(input.night) > 0.001;
    this.moon.material.color
      .copy(input.moonColor)
      .multiplyScalar(1.15 * unit(input.night) * clearSky);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.sun, this.moon);
    this.sun.material.dispose();
    this.moon.material.dispose();
    this.geometry.dispose();
  }

  private createDisc(name: string) {
    const disc = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({ fog: false, depthWrite: false }),
    );
    disc.name = name;
    disc.visible = false;
    disc.castShadow = false;
    disc.receiveShadow = false;
    markBloomOnly(disc);
    this.scene.add(disc);
    return disc;
  }

  private place(
    disc: THREE.Mesh,
    input: Readonly<CelestialDiscInput>,
    direction: Readonly<THREE.Vector3>,
    angularRadius: number,
  ) {
    disc.position.copy(input.viewPosition).addScaledVector(direction, input.distance);
    disc.lookAt(input.viewPosition);
    disc.scale.setScalar(input.distance * Math.tan(angularRadius));
  }
}
