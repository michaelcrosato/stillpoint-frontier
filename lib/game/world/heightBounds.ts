// The canyon floor is below -600 m. These shared limits include all authored
// terrain and buildings while rejecting invalid survey and placement heights.
export const MIN_WORLD_HEIGHT = -1_000;
export const MAX_WORLD_HEIGHT = 5_000;

export function isSupportedWorldHeight(height: unknown): height is number {
  return typeof height === "number" && Number.isFinite(height) &&
    height >= MIN_WORLD_HEIGHT && height <= MAX_WORLD_HEIGHT;
}
