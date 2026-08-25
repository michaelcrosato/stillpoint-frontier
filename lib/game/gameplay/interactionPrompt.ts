import type { WorldTarget } from "../world/ChunkManager";
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
  if (target.action === "harvest") {
    return {
      keyCode: bindings.harvest,
      verb: "HARVEST RESOURCE",
      detail: `${Math.max(1, target.hitsRequired - target.hits)} HITS`,
    };
  }
  if (target.action === "toggle") {
    return {
      keyCode: bindings.interact,
      verb: target.open ? "CLOSE DOOR" : "OPEN DOOR",
      detail: null,
    };
  }
  if (target.action === "collect") {
    return { keyCode: bindings.interact, verb: "COLLECT", detail: null };
  }
  if (target.action === "inspect") {
    return { keyCode: bindings.interact, verb: "READ / INSPECT", detail: null };
  }
  return { keyCode: bindings.interact, verb: "RECOVER RECORD", detail: null };
}
