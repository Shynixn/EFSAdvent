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
 * | `item-stand`    | `SWNP`| Item Stand   | TileObject |
 *
 * **Item Stand** is a *tile object*, not a loose pickup: it places an `SWNP`
 * actor whose `Item Stand Configuration` field (bits 14-17) selects which of the
 * ten inventory items (Pegasus Boots, Lantern, Boomerang, Bow, Hammer, Fire Rod,
 * Roc's Feather, Bombs, Shovel, Slingshot) sits on the stand. It also carries a
 * `Interaction Type` field, which must stay at `2` (`Item Stand`) or the actor
 * stops behaving as a stand, so only `Item Stand Configuration` is exposed and
 * the remaining bits are pinned to their defaults.
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
/** Actor id of the item stand (Switch-Related NPC). */
export const ITEM_STAND_ACTOR_ID = 'SWNP';

/** Stable smart-object id for the key. */
export const KEY_ID = 'key';
/** Stable smart-object id for the carrot. */
export const CARROT_ID = 'carrot';
/** Stable smart-object id for the force fairy. */
export const FORCE_FAIRY_ID = 'force-fairy';
/** Stable smart-object id for the item stand. */
export const ITEM_STAND_ID = 'item-stand';

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
  /** Restrict the generated context-menu groups to these actor field names. */
  only?: readonly string[];
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
      fields: actorFieldMenus(options.definition, {
        skipActivation: true,
        ...(options.only ? { only: options.only } : {}),
      }),
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
    itemStandDefinition(actors?.[ITEM_STAND_ACTOR_ID]),
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

/**
 * Variable bits 0-3 (`Interaction Type`) must stay at `2` for the actor to act
 * as an item stand.
 */
const ITEM_STAND_INTERACTION_ITEM_STAND = 2;

/**
 * Tileset id of the `Item pedestal` (tileproperties.json #23: "Can hold an item
 * on the top layer."). It is ordinary scenery the user paints, so it is only
 * PREVIEWED under the stand and never baked.
 */
export const ITEM_PEDESTAL_TILE = 23;

/**
 * Builds the Item Stand (`SWNP`) definition.
 *
 * Only `Item Stand Configuration` (bits 14-17) is exposed as a menu, because the
 * `Interaction Type` bits must remain `Item Stand` (2) for the actor to behave
 * correctly. The default variable therefore pins those bits, so the placed actor
 * works out of the box (Pegasus Boots on an item stand).
 *
 * @param definition The `SWNP` catalog entry, when loaded. Supplies the ten-item
 *   enum from `Item Stand Configuration`.
 */
export function itemStandDefinition(definition?: ActorDefinition): ItemSmartObjectDefinition {
  const stand = itemDefinition({
    id: ITEM_STAND_ID,
    name: 'Item Stand',
    actorId: ITEM_STAND_ACTOR_ID,
    actorVariable: ITEM_STAND_INTERACTION_ITEM_STAND,
    definition,
    only: ['Item Stand Configuration'],
  });
  // The pedestal is drawn UNDER the actor in the editor so the stand does not
  // appear to float. It stays out of `bottomLayerTiles` on purpose: the pedestal
  // is normal scenery the user paints, so plating the object must not stamp it.
  return {
    ...stand,
    set: [{
      bottomLayerTiles: [],
      topLayerTiles: [],
      previewTiles: [{ dRow: 0, dCol: 0, tile: ITEM_PEDESTAL_TILE }],
    }],
  };
}

/** The Item Stand definition without catalog metadata (no item menu). */
export const ITEM_STAND_DEFINITION: ItemSmartObjectDefinition = itemStandDefinition();

/** Static item definitions, used before the actor catalog is loaded. */
export const ITEM_DEFINITIONS: readonly ItemSmartObjectDefinition[] = [
  KEY_DEFINITION,
  CARROT_DEFINITION,
  FORCE_FAIRY_DEFINITION,
  ITEM_STAND_DEFINITION,
];
