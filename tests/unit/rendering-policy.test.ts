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

  it("compares PMREM signatures as numbers, not per-frame strings", () => {
    const state = environmentSample();
    expect(typeof environmentMapSignature(state, "cinematic")).toBe("number");
    expect(environmentMapSignature({ ...state }, "cinematic"))
      .toBe(environmentMapSignature(state, "cinematic"));
  });

  it("keeps a stable signature for non-finite input instead of recapturing every frame", () => {
    const hostile = {
      ...environmentSample(),
      dust: Number.NaN,
      sunDirection: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
    };
    const signature = environmentMapSignature(hostile, "cinematic");
    expect(Number.isFinite(signature)).toBe(true);
    expect(environmentMapSignature(hostile, "cinematic")).toBe(signature);
  });

  it("gives every distinct bucket combination a distinct signature", () => {
    const qualities = ["performance", "cinematic", "ultra"] as const;
    const direction = new THREE.Vector3();
    const buckets = new Set<string>();
    const signatures = new Set<number>();
    for (const quality of qualities) {
      for (let daylight = 0; daylight <= 5; daylight += 1) {
        for (let golden = 0; golden <= 3; golden += 1) {
          for (let cloud = 0; cloud <= 3; cloud += 1) {
            for (let dust = 0; dust <= 2; dust += 1) {
              for (let elevation = 0; elevation <= 7; elevation += 1) {
                for (let azimuth = 0; azimuth < 12; azimuth += 1) {
                  // Stay off the poles, where azimuth is undefined.
                  const y = THREE.MathUtils.clamp((elevation / 7) * 2 - 1, -0.99, 0.99);
                  const angle = (azimuth / 12) * Math.PI * 2 - Math.PI;
                  const radius = Math.sqrt(1 - y * y);
                  direction.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
                  buckets.add([quality, daylight, golden, cloud, dust, elevation, azimuth].join(":"));
                  signatures.add(Number(environmentMapSignature({
                    daylight: daylight / 5,
                    goldenHour: golden / 3,
                    cloudCover: cloud / 3,
                    dust: dust / 2,
                    sunDirection: direction,
                  }, quality)));
                }
              }
            }
          }
        }
      }
    }
    expect(buckets.size).toBe(3 * 6 * 4 * 4 * 3 * 8 * 12);
    expect(signatures.size).toBe(buckets.size);
  });

  it("uses deterministic linear grading before the output pass", () => {
    expect(FieldGradeShader.fragmentShader).toContain("interleavedGradientNoise");
    expect(FieldGradeShader.fragmentShader).toContain("uGoldenHour");
    expect(FieldGradeShader.fragmentShader).toContain("uPrecipitation");
    expect(FieldGradeShader.fragmentShader).toContain("uLightningFlash");
    expect(FieldGradeShader.fragmentShader).toContain("weatherDesaturation");
    expect(FieldGradeShader.uniforms.uDaylight.value).toBe(1);
    expect(FieldGradeShader.uniforms.uDust.value).toBe(0);
    expect(FieldGradeShader.uniforms.uLightningFlash.value).toBe(0);
    expect(FieldGradeShader.fragmentShader).not.toContain("uTime");
    expect(FieldGradeShader.fragmentShader).not.toContain("toneMapping");
  });
});
