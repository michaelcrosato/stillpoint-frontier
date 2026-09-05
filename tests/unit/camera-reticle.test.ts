import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CameraReticle from "../../components/CameraReticle";
import { GamePresentationStore, INITIAL_PRESENTATION } from "../../lib/game/navigation/presentation";

describe("camera reticle presentation ownership", () => {
  it("uses projected aim even after the requested mode becomes first person", () => {
    const store = new GamePresentationStore();
    store.getServerSnapshot = store.getSnapshot;
    store.publish({ ...INITIAL_PRESENTATION, aimScreen: { visible: true, xPercent: 48, yPercent: 27 } });
    const html = renderToStaticMarkup(createElement(CameraReticle, { store, mode: "firstPerson", viewKey: "V" }));
    expect(html).toContain("camera-aim-reticle");
    expect(html).toContain("top:27%");
  });
  it("uses the center crosshair only at the actual eye-level endpoint", () => {
    const store = new GamePresentationStore();
    const html = renderToStaticMarkup(createElement(CameraReticle, { store, mode: "isometric", viewKey: "V" }));
    expect(html).toContain('class="crosshair"');
    expect(html).not.toContain("camera-aim-reticle");
  });
  it("hides aim when the gameplay ray is behind the render camera", () => {
    const store = new GamePresentationStore();
    store.getServerSnapshot = store.getSnapshot;
    store.publish({ ...INITIAL_PRESENTATION, aimScreen: { visible: false, xPercent: 50, yPercent: 50 } });
    expect(renderToStaticMarkup(createElement(CameraReticle, { store, mode: "thirdPerson", viewKey: "V" }))).toBe("");
  });
});
