import * as THREE from "three";
import { SHADOW_MAP_SIZE, type QualityLevel } from "./config";

export interface EnvironmentRuntime {
  sun: THREE.DirectionalLight;
  sunTarget: THREE.Object3D;
  setQuality(quality: QualityLevel): void;
  updateAround(position: THREE.Vector3): void;
  dispose(): void;
}

export function createEnvironment(
  scene: THREE.Scene,
  quality: QualityLevel,
): EnvironmentRuntime {
  scene.background = new THREE.Color(0x171a18);
  scene.fog = new THREE.FogExp2(0x8f7657, 0.00365);

  const hemisphere = new THREE.HemisphereLight(0xe7cda0, 0x252722, 2.25);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffd5a0, 4.1);
  sun.position.set(-70, 92, 38);
  sun.castShadow = quality === "cinematic";
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -88;
  sun.shadow.camera.right = 88;
  sun.shadow.camera.top = 88;
  sun.shadow.camera.bottom = -88;
  sun.shadow.bias = -0.00015;
  const sunTarget = new THREE.Object3D();
  scene.add(sun, sunTarget);
  sun.target = sunTarget;

  const skyGeometry = new THREE.SphereGeometry(850, 32, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1c2526) },
      horizonColor: { value: new THREE.Color(0xc18d62) },
      groundColor: { value: new THREE.Color(0x594b3d) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color = h > 0.0
          ? mix(horizonColor, topColor, smoothstep(0.0, 0.72, h))
          : mix(horizonColor, groundColor, smoothstep(0.0, -0.32, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);

  return {
    sun,
    sunTarget,
    setQuality(nextQuality) {
      sun.castShadow = nextQuality === "cinematic";
    },
    updateAround(position) {
      sun.position.set(position.x - 70, position.y + 92, position.z + 38);
      sunTarget.position.set(position.x, 0, position.z);
      sky.position.copy(position);
    },
    dispose() {
      scene.remove(hemisphere, sun, sunTarget, sky);
      skyGeometry.dispose();
      skyMaterial.dispose();
    },
  };
}
