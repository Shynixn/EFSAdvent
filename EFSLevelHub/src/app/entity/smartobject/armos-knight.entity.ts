/**
 * Armos Knight (`AMOS`) smart object.
 * -----------------------------------
 * First enemy migrated from the legacy actor catalog to a first-class smart
 * object (see `rawiso/entitymig.md`).
 *
 * `AMOS`'s variable fields (from FSALib `assets/actors/AMOS.json`):
 *
 * ```
 * bit  0-3   Type               0 Default · 1 Pushable · 2 Fixed (Triggered)
 *                               3 Large, Default · 4 Large, Pushable
 *                               5 Large, Activated (Triggered) · 6 Fixed
 *                               7 Large, Fixed
 * bit  4     Double Size
 * bit  8-15  Rail ID
 * bit 27-31  Activation Variable
 * ```
 *
 * Bits 5-7 and 16-26 are unused and must be preserved by every field setter —
 * the shared encoder does that by masking only the target field.
 *
 * The context menu is generated from the catalog metadata, so it stays correct
 * if FSALib's definition gains options; there is no duplicated enum list here.
 */

import { ActorDefinition } from '../actor-definition.entity';
import { SmartObjectPlacement } from '../smartobject.entity';
import { PlaceableSmartObjectDefinition } from '../contract/placeable.entity';
import { actorFieldMenus } from './actor-fields.entity';

/** The actor id of the Armos Knight. */
export const ARMOS_KNIGHT_ACTOR_ID = 'AMOS';

/** Stable smart-object id for the Armos Knight. */
export const ARMOS_KNIGHT_ID = 'armos-knight';

/**
 * Builds the Armos Knight definition.
 *
 * Takes the actor catalog entry so the context menu comes from the real field
 * metadata rather than a hand-copied list. When the catalog is unavailable (or
 * predates field export) the enemy still places correctly, just without menus.
 *
 * @param definition The `AMOS` catalog entry, when loaded.
 */
export function armosKnightDefinition(
  definition?: ActorDefinition,
): PlaceableSmartObjectDefinition {
  return {
    id: ARMOS_KNIGHT_ID,
    baking: 'actor',
    name: 'Armos Knight',
    section: 'Enemies',
    actorId: ARMOS_KNIGHT_ACTOR_ID,
    // Default = 0 (standard behaviour), no double size, rail 0.
    actorVariable: 0,
    placement: {
      // `Activation Variable` belongs to the room-local activation system, which
      // this actor does not opt into yet, so it is not offered as a plain menu.
      fields: actorFieldMenus(definition, { skipActivation: true }),
    },
    // Actors bake no tiles — one empty variant keeps the shared geometry.
    set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
  };
}

/** Whether a smart-object id refers to the Armos Knight. */
export function isArmosKnight(id: string): boolean {
  return id === ARMOS_KNIGHT_ID;
}

/** Reads the Armos Knight `Type` (bits 0-3) out of a placement. */
export function armosKnightType(placement: SmartObjectPlacement): number {
  return (placement.actorVariable ?? 0) & 0x0f;
}
