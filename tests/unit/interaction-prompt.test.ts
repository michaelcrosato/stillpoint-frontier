import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { interactionPromptFor } from "../../lib/game/gameplay/interactionPrompt";
import { DEFAULT_KEY_BINDINGS } from "../../lib/game/settings";
import type { WorldTarget } from "../../lib/game/world/ChunkManager";

function target(action: WorldTarget["action"], overrides: Partial<WorldTarget> = {}): WorldTarget {
  return {
    id: `target:${action}`,
    kind: action === "inspect" ? "inspectable" : action === "toggle" ? "door" : "resource",
    action,
    name: "Target",
    position: new THREE.Vector3(),
    root: new THREE.Group(),
    maxDistance: 4,
    hitsRequired: 3,
    hits: 1,
    ...overrides,
  };
}

describe("unified interaction prompts", () => {
  it("uses the rebound action key rather than hard-coded UI text", () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS, interact: "KeyP", harvest: "KeyH" };
    expect(interactionPromptFor(target("inspect"), bindings)).toMatchObject({ keyCode: "KeyP", verb: "READ / INSPECT" });
    expect(interactionPromptFor(target("harvest"), bindings)).toMatchObject({ keyCode: "KeyH", detail: "2 HITS" });
  });

  it("describes both door states and every existing action", () => {
    expect(interactionPromptFor(target("toggle", { open: false }), DEFAULT_KEY_BINDINGS).verb).toBe("OPEN DOOR");
    expect(interactionPromptFor(target("toggle", { open: true }), DEFAULT_KEY_BINDINGS).verb).toBe("CLOSE DOOR");
    expect(interactionPromptFor(target("collect"), DEFAULT_KEY_BINDINGS).verb).toBe("COLLECT");
    expect(interactionPromptFor(target("scan"), DEFAULT_KEY_BINDINGS).verb).toBe("RECOVER RECORD");
  });
});
