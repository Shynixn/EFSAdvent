/**
 * Collectible item smart objects (Key, Carrot, Force Fairy).
 * --------------------------------------------------------
 * These wrap the game's own item actors so they can be dragged from the toolbox
 * "Items" section, hit-tested, moved and deleted through the shared smart-object
 * pipeline. They bake an **actor** (no tiles), exactly like the force gem.
 *
 * Actor ids (FSALib `assets/actors/*.json`):
 *
 * | Smart object id | Actor | Name         | Category |
 * |-----------------|-------|--------------|----------|
 * | `key`           | `KEY0`| Key          | Item     |
 * | `carrot`        | `NNJN`| Carrot       | Item     |
 * | `force-fairy`   | `FARY`| Fairy        | Item     |
 *
 * The context menus are generated from each actor's catalog fields
 * ({@link actorFieldMenus}), so the bit offsets, widths and enums come from the
 * real game data instead of a hand-copied list. Nothing is duplicated here: if
 * the catalog is missing, a definition simply has no field menus.
 *
 * This mirrors `force-gem.entity.ts` — an entity file exists (rather than being
 * generated purely from the actor category) because these items are a curated
 * toolbox section with their own ids and default variables.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';
import { actorFieldMenus } from './actor-fields.entity';

/** Actor id of the key. */
export const KEY_ACTOR_ID = 'KEY0';
/** Actor id of the carrot. */
export const CARROT_ACTOR_ID = 'NNJN';
/** Actor id of the fairy. */
export const FORCE_FAIRY_ACTOR_ID = 'FARY';

/** Stable smart-object id for the key. */
export const KEY_ID = 'key';
/** Stable smart-object id for the carrot. */
export const CARROT_ID = 'carrot';
/** Stable smart-object id for the force fairy. */
export const FORCE_FAIRY_ID = 'force-fairy';

/** A user-facing item definition: an actor-baked object with catalog menus. */
export type ItemSmartObjectDefinition = ActivatableSmartObjectDefinition;

/**
 * Builds one item definition from an actor catalog entry.
 *
 * The actor's own fields become the context-menu groups, minus `Activation
 * Variable` (bits 27-31), which belongs to the room-local activation system.
 */
function itemDefinition(options: {
  id: string;
  name: string;
  actorId: string;
  actorVariable?: number;
  definition?: ActorDefinition;
}): ItemSmartObjectDefinition {
  return {
    id: options.id,
    baking: 'actor',
    name: options.name,
    section: 'Items',
    actorId: options.actorId,
    // Every field starts at its catalog default (all zero) unless overridden.
    actorVariable: options.actorVariable ?? 0,
    placement: {
      fields: actorFieldMenus(options.definition, { skipActivation: true }),
    },
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/**
 * Builds the Key, Carrot and Force Fairy definitions from the actor catalog.
 *
 * @param actors Actor catalog keyed by 4-character id (`GetActors` output).
 *   Missing entries are tolerated: the object still places its actor, it just
 *   has no context-menu fields until the catalog is available.
 */
export function itemDefinitions(
  actors?: Record<string, ActorDefinition>,
): ItemSmartObjectDefinition[] {
  return [
    itemDefinition({
      id: KEY_ID,
      name: 'Key',
      actorId: KEY_ACTOR_ID,
      definition: actors?.[KEY_ACTOR_ID],
    }),
    itemDefinition({
      id: CARROT_ID,
      name: 'Carrot',
      actorId: CARROT_ACTOR_ID,
      definition: actors?.[CARROT_ACTOR_ID],
    }),
    itemDefinition({
      id: FORCE_FAIRY_ID,
      name: 'Force Fairy',
      actorId: FORCE_FAIRY_ACTOR_ID,
      definition: actors?.[FORCE_FAIRY_ACTOR_ID],
    }),
  ];
}

/** The Key definition without catalog metadata (no context-menu fields). */
export const KEY_DEFINITION: ItemSmartObjectDefinition = itemDefinition({
  id: KEY_ID,
  name: 'Key',
  actorId: KEY_ACTOR_ID,
});

/** The Carrot definition without catalog metadata. */
export const CARROT_DEFINITION: ItemSmartObjectDefinition = itemDefinition({
  id: CARROT_ID,
  name: 'Carrot',
  actorId: CARROT_ACTOR_ID,
});

/** The Force Fairy definition without catalog metadata. */
export const FORCE_FAIRY_DEFINITION: ItemSmartObjectDefinition = itemDefinition({
  id: FORCE_FAIRY_ID,
  name: 'Force Fairy',
  actorId: FORCE_FAIRY_ACTOR_ID,
});

/** Static item definitions, used before the actor catalog is loaded. */
export const ITEM_DEFINITIONS: readonly ItemSmartObjectDefinition[] = [
  KEY_DEFINITION,
  CARROT_DEFINITION,
  FORCE_FAIRY_DEFINITION,
];
