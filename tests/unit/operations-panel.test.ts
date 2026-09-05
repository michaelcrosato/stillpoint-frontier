import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OperationsPanel from "../../components/OperationsPanel";
import { INITIAL_SNAPSHOT } from "../../lib/game/state";
import { ALL_RECIPE_IDS } from "../../lib/game/gameplay/crafting";

function renderPanel(bedrolls: number) {
  return renderToStaticMarkup(createElement(OperationsPanel, {
    snapshot: {
      ...INITIAL_SNAPSHOT, unlockedRecipeIds: ALL_RECIPE_IDS,
      inventory: { ...INITIAL_SNAPSHOT.inventory, fiber: 3, bedroll: bedrolls },
    },
    initialTab: "crafting", station: "field",
    onClose() {}, onAcceptContract() {}, onTurnInContract() {}, onCraft() {},
  }));
}

describe("operations panel markup", () => {
  it("disables a full output stack and enables the same recipe when space is available", () => {
    expect(renderPanel(8)).toMatch(/<button[^>]*disabled=""[^>]*>BEDROLL STACK FULL<\/button>/);
    expect(renderPanel(7)).toMatch(/<button type="button">FABRICATE 1× BEDROLL<\/button>/);
  });

  it("connects the active tab, tab list, and focusable panel", () => {
    const html = renderPanel(0);
    expect(html).toContain('role="tablist" aria-label="Field operations sections"');
    expect(html).toMatch(/id="operations-tab-crafting"[^>]*aria-selected="true"[^>]*aria-controls="operations-content"[^>]*tabindex="0"[^>]*role="tab"/);
    expect(html).toMatch(/id="operations-tab-contracts"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toMatch(/id="operations-content"[^>]*role="tabpanel"[^>]*aria-labelledby="operations-tab-crafting"[^>]*tabindex="0"/);
  });
});
