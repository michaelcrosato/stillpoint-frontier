import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { installProceduralSurfaceDetail } from "../../lib/game/rendering/ProceduralSurfaceDetail";
import { installVegetationWind } from "../../lib/game/rendering/VegetationWind";

/**
 * The shader hooks patch Three's shaders with String.replace, which returns the
 * input unchanged when a match string is missing. A Three upgrade that renames a
 * ShaderChunk would therefore fail silently, or worse, apply some replacements
 * and not others and leave undeclared identifiers behind.
 *
 * The other patch tests feed hand-written shader strings that contain the
 * expected includes, so they cannot catch that. These run the real installers
 * against the real shader source Three ships.
 */

type CapturedShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

function patchRealShader(install: (material: THREE.MeshStandardMaterial) => unknown) {
  const material = new THREE.MeshStandardMaterial();
  install(material);
  const shader: CapturedShader = {
    uniforms: {},
    // The real source Three would hand to onBeforeCompile for this material.
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  const before = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return { shader, before, material };
}

describe("shader hooks patch the shader source Three actually ships", () => {
  // The real regression guard. String.replace no-ops on a missed anchor, so a
  // Three upgrade that renames a ShaderChunk breaks the hooks silently - and
  // partially, leaving SURFACE_DETAIL_ROUGHNESS referencing identifiers that
  // SURFACE_DETAIL_COLOR never declared. Assert Three still ships every chunk
  // the installers patch against.
  it.each([
    ["fragment", "#include <common>"],
    ["fragment", "#include <color_fragment>"],
    ["fragment", "#include <roughnessmap_fragment>"],
    ["fragment", "#include <normal_fragment_maps>"],
    ["vertex", "#include <common>"],
    ["vertex", "#include <project_vertex>"],
  ])("three still ships %s %s", (stage, chunk) => {
    const source =
      stage === "fragment"
        ? THREE.ShaderLib.physical.fragmentShader
        : THREE.ShaderLib.physical.vertexShader;
    expect(source).toContain(chunk);
  });

  it("injects surface detail into the real physical fragment shader", () => {
    const { shader, before } = patchRealShader((material) =>
      installProceduralSurfaceDetail(material, {
        frequency: 0.25,
        colorStrength: 0.5,
        roughnessStrength: 0.5,
        normalStrength: 0.5,
        fadeStart: 40,
        fadeEnd: 210,
      }),
    );
    expect(shader.fragmentShader).not.toBe(before.fragment);
    expect(shader.fragmentShader).toContain("stillpointSurfaceDetail");
    expect(shader.fragmentShader).toContain("stillpointDhdx");
    expect(Object.keys(shader.uniforms).length).toBeGreaterThan(0);
  });

  it("injects vegetation wind into the real physical vertex shader", () => {
    const { shader, before } = patchRealShader((material) =>
      installVegetationWind(material, 1),
    );
    expect(shader.vertexShader).not.toBe(before.vertex);
    expect(shader.vertexShader).toContain("stillpointLocalWind");
    // The displacement must precede project_vertex, or it is discarded.
    expect(shader.vertexShader.indexOf("stillpointLocalWind")).toBeLessThan(
      shader.vertexShader.indexOf("#include <project_vertex>"),
    );
  });
});
