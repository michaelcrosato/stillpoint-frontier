import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: [
        "lib/game/core/random.ts",
        "lib/game/core/SystemPipeline.ts",
        "lib/game/core/FeatureRegistry.ts",
        "lib/game/world/terrain.ts",
        "lib/game/systems/collision.ts",
        "lib/game/state.ts",
        "lib/game/persistence/SaveStore.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        lines: 88,
        functions: 88,
        branches: 82,
        statements: 88,
      },
    },
  },
});
