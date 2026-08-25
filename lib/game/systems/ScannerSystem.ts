import * as THREE from "three";
import type { GameSystem } from "../core/SystemPipeline";
import { selectScanCandidate } from "../gameplay/fieldGuide";
import type { GameRuntimeContext } from "./runtime";

export const SCAN_HOLD_SECONDS = 1.15;
const forward = new THREE.Vector3();

function resetScanner(context: GameRuntimeContext) {
  context.scanner.active = false;
  context.scanner.focusId = null;
  context.scanner.focusEntryId = null;
  context.scanner.focusName = null;
  context.scanner.progress = 0;
}

export class ScannerSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "field-scanner";
  readonly order = 28;

  update(context: GameRuntimeContext, deltaSeconds: number) {
    if (context.input.consumeActionPressed("fieldGuide")) {
      context.toggleOperations();
    }
    if (!context.started || context.paused || !context.input.isActionDown("scanner")) {
      resetScanner(context);
      return;
    }
    context.scanner.active = true;
    context.camera.getWorldDirection(forward);
    const focused = selectScanCandidate(
      context.scanCandidates(),
      context.camera.position,
      forward,
      (candidate) => context.world.hasLineOfSight(
        context.camera.position,
        candidate.position,
        {
          ignoredColliderIds: [candidate.id],
          checkTerrain: true,
        },
      ),
    );
    if (!focused) {
      context.scanner.focusId = null;
      context.scanner.focusEntryId = null;
      context.scanner.focusName = null;
      context.scanner.progress = 0;
      return;
    }
    const { candidate } = focused;
    if (context.scanner.focusId !== candidate.id) {
      context.scanner.focusId = candidate.id;
      context.scanner.focusEntryId = candidate.entryId;
      context.scanner.focusName = candidate.name;
      context.scanner.progress = context.hasFieldGuideEntry(candidate.entryId) ? 1 : 0;
    }
    if (context.scanner.progress >= 1) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : 0;
    context.scanner.progress = Math.min(1, context.scanner.progress + delta / SCAN_HOLD_SECONDS);
    if (context.scanner.progress >= 1) context.completeScan(candidate.entryId);
  }
}
