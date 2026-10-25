/**
 * Lifecycle hooks for smart objects that need special handling.
 * -----------------------------------------------------------------
 * A definition may carry an {@link IPlaceable} descriptor (see
 * `contract/placeable.entity.ts`) whose hooks a host runs when the object is
 * placed, moved or deleted — without the host knowing what the object is.
 *
 * The hooks cannot live in `smartobject.definition.ts` itself: they are
 * implemented by `smartobject/door.entity.ts`, which imports the definition
 * module, so attaching them there would create an import cycle. They are wired
 * up HERE instead — a module that both sides can import freely — and applied
 * once at module load.
 *
 * Importing this module is what enables the behaviour, so the app imports it
 * from `smartobject.entity.ts` (which every host already depends on).
 */

import { SmartObjectDefinition } from '../smartobject.definition';
import { PlaceableSmartObjectDefinition } from './placeable.entity';
import {
  detachConnections,
  isDoorDefinition,
  reanchorConnections,
  withRotatedWarpType,
} from '../smartobject/door.entity';

/**
 * Installs the door lifecycle hooks on a definition.
 *
 * A door is the only object whose move/delete reaches beyond itself:
 * - **move** — every door whose `WARP` pointed at the old tile must be
 *   re-pointed at the new one, and the moved door's own target must have its
 *   back-reference refreshed;
 * - **delete** — both sides of every connection it took part in must be torn
 *   down, or a door would keep drawing a warp line to nothing.
 */
export function withDoorLifecycle<T extends SmartObjectDefinition>(definition: T): T {
  if (!isDoorDefinition(definition)) {
    return definition;
  }
  const placeable = definition as PlaceableSmartObjectDefinition;
  placeable.placement = {
    ...placeable.placement,
    // Only doors take part in the door-to-door connection system.
    connectable: true,
    // `placements` already has the move applied, which is exactly what
    // `reanchorConnections` expects (it skips the moved door itself).
    onMove: (from, to, placements, movedDefinition) => {
      const { references, repointed } = reanchorConnections(
        from,
        to,
        placements,
        movedDefinition,
      );
      return [...repointed, ...references];
    },
    onDelete: (deleted, placements) => detachConnections(deleted, placements),
    // A door's rotation also drives its child `WARP`'s warp type, so the sprite
    // facing and the connection direction stay in lock-step.
    onRotate: (placement, nextVariant, rotatedDefinition) =>
      withRotatedWarpType({ ...placement, variantIndex: nextVariant }, nextVariant, rotatedDefinition),
  };
  return definition;
}
