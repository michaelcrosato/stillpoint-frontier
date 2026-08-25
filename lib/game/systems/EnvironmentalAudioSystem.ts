import type { GameSystem } from "../core/SystemPipeline";
import { deriveAmbientMix, footstepSpacing, footstepSurfaceForBiome } from "../audio/model";
import { sampleClimate, settlementInfluence, nearestSettlement } from "../world/macroWorld";
import type { GameRuntimeContext } from "./runtime";

export class EnvironmentalAudioSystem implements GameSystem<GameRuntimeContext> {
  readonly id = "environmental-audio";
  readonly order = 46;
  private previousX: number | null = null;
  private previousZ: number | null = null;
  private distanceSinceStep = 0;

  update(context: GameRuntimeContext) {
    const atmosphere = context.environment.getSample();
    const climate = sampleClimate(context.player.position.x, context.player.position.z);
    const nearest = nearestSettlement(context.player.position.x, context.player.position.z);
    const influence = settlementInfluence(
      nearest.settlement,
      context.player.position.x,
      context.player.position.z,
    );
    const paused = !context.started || context.paused;
    context.audio.updateMix(deriveAmbientMix({
      windKph: atmosphere.windKph,
      precipitation: atmosphere.precipitation,
      precipitationRate: atmosphere.precipitationRate,
      night: atmosphere.night,
      biomeId: climate.biome.id,
      settlementInfluence: influence,
      animalActivity: context.animals.visibleCount > 0 ? 0.55 : 0,
      paused,
    }));

    const x = context.player.position.x;
    const z = context.player.position.z;
    if (this.previousX === null || this.previousZ === null || paused) {
      this.previousX = x;
      this.previousZ = z;
      this.distanceSinceStep = 0;
      return;
    }
    const distance = Math.hypot(x - this.previousX, z - this.previousZ);
    this.previousX = x;
    this.previousZ = z;
    if (!context.player.grounded || distance <= 0.0001) return;
    this.distanceSinceStep += distance;
    const spacing = footstepSpacing(context.player.sprinting, context.player.crouching);
    if (this.distanceSinceStep < spacing) return;
    this.distanceSinceStep %= spacing;
    context.audio.playFootstep(
      footstepSurfaceForBiome(climate.biome.id, context.player.sheltered),
      context.player.sprinting ? 1 : context.player.crouching ? 0.55 : 0.78,
    );
  }
}
