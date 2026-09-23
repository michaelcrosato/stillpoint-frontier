export const ADAPTIVE_MIN_SCALE = 0.6;
const STEP = 0.1;
const DOWN_RATIO = 1.25;
const UP_RATIO = 0.6;
/** Consecutive samples beyond a threshold before the scale moves. */
const SUSTAIN_SAMPLES = 5;
/** Samples after a change before the next one may start. */
const COOLDOWN_SAMPLES = 10;

export interface AdaptiveResolutionOptions {
  /** GPU milliseconds a frame may take; 1000/60 targets 60 fps. */
  budgetMilliseconds: number;
}

/**
 * Lowers render resolution when the GPU, not the CPU, is the limit. It reads
 * GPU frame times only, so a CPU-bound frame (the usual case here) never moves
 * it. Sustained time over 1.25x budget steps the scale down by 0.1, sustained
 * time under 0.6x steps it back up, with a cooldown between steps, within
 * [0.6, 1].
 */
export class AdaptiveResolution {
  private scaleValue = 1;
  private over = 0;
  private under = 0;
  private cooldown = 0;

  constructor(
    private readonly options: Readonly<AdaptiveResolutionOptions>,
    private readonly enabled = true,
  ) {}

  get scale() {
    return this.scaleValue;
  }

  get active() {
    return this.enabled;
  }

  /** Feeds one GPU frame time; true when the scale changed. */
  sample(milliseconds: number | null | undefined) {
    if (!this.enabled || !Number.isFinite(milliseconds) || (milliseconds as number) <= 0) {
      return false;
    }
    const time = milliseconds as number;
    const budget = this.options.budgetMilliseconds;
    if (time > budget * DOWN_RATIO) {
      this.over += 1;
      this.under = 0;
    } else if (time < budget * UP_RATIO) {
      this.under += 1;
      this.over = 0;
    } else {
      this.over = 0;
      this.under = 0;
    }
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      this.over = 0;
      this.under = 0;
      return false;
    }
    let next = this.scaleValue;
    if (this.over >= SUSTAIN_SAMPLES) next = Math.max(ADAPTIVE_MIN_SCALE, this.scaleValue - STEP);
    else if (this.under >= SUSTAIN_SAMPLES) next = Math.min(1, this.scaleValue + STEP);
    // Round away float drift so repeated steps land on exact tenths.
    next = Math.round(next * 10) / 10;
    if (next === this.scaleValue) return false;
    this.scaleValue = next;
    this.over = 0;
    this.under = 0;
    this.cooldown = COOLDOWN_SAMPLES;
    return true;
  }

  reset() {
    this.scaleValue = 1;
    this.over = 0;
    this.under = 0;
    this.cooldown = 0;
  }
}

/** The pixel ratio to render at, never below half a CSS pixel. */
export function adaptivePixelRatio(resolvedPixelRatio: number, scale: number) {
  return Math.max(0.5, resolvedPixelRatio * scale);
}
