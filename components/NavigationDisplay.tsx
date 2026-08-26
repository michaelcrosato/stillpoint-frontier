"use client";

import { useSyncExternalStore } from "react";
import {
  buildCompassMarks,
  cardinalForHeading,
  clamp,
  formatHeading,
  formatNavigationDistance,
} from "../lib/game/navigation/math";
import type { GamePresentationStore } from "../lib/game/navigation/presentation";
import type { EnvironmentSnapshot } from "../lib/game/state";

const COMPASS_SPAN = 60;

const CLOCK_STATE_LABEL: Record<EnvironmentSnapshot["clockState"], string> = {
  running: "RUNNING",
  paused: "PAUSED",
  frozen: "DEV FROZEN",
  test_hold: "TEST HOLD",
};

export function CompassTape({
  store,
  environment,
}: {
  store: GamePresentationStore;
  environment: EnvironmentSnapshot;
}) {
  const presentation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const marks = buildCompassMarks(presentation.unwrappedHeading, COMPASS_SPAN, 5);
  const navigation = presentation.navigation;
  const waypointOffset = navigation
    ? clamp(navigation.relativeBearing, -COMPASS_SPAN + 2, COMPASS_SPAN - 2)
    : 0;
  const waypointOffscreen = navigation
    ? Math.abs(navigation.relativeBearing) >= COMPASS_SPAN - 2
    : false;
  const direction = !navigation || Math.abs(navigation.relativeBearing) < 4
    ? "ahead"
    : navigation.relativeBearing < 0
      ? "left"
      : "right";
  const clock = `${String(environment.hour).padStart(2, "0")}:${String(environment.minute).padStart(2, "0")}`;
  const navigationLabel = navigation
    ? `Waypoint ${formatHeading(navigation.bearing)}, ${formatNavigationDistance(navigation.distance)}, ${navigation.reached ? "arrived" : direction}`
    : "No active waypoint";

  return (
    <div
      className="compass"
      data-testid="compass"
      role="group"
      aria-label={`Heading ${formatHeading(presentation.heading)}, ${cardinalForHeading(presentation.heading)}. ${navigationLabel}`}
    >
      <div
        className={`navigation-summary ${navigation?.reached ? "is-reached" : ""}`}
        data-testid="world-clock"
        role="group"
        aria-label={`Day ${environment.day}, time ${clock}. ${navigationLabel}`}
      >
        <div>
          <span>DAY</span>
          <strong>{String(environment.day).padStart(3, "0")}</strong>
        </div>
        <div>
          <span>TIME</span>
          <time dateTime={clock}>{clock}</time>
        </div>
        <div>
          <span>WAYPOINT</span>
          <strong data-testid="navigation-bearing">
            {navigation ? formatHeading(navigation.bearing) : "---°"}
          </strong>
        </div>
        <div>
          <span>DISTANCE</span>
          <strong data-testid="navigation-distance">
            {navigation
              ? formatNavigationDistance(navigation.distance)
              : "--"}
          </strong>
        </div>
        <span className="sr-only">{environment.phase.toUpperCase()}</span>
        <span className="sr-only" data-testid="world-clock-state">
          {CLOCK_STATE_LABEL[environment.clockState]}
        </span>
      </div>
      <div className="compass-heading">
        <span>HEADING</span>
        <strong>{formatHeading(presentation.heading)}</strong>
        <em>{cardinalForHeading(presentation.heading)}</em>
      </div>
      <div className="compass-window" data-testid="compass-tape" aria-hidden="true">
        {marks.map((mark) => (
          <i
            key={mark.absoluteHeading}
            className={`compass-mark is-${mark.kind}`}
            style={{ left: `${50 + (mark.offset / (COMPASS_SPAN * 2)) * 100}%` }}
          >
            {mark.label && <b>{mark.label}</b>}
          </i>
        ))}
        {navigation && (
          <span
            className={`compass-waypoint ${waypointOffscreen ? "is-offscreen" : ""} ${navigation.reached ? "is-reached" : ""}`}
            data-testid="waypoint-compass-marker"
            data-direction={direction}
            style={{ left: `${50 + (waypointOffset / (COMPASS_SPAN * 2)) * 100}%` }}
          >
            {waypointOffscreen ? (navigation.relativeBearing < 0 ? "‹" : "›") : ""}
          </span>
        )}
        <span className="compass-center" />
      </div>
    </div>
  );
}
