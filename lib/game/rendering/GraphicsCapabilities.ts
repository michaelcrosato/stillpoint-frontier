type GraphicsContext = WebGLRenderingContext | WebGL2RenderingContext;

function contextString(context: GraphicsContext, key: number) {
  try {
    return String(context.getParameter(key) ?? "UNKNOWN");
  } catch {
    return "UNAVAILABLE";
  }
}

/** Static GL queries run once per context lifetime, never once per frame. */
export class GraphicsCapabilities {
  snapshot = { defaultFramebufferSamples: 0, gpuVendor: "UNKNOWN", gpuRenderer: "UNKNOWN" };

  constructor(context: GraphicsContext) {
    this.refresh(context);
  }

  refresh(context: GraphicsContext) {
    let vendorKey: number = context.VENDOR;
    let rendererKey: number = context.RENDERER;
    let samples = 0;
    try {
      const extension = context.getExtension("WEBGL_debug_renderer_info");
      if (extension) {
        vendorKey = extension.UNMASKED_VENDOR_WEBGL;
        rendererKey = extension.UNMASKED_RENDERER_WEBGL;
      }
    } catch {
      // Privacy-restricted contexts can still supply masked identity strings.
    }
    try {
      samples = Number(context.getParameter(context.SAMPLES)) || 0;
    } catch {
      // Diagnostics must not prevent a privacy-restricted context from starting.
    }
    this.snapshot = {
      defaultFramebufferSamples: samples,
      gpuVendor: contextString(context, vendorKey),
      gpuRenderer: contextString(context, rendererKey),
    };
  }
}
