/**
 * Goal (`GOAL`) smart object.
 * ---------------------------
 * Wraps the legacy "Goal" actor template from EFSAdvent's Specials list. It is
 * actor-baked (it places a `GOAL` actor, no tiles) and renders the goal sprite
 * through the shared actor pipeline.
 *
 * `GOAL` has NO shape field. Bits 0-7 are its `Type` FLAGS (bit 0 =
 * `Uses Variable`), and it declares `bitMask: 0` — the game draws ONE sprite for
 * it regardless of the variable. It is therefore purely an activation TARGET:
 *
 * ```
 * bit  0     Type: Uses Variable
 * bit 22-26  Set Variable        (must be non-zero to start HIDDEN)
 * bit 27-31  Activation Variable (the room-local variable it waits on)
 * ```
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';

/** The actor id of the goal. */
export const GOAL_ACTOR_ID = 'GOAL';

/** Stable smart-object id for the goal. */
export const GOAL_ID = 'goal';

/** The goal smart-object definition. */
export const GOAL_DEFINITION: ActivatableSmartObjectDefinition = {
  id: GOAL_ID,
  baking: 'actor',
  name: 'Goal',
  section: 'Decorations',
  actorId: GOAL_ACTOR_ID,
  // Matches the legacy template value (`V:0,0,0,0.`).
  actorVariable: 0,
  // NO shape descriptor: `GOAL` has no `Goal Shape` field — bits 0-7 are its
  // `Type` FLAGS, so offering a shape menu silently wrote flag bits and
  // corrupted the actor. The Goal is purely an activation TARGET.
  activatable: { isTarget: true },
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/** Whether a smart-object id refers to the goal. */
export function isGoal(id: string): boolean {
  return id === GOAL_ID;
}
