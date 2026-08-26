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
    uDaylight: { value: 1 },
    uGoldenHour: { value: 0 },
    uNight: { value: 0 },
    uCloudCover: { value: 0 },
    uPrecipitation: { value: 0 },
    uDust: { value: 0 },
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
    uniform float uDaylight;
    uniform float uGoldenHour;
    uniform float uNight;
    uniform float uCloudCover;
    uniform float uPrecipitation;
    uniform float uDust;
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

      // Keep the authored material palette intact while giving broad weather
      // and time states a restrained, readable presentation signature.
      float adaptiveStrength = clamp(uGradingStrength * 4.0, 0.0, 1.0);
      vec3 atmosphericBalance = mix(
        vec3(0.945, 0.982, 1.055),
        vec3(1.0),
        uDaylight
      );
      atmosphericBalance = mix(
        atmosphericBalance,
        vec3(1.085, 1.008, 0.885),
        uGoldenHour * 0.78
      );
      atmosphericBalance = mix(
        atmosphericBalance,
        vec3(1.07, 0.985, 0.86),
        uDust * 0.58
      );
      color *= mix(vec3(1.0), atmosphericBalance, adaptiveStrength * 0.62);

      float weatherDesaturation = clamp(
        uCloudCover * 0.045 +
        uPrecipitation * 0.105 +
        uNight * 0.035,
        0.0,
        0.16
      );
      luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(
        color,
        vec3(luminance),
        weatherDesaturation * adaptiveStrength
      );

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
    uDaylight: { value: number };
    uGoldenHour: { value: number };
    uNight: { value: number };
    uCloudCover: { value: number };
    uPrecipitation: { value: number };
    uDust: { value: number };
  };
};
