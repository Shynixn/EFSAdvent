/**
 * Imprisoning Field (`GOL2`) smart object.
 * ----------------------------------------
 * Wraps the legacy "Evil Imprisoning Field" actor template. It is actor-baked
 * (it places a `GOL2` actor, no tiles) and exposes the actor's **Goal Shape**
 * field as a `Shape` submenu:
 *
 * ```
 * bit 0-3  Goal Shape   0 Square · 1 Diamond · 2 Horizontal Row
 *                       3 Vertical Row · 4 Semicircle · 5 Maid
 * ```
 *
 * The remaining fields of `GOL2` (activation state / variables) are preserved
 * when the shape changes.
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import {
  ShapeChoice,
  ShapeableSmartObjectDefinition,
  decodeShape,
  encodeShape,
} from '../contract/shapeable.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';

/** The actor id of the imprisoning field. */
export const IMPRISONING_FIELD_ACTOR_ID = 'GOL2';

/** Stable smart-object id for the imprisoning field. */
export const IMPRISONING_FIELD_ID = 'imprisoning-field';

/** The selectable field shapes (GOL2 `Goal Shape`, bits 0-3). */
export const IMPRISONING_FIELD_SHAPES: ShapeChoice[] = [
  { value: 0, name: 'Square' },
  { value: 1, name: 'Diamond' },
  { value: 2, name: 'Horizontal Row' },
  { value: 3, name: 'Vertical Row' },
  { value: 4, name: 'Semicircle' },
  { value: 5, name: 'Maid' },
];

/**
 * The imprisoning-field smart-object definition.
 *
 * `actorVariable` mirrors the legacy template (`V:0,0,0,2.`) — byte 4 = 2 puts
 * the field on the "Active Variable" activation state, matching EFSAdvent.
 */
export const IMPRISONING_FIELD_DEFINITION: ShapeableSmartObjectDefinition &
  ActivatableSmartObjectDefinition = {
  id: IMPRISONING_FIELD_ID,
  baking: 'actor',
  name: 'Imprisoning Field',
  section: 'Decorations',
  actorId: IMPRISONING_FIELD_ACTOR_ID,
  actorVariable: 2 << 24,
  shape: { defaultShape: 0, shapes: IMPRISONING_FIELD_SHAPES },
  // The field is an activation SOURCE: destroying it sets a room-local variable
  // which the end-of-level Goal waits on.
  activatable: { isTarget: false },
  // Actors bake no tiles — one empty variant keeps the shared geometry.
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/** Applies a new shape to an imprisoning-field placement. */
export function withImprisoningFieldShape(
  placement: SmartObjectPlacement,
  shape: number,
): SmartObjectPlacement {
  return {
    ...placement,
    variantIndex: 0,
    actorVariable: encodeShape(placement.actorVariable ?? 0, shape),
  };
}

/** Whether a smart-object id refers to the imprisoning field. */
export function isImprisoningField(id: string): boolean {
  return id === IMPRISONING_FIELD_ID;
}

/** The shape index a placement currently uses. */
export function imprisoningFieldShape(placement: SmartObjectPlacement): number {
  return decodeShape(placement.actorVariable ?? 0);
}
