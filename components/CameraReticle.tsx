"use client";

import { useSyncExternalStore } from "react";
import type { CameraViewMode } from "../lib/game/camera/CameraRig";
import type { GamePresentationStore } from "../lib/game/navigation/presentation";

export default function CameraReticle({
  store,
  mode,
  viewKey,
}: {
  store: GamePresentationStore;
  mode: CameraViewMode;
  viewKey: string;
}) {
  const presentation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const aim = presentation.aimScreen;
  // Presentation, not the slower requested-mode snapshot, owns the endpoint.
  if (!aim) return <div className="crosshair" aria-hidden="true"><span /><i /></div>;
  if (!aim.visible) return null;
  const modeClass = mode !== "isometric"
    ? "is-third-person"
    : "is-isometric";
  return (
    <div
      className={`crosshair camera-aim-reticle ${modeClass}`}
      data-testid="camera-aim-reticle"
      style={{ left: `${aim.xPercent}%`, top: `${aim.yPercent}%` }}
      aria-hidden="true"
    >
      <span />
      <i />
      <small className="camera-view-chip">
        {mode === "isometric" ? "ISO" : mode === "thirdPerson" ? "TPV" : "FPV"} · {viewKey} / WHEEL
      </small>
    </div>
  );
}
