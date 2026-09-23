import * as THREE from "three";

/** Anything that changes what casts into the sun's shadow map reports here. */
export interface ShadowInvalidator {
  markDirty(reason: string): void;
}

export const NO_SHADOW_INVALIDATOR: ShadowInvalidator = { markDirty: () => undefined };

/**
 * The sun turns about 0.0044 rad per real second. Re-rendering every 0.0005 rad
 * (about nine times a second) moves a 10 m caster's shadow edge by well under
 * a texel per update, which the PCF kernel hides.
 */
export const SHADOW_DIRECTION_THRESHOLD_RADIANS = 0.0005;

/**
 * The 176 m shadow box is re-rendered at a texel-snapped anchor, so between
 * renders it only has to follow the player for coverage at its edge. Measured
 * on the player, not the snapped anchor: that anchor is snapped in the light's
 * own basis and sweeps around the world origin as the sun turns.
 */
export const SHADOW_MOVEMENT_TOLERANCE_METERS = 1;

/** Bounds the staleness of any change that was not reported. */
export const SHADOW_SAFETY_REFRESH_EVALUATIONS = 30;

export interface ShadowUpdateDiagnostics {
  renders: number;
  skipped: number;
  lastReason: string | null;
}

/**
 * Decides, once per presented frame, whether the sun's shadow map must be
 * re-rendered. The map depends on the shadow camera (which follows the player
 * and the light direction) and on the casters inside it; casters report
 * changes through markDirty. Everything else reuses the previous map, which
 * stays consistent because three updates the shadow matrix only when it
 * renders the map.
 */
export class ShadowUpdatePolicy implements ShadowInvalidator {
  private readonly renderedPosition = new THREE.Vector3();
  private readonly renderedDirection = new THREE.Vector3();
  private dirty = true;
  private idleEvaluations = 0;
  private renders = 0;
  private skipped = 0;
  private lastReason: string | null = null;

  markDirty(reason: string) {
    this.dirty = true;
    this.lastReason = reason;
  }

  shouldRender(
    playerPosition: Readonly<THREE.Vector3>,
    lightDirection: Readonly<THREE.Vector3>,
  ) {
    this.idleEvaluations += 1;
    const render =
      this.dirty ||
      // Both are measured from the last render, so a slow walk or a slowly
      // moving sun still crosses its threshold.
      playerPosition.distanceToSquared(this.renderedPosition) >
        SHADOW_MOVEMENT_TOLERANCE_METERS ** 2 ||
      lightDirection.angleTo(this.renderedDirection) > SHADOW_DIRECTION_THRESHOLD_RADIANS ||
      this.idleEvaluations >= SHADOW_SAFETY_REFRESH_EVALUATIONS;
    if (!render) {
      this.skipped += 1;
      return false;
    }
    this.dirty = false;
    this.idleEvaluations = 0;
    this.renderedPosition.copy(playerPosition);
    this.renderedDirection.copy(lightDirection);
    this.renders += 1;
    return true;
  }

  get diagnostics(): ShadowUpdateDiagnostics {
    return { renders: this.renders, skipped: this.skipped, lastReason: this.lastReason };
  }
}
