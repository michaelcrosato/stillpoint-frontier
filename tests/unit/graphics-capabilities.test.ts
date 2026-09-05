import { describe, expect, it, vi } from "vitest";
import { GraphicsCapabilities } from "../../lib/game/rendering/GraphicsCapabilities";

describe("cached graphics capabilities", () => {
  it("queries once, reads without GL work, and refreshes after context restore", () => {
    const context = {
      VENDOR: 1, RENDERER: 2, SAMPLES: 3,
      getExtension: vi.fn(() => ({ UNMASKED_VENDOR_WEBGL: 4, UNMASKED_RENDERER_WEBGL: 5 })),
      getParameter: vi.fn((key: number) => ({ 3: 4, 4: "Vendor", 5: "GPU" })[key]),
    };
    const cache = new GraphicsCapabilities(context as unknown as WebGL2RenderingContext);
    for (let index = 0; index < 100; index += 1) {
      expect(cache.snapshot).toEqual({ defaultFramebufferSamples: 4, gpuVendor: "Vendor", gpuRenderer: "GPU" });
    }
    expect(context.getExtension).toHaveBeenCalledTimes(1);
    expect(context.getParameter).toHaveBeenCalledTimes(3);
    cache.refresh(context as unknown as WebGL2RenderingContext);
    expect(context.getParameter).toHaveBeenCalledTimes(6);
  });
  it.each([false, true])("contains privacy restrictions (extension throws: %s)", (throws) => {
    const context = {
      VENDOR: 1, RENDERER: 2, SAMPLES: 3,
      getExtension: () => { if (throws) throw new Error("blocked"); return null; },
      getParameter: (key: number) => { if (throws) throw new Error("blocked"); return key === 1 ? "Masked" : null; },
    };
    const cache = new GraphicsCapabilities(context as unknown as WebGL2RenderingContext);
    expect(cache.snapshot.defaultFramebufferSamples).toBe(0);
    expect(cache.snapshot.gpuVendor).toBe(throws ? "UNAVAILABLE" : "Masked");
    expect(cache.snapshot.gpuRenderer).toBe(throws ? "UNAVAILABLE" : "UNKNOWN");
  });
});
