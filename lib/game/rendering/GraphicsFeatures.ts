export const GRAPHICS_FEATURE_IDS = [
  "shadowStabilization",
  "surfaceDetail",
  "vegetationWind",
] as const;

export type GraphicsFeatureId = (typeof GRAPHICS_FEATURE_IDS)[number];

export type GraphicsFeatureState = Readonly<Record<GraphicsFeatureId, boolean>>;

export const DEFAULT_GRAPHICS_FEATURES: GraphicsFeatureState = Object.freeze({
  shadowStabilization: true,
  surfaceDetail: true,
  vegetationWind: true,
});

export const GRAPHICS_FEATURE_DEFINITIONS: ReadonlyArray<{
  id: GraphicsFeatureId;
  label: string;
  description: string;
}> = [
  {
    id: "shadowStabilization",
    label: "STABLE SUN SHADOWS",
    description: "Texel-snaps the local sun-shadow field to reduce crawling while moving.",
  },
  {
    id: "surfaceDetail",
    label: "SURFACE MICRO-DETAIL",
    description: "Adds distance-faded world-space color and roughness breakup to terrain and structures.",
  },
  {
    id: "vegetationWind",
    label: "VEGETATION WIND",
    description: "Bends trees, reeds, and ground cover with the live weather wind field.",
  },
] as const;

export function isGraphicsFeatureId(value: unknown): value is GraphicsFeatureId {
  return GRAPHICS_FEATURE_IDS.includes(value as GraphicsFeatureId);
}

export function setGraphicsFeatureState(
  state: GraphicsFeatureState,
  id: GraphicsFeatureId,
  enabled: boolean,
): GraphicsFeatureState {
  return state[id] === enabled ? state : { ...state, [id]: enabled };
}
