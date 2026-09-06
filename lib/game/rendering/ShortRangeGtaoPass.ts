import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

/** Limit AO range and restore every state changed by Three's optional pass. */
export class ShortRangeGtaoPass extends GTAOPass {
  private readonly savedClearColor = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly perspectiveCamera: THREE.PerspectiveCamera,
    private readonly maximumDistance: number,
  ) {
    super(scene, perspectiveCamera, 1, 1);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ) {
    const previousFar = this.perspectiveCamera.far;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousAutoClear = renderer.autoClear;
    const previousOverride = this.scene.overrideMaterial;
    const previousTarget = renderer.getRenderTarget();
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClearColor);
    this.perspectiveCamera.far = Math.min(previousFar, this.maximumDistance);
    this.perspectiveCamera.updateProjectionMatrix();
    renderer.shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      // Three r185 restores these only on success. Its visibility cache also
      // remembers which Points/Lines were visible, preserving hidden objects.
      // Keep this small internal adapter covered when upgrading Three.
      (this as unknown as { _restoreVisibility(): void })._restoreVisibility();
      this.scene.overrideMaterial = previousOverride;
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(this.savedClearColor, previousClearAlpha);
      renderer.setRenderTarget(previousTarget);
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      this.perspectiveCamera.far = previousFar;
      this.perspectiveCamera.updateProjectionMatrix();
    }
  }
}
