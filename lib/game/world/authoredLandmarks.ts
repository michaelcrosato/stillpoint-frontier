import { CANYON_LANDMARK } from "./canyonLandmark";
import { MOUNTAIN_LANDMARK } from "./mountainLandmark";

export interface AuthoredLandmarkWaypoint {
  id: string;
  sourceId: string;
  label: string;
  position: { x: number; z: number };
  arrivalRadius: number;
  detail: string;
}

export const AUTHORED_LANDMARK_NAVIGATION_SYSTEM_ID = "authored-landmarks";

/**
 * One immutable registry feeds navigation, map selection, and playtest travel.
 * Future terrain landmarks only need to add one waypoint here.
 */
export const AUTHORED_LANDMARK_WAYPOINTS: readonly AuthoredLandmarkWaypoint[] =
  Object.freeze([
    Object.freeze({
      id: MOUNTAIN_LANDMARK.trailheadId,
      sourceId: MOUNTAIN_LANDMARK.id,
      label: MOUNTAIN_LANDMARK.trailheadName,
      position: Object.freeze({ ...MOUNTAIN_LANDMARK.baseWaypoint }),
      arrivalRadius: 24,
      detail: "marked summit trail · alpine terrain landmark",
    }),
    Object.freeze({
      id: CANYON_LANDMARK.overlookId,
      sourceId: CANYON_LANDMARK.id,
      label: CANYON_LANDMARK.overlookName,
      position: Object.freeze({ ...CANYON_LANDMARK.overlookWaypoint }),
      arrivalRadius: 28,
      detail: "marked rim trail · canyon overlook · river corridor",
    }),
  ]);
