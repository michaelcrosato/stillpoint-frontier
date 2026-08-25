import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BLOOM_LAYER, markBloomSource } from "../../lib/game/rendering/Bloom";
import { environmentMapSignature } from "../../lib/game/rendering/EnvironmentMapRuntime";
import { FieldGradeShader } from "../../lib/game/rendering/PostProcessShader";
import {
  composerSampleCount,
  gtaoIsSupported,
  renderPixelRatio,
} from "../../lib/game/rendering/RenderPipeline";

const environmentSample = () => ({
  cloudCover: 0.2,
  daylight: 0.8,
  goldenHour: 0.1,
  dust: 0,
  sunDirection: new THREE.Vector3(0.4, 0.8, 0.2).normalize(),
});

describe("rendering policy", () => {
  it("bounds DPR and offscreen MSAA against hardware budgets", () => {
    expect(renderPixelRatio(3, 2, 1_920, 1_080, 4_096)).toBe(2);
    expect(renderPixelRatio(2, 2, 4_000, 2_000, 4_096)).toBeCloseTo(1.024);
    expect(renderPixelRatio(1, 1, 10_000, 5_000, 1_024)).toBeCloseTo(0.1024);
    expect(renderPixelRatio(Number.NaN, 2, 0, 0, 8_192)).toBe(1);
    expect(composerSampleCount(8, 4)).toBe(4);
    expect(composerSampleCount(-2, 4)).toBe(0);
  });

  it("gates GTAO on logarithmic-depth fallbacks", () => {
    expect(gtaoIsSupported(true, false)).toBe(true);
    expect(gtaoIsSupported(true, true)).toBe(false);
    expect(gtaoIsSupported(false, false)).toBe(false);
  });

  it("marks bloom sources without removing their normal render layer", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);
    markBloomSource(root);
    expect(mesh.layers.test(new THREE.Layers())).toBe(true);
    const bloom = new THREE.Layers();
    bloom.set(BLOOM_LAYER);
    expect(mesh.layers.test(bloom)).toBe(true);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("keeps PMREM signatures stable inside buckets and invalidates broad changes", () => {
    const state = environmentSample();
    const first = environmentMapSignature(state, "cinematic");
    expect(environmentMapSignature({ ...state, cloudCover: 0.21 }, "cinematic"))
      .toBe(first);
    expect(environmentMapSignature({ ...state, cloudCover: 0.9 }, "cinematic"))
      .not.toBe(first);
    expect(environmentMapSignature(state, "ultra")).not.toBe(first);
  });

  it("uses deterministic linear grading before the output pass", () => {
    expect(FieldGradeShader.fragmentShader).toContain("interleavedGradientNoise");
    expect(FieldGradeShader.fragmentShader).not.toContain("uTime");
    expect(FieldGradeShader.fragmentShader).not.toContain("toneMapping");
  });
});
