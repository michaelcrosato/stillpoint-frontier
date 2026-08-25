import * as THREE from "three";

/** Dedicated presentation layer; sources stay on layer zero for the main pass. */
export const BLOOM_LAYER = 1;

export function markBloomSource<T extends THREE.Object3D>(root: T): T {
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line ||
      object instanceof THREE.Sprite
    ) {
      object.layers.enable(BLOOM_LAYER);
    }
  });
  return root;
}

export const BloomCompositeShader = {
  name: "BloomCompositeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    varying vec2 vUv;
    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 bloom = texture2D(tBloom, vUv).rgb;
      gl_FragColor = vec4(source.rgb + bloom, source.a);
    }
  `,
};
