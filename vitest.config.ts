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
        "lib/game/world/geometry.ts",
        "lib/game/world/macroWorld.ts",
        "lib/game/world/roads.ts",
        "lib/game/citizens/citizenRecipes.ts",
        "lib/game/gameplay/items.ts",
        "lib/game/gameplay/interactions.ts",
        "lib/game/navigation/math.ts",
        "lib/game/navigation/NavigationService.ts",
        "lib/game/navigation/presentation.ts",
        "lib/game/environment/model.ts",
        "lib/game/world/fastTravel.ts",
        "lib/game/systems/EnvironmentSystem.ts",
        "lib/game/systems/collision.ts",
        "lib/game/systems/locomotion.ts",
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
