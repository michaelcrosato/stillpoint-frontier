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

/** Bounds the staleness of any change that was not reported. */
export const SHADOW_SAFETY_REFRESH_EVALUATIONS = 30;

export interface ShadowUpdateDiagnostics {
  renders: number;
  skipped: number;
  lastReason: string | null;
}

/**
 * Decides, once per presented frame, whether the sun's shadow map must be
 * re-rendered. The map depends on the shadow camera (anchor and light
 * direction) and on the casters inside it; casters report changes through
 * markDirty. Everything else reuses the previous map.
 */
export class ShadowUpdatePolicy implements ShadowInvalidator {
  private readonly renderedAnchor = new THREE.Vector3();
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
    anchor: Readonly<THREE.Vector3>,
    lightDirection: Readonly<THREE.Vector3>,
  ) {
    this.idleEvaluations += 1;
    const render =
      this.dirty ||
      !anchor.equals(this.renderedAnchor) ||
      // Measured from the last rendered direction, so a slowly moving sun
      // still crosses the threshold.
      lightDirection.angleTo(this.renderedDirection) > SHADOW_DIRECTION_THRESHOLD_RADIANS ||
      this.idleEvaluations >= SHADOW_SAFETY_REFRESH_EVALUATIONS;
    if (!render) {
      this.skipped += 1;
      return false;
    }
    this.dirty = false;
    this.idleEvaluations = 0;
    this.renderedAnchor.copy(anchor);
    this.renderedDirection.copy(lightDirection);
    this.renders += 1;
    return true;
  }

  get diagnostics(): ShadowUpdateDiagnostics {
    return { renders: this.renders, skipped: this.skipped, lastReason: this.lastReason };
  }
}
