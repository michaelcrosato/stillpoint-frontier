import type { ItemId } from "./items";

export type GameplayEvent =
  | { type: "item.collected"; item: ItemId; quantity: number }
  | { type: "item.crafted"; recipeId: string; item: ItemId; quantity: number }
  | { type: "item.used"; item: ItemId }
  | { type: "subject.scanned"; entryId: string }
  | { type: "object.inspected"; targetId: string }
  | { type: "container.looted"; containerId: string; quantity: number }
  | { type: "structure.placed"; archetypeId: string }
  | { type: "rest.completed"; siteId: string; minutes: number }
  | { type: "npc.talked"; npcId: string }
  | { type: "location.discovered"; locationId: string };
