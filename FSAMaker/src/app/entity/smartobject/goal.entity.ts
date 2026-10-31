/**
 * Goal (`GOL2`) smart object.
 * ---------------------------
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
 *
 * NOTE: this object is deliberately NOT activatable. The activation-link system
 * (`contract/activatable.entity.ts` + `smartobject/activation.entity.ts`) is
 * kept in place for a future source/target pair, but the Goal no longer opts
 * into it — so no "Activates" link action is offered for it.
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import {
  ShapeChoice,
  ShapeableSmartObjectDefinition,
  decodeShape,
  encodeShape,
} from '../contract/shapeable.entity';

/** The actor id of the goal. */
export const GOAL_ACTOR_ID = 'GOL2';

/** Stable smart-object id for the goal. */
export const GOAL_ID = 'goal';

/**
 * The selectable goal shapes (`GOL2` `Goal Shape`, bits 0-3).
 *
 * `Maid` (value 5) is deliberately NOT offered: it is a leftover debug/quest
 * shape that does not behave as an end-of-level goal.
 */
export const GOAL_SHAPES: ShapeChoice[] = [
  { value: 0, name: 'Square' },
  { value: 1, name: 'Diamond' },
  { value: 2, name: 'Horizontal Row' },
  { value: 3, name: 'Vertical Row' },
  { value: 4, name: 'Semicircle' },
];

/**
 * The goal smart-object definition.
 *
 * `actorVariable` mirrors the legacy template (`V:0,0,0,2.`) — byte 4 = 2 puts
 * the object on the "Active Variable" activation state, matching EFSAdvent.
 */
export const GOAL_DEFINITION: ShapeableSmartObjectDefinition = {
  id: GOAL_ID,
  baking: 'actor',
  name: 'Goal',
  section: 'Decorations',
  actorId: GOAL_ACTOR_ID,
  actorVariable: 2 << 24,
  shape: { defaultShape: 0, shapes: GOAL_SHAPES },
  // Describe `Goal Shape` generically so the context menu renders it like any
  // other variable-backed field, without goal-specific menu code.
  placement: {
    fields: [
      {
        id: 'shape',
        label: 'Shape',
        choices: GOAL_SHAPES.map((entry) => ({ value: entry.value, label: entry.name })),
        value: (placement) => goalShape(placement),
        withValue: (placement, value) => withGoalShape(placement, value),
      },
    ],
  },
  // Actors bake no tiles — one empty variant keeps the shared geometry.
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/** Applies a new shape to a goal placement. */
export function withGoalShape(
  placement: SmartObjectPlacement,
  shape: number,
): SmartObjectPlacement {
  return {
    ...placement,
    variantIndex: 0,
    actorVariable: encodeShape(placement.actorVariable ?? 0, shape),
  };
}

/** Whether a smart-object id refers to the goal. */
export function isGoal(id: string): boolean {
  return id === GOAL_ID;
}

/** The shape index a goal placement currently uses. */
export function goalShape(placement: SmartObjectPlacement): number {
  return decodeShape(placement.actorVariable ?? 0);
}
