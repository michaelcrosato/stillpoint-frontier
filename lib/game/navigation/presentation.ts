import type { NavigationGuidance } from "./NavigationService";
import type { NavigationTargetSource } from "./NavigationService";

export interface WaypointScreenProjection {
  visible: boolean;
  xPercent: number;
  yPercent: number;
}

export interface GamePresentation {
  heading: number;
  unwrappedHeading: number;
  navigation: NavigationGuidance | null;
  waypointScreen: WaypointScreenProjection | null;
}

export const INITIAL_PRESENTATION: GamePresentation = {
  heading: 0,
  unwrappedHeading: 0,
  navigation: null,
  waypointScreen: null,
};

type Listener = () => void;

function projectionEqual(
  left: WaypointScreenProjection | null,
  right: WaypointScreenProjection | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.visible === right.visible &&
    left.xPercent === right.xPercent &&
    left.yPercent === right.yPercent
  );
}

function sourceEqual(left: NavigationTargetSource, right: NavigationTargetSource) {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "player":
      return true;
    case "quest":
      return (
        right.kind === "quest" &&
        left.questId === right.questId &&
        left.objectiveId === right.objectiveId
      );
    case "script":
      return right.kind === "script" && left.scriptId === right.scriptId;
    case "system":
      return right.kind === "system" && left.systemId === right.systemId;
  }
}

function navigationEqual(left: NavigationGuidance | null, right: NavigationGuidance | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.target.id === right.target.id &&
    left.target.label === right.target.label &&
    left.target.position.x === right.target.position.x &&
    left.target.position.z === right.target.position.z &&
    sourceEqual(left.target.source, right.target.source) &&
    left.target.arrivalRadius === right.target.arrivalRadius &&
    left.target.clearOnArrival === right.target.clearOnArrival &&
    left.distance === right.distance &&
    left.bearing === right.bearing &&
    left.relativeBearing === right.relativeBearing &&
    left.reached === right.reached
  );
}

/** A tiny external store so only navigation UI repaints at the render frame rate. */
export class GamePresentationStore {
  private current: GamePresentation = INITIAL_PRESENTATION;
  private readonly listeners = new Set<Listener>();

  publish(next: GamePresentation) {
    if (
      this.current.heading === next.heading &&
      this.current.unwrappedHeading === next.unwrappedHeading &&
      navigationEqual(this.current.navigation, next.navigation) &&
      projectionEqual(this.current.waypointScreen, next.waypointScreen)
    ) {
      return;
    }
    this.current = next;
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.current;

  getServerSnapshot = () => INITIAL_PRESENTATION;
}
