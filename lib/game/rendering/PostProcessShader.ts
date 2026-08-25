import * as THREE from "three";

/**
 * A deliberately small grade that stays independent from authored content.
 * It operates on the linear composer buffer; OutputPass remains responsible
 * for ACES tone mapping and output colour conversion exactly once.
 */
export const FieldGradeShader = {
  name: "FieldGradeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGradingStrength: { value: 0.2 },
    uVignetteStrength: { value: 0.075 },
    uDitherStrength: { value: 0.42 },
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
    uniform vec2 uResolution;
    uniform float uGradingStrength;
    uniform float uVignetteStrength;
    uniform float uDitherStrength;
    varying vec2 vUv;

    float interleavedGradientNoise(vec2 pixel) {
      return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;

      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 frontierGrade = mix(vec3(luminance), color, 0.93);
      frontierGrade *= vec3(1.018, 1.004, 0.978);
      color = mix(color, frontierGrade, uGradingStrength);

      vec2 centered = vUv * 2.0 - 1.0;
      float vignette = smoothstep(0.28, 1.42, dot(centered, centered));
      color *= 1.0 - vignette * uVignetteStrength;

      float noise = interleavedGradientNoise(gl_FragCoord.xy) - 0.5;
      color += noise * (uDitherStrength / 255.0);
      gl_FragColor = vec4(max(color, 0.0), source.a);
    }
  `,
} satisfies THREE.ShaderMaterialParameters & {
  name: string;
  uniforms: {
    tDiffuse: { value: THREE.Texture | null };
    uResolution: { value: THREE.Vector2 };
    uGradingStrength: { value: number };
    uVignetteStrength: { value: number };
    uDitherStrength: { value: number };
  };
};
