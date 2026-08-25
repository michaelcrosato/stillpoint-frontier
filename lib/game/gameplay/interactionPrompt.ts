import type { WorldTarget } from "../world/targets";
import type { KeyBindings } from "../settings";

export interface InteractionPromptDescriptor {
  keyCode: string;
  verb: string;
  detail: string | null;
}

export function interactionPromptFor(
  target: Readonly<WorldTarget>,
  bindings: Readonly<KeyBindings>,
): InteractionPromptDescriptor {
  switch (target.action) {
    case "harvest":
      return {
        keyCode: bindings.harvest,
        verb: "HARVEST RESOURCE",
        detail: `${Math.max(1, target.hitsRequired - target.hits)} HITS`,
      };
    case "toggle":
      return {
        keyCode: bindings.interact,
        verb: target.open ? "CLOSE DOOR" : "OPEN DOOR",
        detail: null,
      };
    case "collect":
      return { keyCode: bindings.interact, verb: "COLLECT", detail: null };
    case "inspect":
      return { keyCode: bindings.interact, verb: "READ / INSPECT", detail: null };
    case "craft":
      return { keyCode: bindings.interact, verb: "USE FABRICATOR", detail: "WORKBENCH" };
    case "loot":
      return {
        keyCode: bindings.interact,
        verb: target.empty ? "SEARCH EMPTY CONTAINER" : "OPEN CONTAINER",
        detail: null,
      };
    case "rest":
      return { keyCode: bindings.interact, verb: "REST / WAIT", detail: null };
    case "talk":
      return { keyCode: bindings.interact, verb: "SPEAK TO", detail: null };
    case "scan":
      if (target.fieldGuideId && !target.beaconId) {
        return {
          keyCode: bindings.scanner,
          verb: "HOLD FIELD SCANNER",
          detail: "CATALOG SUBJECT",
        };
      }
      return {
        keyCode: bindings.interact,
        verb: "RECOVER RECORD",
        detail: null,
      };
  }
}
