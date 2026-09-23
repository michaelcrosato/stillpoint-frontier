import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createEnvironment } from "../../lib/game/environment";
import { BLOOM_LAYER } from "../../lib/game/rendering/Bloom";
import {
  CelestialDiscs,
  MOON_DISC_ANGULAR_RADIUS,
  SUN_DISC_ANGULAR_RADIUS,
} from "../../lib/game/rendering/CelestialDiscs";
import { RenderPipeline } from "../../lib/game/rendering/RenderPipeline";

function input(overrides: Partial<Parameters<CelestialDiscs["present"]>[0]> = {}) {
  return {
    viewPosition: new THREE.Vector3(10, 2, -4),
    sunDirection: new THREE.Vector3(0.6, 0.3, -0.74).normalize(),
    moonDirection: new THREE.Vector3(-0.6, -0.3, 0.74).normalize(),
    sunColor: new THREE.Color(0xffe2ae),
    moonColor: new THREE.Color(0xaabbd0),
    daylight: 1,
    night: 0,
    cloudCover: 0,
    distance: 1_600,
    ...overrides,
  };
}

describe("celestial discs", () => {
  it("draws only in the bloom pass", () => {
    const discs = new CelestialDiscs(new THREE.Scene());
    const bloomOnly = new THREE.Layers();
    bloomOnly.set(BLOOM_LAYER);
    expect(discs.sun.layers.mask).toBe(bloomOnly.mask);
    expect(discs.moon.layers.mask).toBe(bloomOnly.mask);
    discs.dispose();
  });

  it("sits along the sun direction at the requested distance, facing the view, at the sky's disc size", () => {
    const discs = new CelestialDiscs(new THREE.Scene());
    const state = input();
    discs.present(state);
    const expected = state.viewPosition.clone().addScaledVector(state.sunDirection, state.distance);
    expect(discs.sun.position.distanceTo(expected)).toBeLessThan(1e-6);
    expect(discs.sun.scale.x).toBeCloseTo(state.distance * Math.tan(SUN_DISC_ANGULAR_RADIUS), 6);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(discs.sun.quaternion);
    expect(facing.dot(state.sunDirection)).toBeCloseTo(-1, 6);
    expect(discs.sun.visible).toBe(true);
    discs.dispose();
  });

  it("tracks the sun disc colour and dims under cloud", () => {
    const discs = new CelestialDiscs(new THREE.Scene());
    const state = input();
    discs.present(state);
    const clear = discs.sun.material.color.clone();
    expect(clear.r / clear.b).toBeCloseTo(state.sunColor.r / state.sunColor.b, 6);
    expect(clear.r).toBeGreaterThan(1);
    discs.present(input({ cloudCover: 1 }));
    expect(discs.sun.material.color.r).toBeLessThan(clear.r);
    discs.dispose();
  });

  it("hides each disc below the horizon or outside its time of day", () => {
    const discs = new CelestialDiscs(new THREE.Scene());
    discs.present(input());
    expect(discs.moon.visible).toBe(false);
    discs.present(input({
      sunDirection: new THREE.Vector3(0.6, -0.3, -0.74).normalize(),
      moonDirection: new THREE.Vector3(-0.6, 0.3, 0.74).normalize(),
      daylight: 0,
      night: 1,
    }));
    expect(discs.sun.visible).toBe(false);
    expect(discs.moon.visible).toBe(true);
    expect(discs.moon.scale.x).toBeCloseTo(1_600 * Math.tan(MOON_DISC_ANGULAR_RADIUS), 6);
    discs.dispose();
  });

  it("is created and released with the environment", () => {
    const scene = new THREE.Scene();
    const renderer = {
      toneMappingExposure: 1,
      capabilities: { maxTextureSize: 8192 },
    } as unknown as THREE.WebGLRenderer;
    const environment = createEnvironment(scene, renderer, "cinematic");
    const sun = scene.getObjectByName("celestial-sun") as THREE.Mesh | undefined;
    expect(sun).toBeInstanceOf(THREE.Mesh);
    const disposeMaterial = vi.spyOn(sun!.material as THREE.Material, "dispose");
    environment.dispose();
    expect(scene.getObjectByName("celestial-sun")).toBeUndefined();
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });
});

describe("bloom pass sky handling", () => {
  it("hides objects marked hideInBloom for the bloom render and restores them", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
    sky.userData.hideInBloom = true;
    scene.add(sky);
    const visibleDuringBloom: boolean[] = [];
    const pipeline = Object.create(RenderPipeline.prototype) as RenderPipeline;
    Object.assign(pipeline, {
      options: { scene, camera },
      renderer: { shadowMap: { autoUpdate: true } },
      bloomBackground: new THREE.Color(0),
      bloomLayer: (() => { const layers = new THREE.Layers(); layers.set(BLOOM_LAYER); return layers; })(),
      bloomOccluderMaterial: new THREE.MeshBasicMaterial(),
      bloomMaterials: new Map(),
      bloomHidden: new Set(),
      bloomComposer: { render: () => visibleDuringBloom.push(sky.visible) },
      bloomCompositePass: { uniforms: { tBloom: { value: null } } },
      bloomPass: { renderTargetsHorizontal: [{ texture: null }] },
    });
    // The traversal callback is an instance arrow that delegates to darkenForBloom.
    Object.assign(pipeline, {
      darkenBloomOccluder: (object: THREE.Object3D) =>
        (RenderPipeline.prototype as unknown as { darkenForBloom(object: THREE.Object3D): void })
          .darkenForBloom.call(pipeline, object),
    });
    (pipeline as unknown as { renderSelectiveBloom(delta: number): void }).renderSelectiveBloom(0);
    expect(visibleDuringBloom).toEqual([false]);
    expect(sky.visible).toBe(true);
    expect(sky.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it("marks the sky dome to be hidden, not darkened, in the bloom pass", () => {
    const scene = new THREE.Scene();
    const renderer = {
      toneMappingExposure: 1,
      capabilities: { maxTextureSize: 8192 },
    } as unknown as THREE.WebGLRenderer;
    const environment = createEnvironment(scene, renderer, "cinematic");
    expect(scene.getObjectByName("atmosphere-sky")?.userData.hideInBloom).toBe(true);
    environment.dispose();
  });
});

describe("bloom pass camera layers", () => {
  it("sees bloom-only objects during the bloom render and not after", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const layersDuringBloom: number[] = [];
    const pipeline = Object.create(RenderPipeline.prototype) as RenderPipeline;
    Object.assign(pipeline, {
      options: { scene, camera },
      renderer: { shadowMap: { autoUpdate: true } },
      bloomBackground: new THREE.Color(0),
      darkenBloomOccluder: () => undefined,
      bloomMaterials: new Map(),
      bloomHidden: new Set(),
      bloomComposer: { render: () => layersDuringBloom.push(camera.layers.mask) },
      bloomCompositePass: { uniforms: { tBloom: { value: null } } },
      bloomPass: { renderTargetsHorizontal: [{ texture: null }] },
    });
    const before = camera.layers.mask;
    (pipeline as unknown as { renderSelectiveBloom(delta: number): void }).renderSelectiveBloom(0);
    const bloom = new THREE.Layers();
    bloom.set(BLOOM_LAYER);
    expect(layersDuringBloom).toHaveLength(1);
    expect(layersDuringBloom[0] & bloom.mask).toBe(bloom.mask);
    expect(camera.layers.mask).toBe(before);
  });
});
