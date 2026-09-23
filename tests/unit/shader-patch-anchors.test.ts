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

function balanced(source: string, openIndex: number, open: string, close: string) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close && --depth === 0) return source.slice(openIndex, index + 1);
  }
  throw new Error(`unbalanced ${open}${close} at ${openIndex}`);
}

/** Bodies of the `if` blocks whose condition names a patch identifier. */
function stillpointBranchBodies(source: string) {
  const bodies: string[] = [];
  for (const match of source.matchAll(/\bif\s*\(/g)) {
    const conditionStart = (match.index ?? 0) + match[0].length - 1;
    const condition = balanced(source, conditionStart, "(", ")");
    if (!/stillpoint/i.test(condition)) continue;
    const bodyStart = source.indexOf("{", conditionStart + condition.length);
    bodies.push(balanced(source, bodyStart, "{", "}"));
  }
  return bodies;
}

/** Bodies of the functions the patch defines. */
function stillpointFunctionBodies(source: string) {
  return [...source.matchAll(/\b(?:float|vec[234]|void)\s+stillpoint\w*\s*\([^)]*\)\s*\{/g)]
    .map((match) => balanced(source, (match.index ?? 0) + match[0].length - 1, "{", "}"));
}

describe("shader hooks patch the shader source Three actually ships", () => {
  // Derivatives are undefined inside control flow that differs between the
  // fragments of a 2x2 quad, which every distance guard here does.
  it("keeps every surface-detail derivative in uniform control flow", () => {
    const { shader } = patchRealShader((material) =>
      installProceduralSurfaceDetail(material, {
        frequency: 0.25,
        colorStrength: 0.5,
        roughnessStrength: 0.5,
        normalStrength: 0.5,
        fadeStart: 40,
        fadeEnd: 210,
      }),
    );
    const derivative = /\b(?:dFdx|dFdy|fwidth)\s*\(/;
    const branches = stillpointBranchBodies(shader.fragmentShader);
    expect(branches.length).toBeGreaterThanOrEqual(4);
    for (const body of branches) expect(body).not.toMatch(derivative);
    // The branches call these, so they may not differentiate either.
    const functions = stillpointFunctionBodies(shader.fragmentShader);
    expect(functions.length).toBeGreaterThanOrEqual(3);
    for (const body of functions) expect(body).not.toMatch(derivative);
  });

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
