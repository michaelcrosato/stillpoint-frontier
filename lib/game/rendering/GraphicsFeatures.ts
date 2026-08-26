export const GRAPHICS_FEATURE_IDS = [
  "shadowStabilization",
  "surfaceDetail",
  "vegetationWind",
  "atmosphericGrade",
  "horizonLights",
  "selectiveBloom",
  "ambientOcclusion",
  "environmentReflections",
] as const;

export type GraphicsFeatureId = (typeof GRAPHICS_FEATURE_IDS)[number];

export type GraphicsFeatureState = Readonly<Record<GraphicsFeatureId, boolean>>;

export const DEFAULT_GRAPHICS_FEATURES: GraphicsFeatureState = Object.freeze({
  shadowStabilization: true,
  surfaceDetail: true,
  vegetationWind: true,
  atmosphericGrade: true,
  horizonLights: true,
  selectiveBloom: true,
  ambientOcclusion: true,
  environmentReflections: true,
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
  {
    id: "atmosphericGrade",
    label: "ATMOSPHERIC GRADE",
    description: "Adapts the final palette to daylight, golden hour, storms, dust, and night.",
  },
  {
    id: "horizonLights",
    label: "HORIZON CITY LIGHTS",
    description: "Adds capped render-only window and rooftop lights to distant cities at night.",
  },
  {
    id: "selectiveBloom",
    label: "SELECTIVE BLOOM",
    description: "Adds restrained glow to marked windows, relays, torches, and skyline lights.",
  },
  {
    id: "ambientOcclusion",
    label: "NEAR-FIELD GTAO",
    description: "Grounds nearby structures and vegetation on Ultra when the browser supports it.",
  },
  {
    id: "environmentReflections",
    label: "ENVIRONMENT REFLECTIONS",
    description: "Feeds the generated sky and horizon into PBR glass, metal, roofs, and wet surfaces.",
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
