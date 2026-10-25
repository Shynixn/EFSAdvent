/**
 * Placeable smart objects
 * -----------------------
 * Some smart objects need more than "drop it at the anchor" — and more than
 * "move it / delete it" — for the room to stay consistent. The clearest example
 * is a **door**: moving one must re-point the `WARP` actors of every door that
 * pointed at its old tile, and deleting one must tear down both sides of every
 * connection it took part in.
 *
 * Rather than teaching every host (the room page, the clipboard, a future
 * importer) about doors, a definition opts in by carrying an {@link IPlaceable}
 * "placement" descriptor whose functions the owning `.entity.ts` module
 * implements. Hosts then only ever do:
 *
 * ```ts
 * const changes = applyMove(definition, from, to, this.smartObjects());
 * ```
 *
 * and never mention a specific object type.
 *
 * Each hook returns the placements that changed as a SIDE EFFECT, which the host
 * then writes back. A hook that needs nothing extra returns `[]`.
 */

import { SmartObjectDefinition } from '../smartobject.definition';
import type { SmartObjectPlacement } from '../smartobject.entity';

/** One `from`/`to` replacement pair produced by a lifecycle hook. */
export interface PlacementChange {
  /** The placement as it currently exists in the room. */
  from: SmartObjectPlacement;
  /** What it should become. */
  to: SmartObjectPlacement;
}

/** One option of a variable-backed context-menu field. */
export interface PlacementFieldChoice {
  /** Value stored in the actor `Variable`. */
  value: number;
  /** Display name shown in the menu. */
  label: string;
}

/**
 * A variable-backed field an object exposes in the context menu.
 *
 * The entity supplies the label, the options and the get/set pair, so the host
 * renders every field the same way and never decodes an object's bits itself.
 */
export interface PlacementField {
  /** Stable group id, e.g. `player-state`. */
  readonly id: string;
  /** Menu group label, e.g. `Player State`. */
  readonly label: string;
  /** The selectable options, in menu order. */
  readonly choices: readonly PlacementFieldChoice[];
  /** Reads the current value out of the placement's actor `Variable`. */
  readonly value: (placement: SmartObjectPlacement) => number;
  /** Returns the placement with `value` written. */
  readonly withValue: (placement: SmartObjectPlacement, value: number) => SmartObjectPlacement;
}

/** Placement lifecycle behaviour of a smart object. */
export interface IPlaceable {
  /**
   * Builds the placement(s) actually recorded when this object is dropped.
   *
   * Returns the placement to store — possibly the same object with
   * {@link SmartObjectPlacement.children} attached, as the Start does. Returning
   * the placement unchanged means "store it as-is".
   */
  readonly onPlace?: (placement: SmartObjectPlacement) => SmartObjectPlacement;

  /**
   * Reacts to this object being moved from one anchor to another.
   *
   * `placements` is the room's current list with the move ALREADY applied
   * (i.e. `from` replaced by `to`); `definition` describes the moved object.
   * Returns the other placements that must be rewritten — e.g. the `WARP`
   * children of doors that pointed at the old tile.
   */
  readonly onMove?: (
    from: SmartObjectPlacement,
    to: SmartObjectPlacement,
    placements: readonly SmartObjectPlacement[],
    definition: SmartObjectDefinition | undefined,
  ) => readonly PlacementChange[];

  /**
   * Reacts to this object being deleted.
   *
   * `placements` is the room's current list *before* the removal. Returns the
   * remaining placements that must be rewritten — e.g. clearing a door's child
   * `WARP` because the door it pointed at no longer exists.
   */
  readonly onDelete?: (
    deleted: SmartObjectPlacement,
    placements: readonly SmartObjectPlacement[],
  ) => readonly PlacementChange[];

  /**
   * Applies the NEXT rotation to a placement.
   *
   * The {@link IRotateable} descriptor only says how many orientations exist;
   * the owning entity decides how one is applied. A door restamps the next tile
   * variant and advances its child `WARP`'s type; the player start instead
   * repacks the facing bits of its actor `Variable`. Without this hook the
   * host would have to know which object needs which treatment.
   *
   * When absent, the host falls back to bumping `variantIndex` (correct for
   * plain tile-baked objects).
   */
  readonly onRotate?: (
    placement: SmartObjectPlacement,
    nextVariant: number,
    definition: SmartObjectDefinition,
  ) => SmartObjectPlacement;

  /**
   * Variable-backed fields this object exposes in the context menu.
   *
   * Lets an entity describe its own `Variable` layout (a player start's
   * `Player State`, the gem's `Gem Type`) instead of the host hard-coding one
   * menu group per object. Empty/absent means the object has no extra fields.
   */
  readonly fields?: readonly PlacementField[];

  /**
   * Whether this object can be CONNECTED to another (a door linking to a door).
   *
   * Only objects that opt in are walk targets for the connect drag and offer the
   * `Connect` / `Cancel connect` menu actions.
   */
  readonly connectable?: boolean;
}

/** A definition that carries placement behaviour. */
export interface PlaceableSmartObjectDefinition extends SmartObjectDefinition {
  /** Placement descriptor, or undefined when dropping is all it needs. */
  placement?: IPlaceable;
}

/** The placement descriptor of a definition, when it has one. */
export function placeableOf(definition: SmartObjectDefinition | undefined): IPlaceable | undefined {
  return (definition as PlaceableSmartObjectDefinition | undefined)?.placement;
}

/**
 * Runs a definition's placement hook, falling back to the placement as given.
 *
 * Hosts call this once, when an object is first dropped into a room.
 */
export function expandPlaced(
  definition: SmartObjectDefinition | undefined,
  placement: SmartObjectPlacement,
): SmartObjectPlacement {
  const hook = placeableOf(definition)?.onPlace;
  return hook ? hook(placement) : placement;
}

/**
 * Runs a definition's move hook, returning the placements that changed as a
 * side effect (empty when the object has no move behaviour).
 */
export function applyMove(
  definition: SmartObjectDefinition | undefined,
  from: SmartObjectPlacement,
  to: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): readonly PlacementChange[] {
  const hook = placeableOf(definition)?.onMove;
  return hook ? hook(from, to, placements, definition) : [];
}

/**
 * Runs a definition's delete hook, returning the placements that changed as a
 * side effect (empty when the object has no delete behaviour).
 */
export function applyDelete(
  definition: SmartObjectDefinition | undefined,
  deleted: SmartObjectPlacement,
  placements: readonly SmartObjectPlacement[],
): readonly PlacementChange[] {
  const hook = placeableOf(definition)?.onDelete;
  return hook ? hook(deleted, placements) : [];
}

/**
 * Applies one rotation to a placement via the definition's hook.
 *
 * Falls back to a plain `variantIndex` bump, which is what a tile-baked object
 * with a `set` per orientation needs. `nextVariant` must already be computed by
 * the caller from the {@link IRotateable} descriptor.
 */
export function applyRotation(
  definition: SmartObjectDefinition | undefined,
  placement: SmartObjectPlacement,
  nextVariant: number,
): SmartObjectPlacement {
  const hook = placeableOf(definition)?.onRotate;
  if (hook && definition) {
    return hook(placement, nextVariant, definition);
  }
  return { ...placement, variantIndex: nextVariant };
}

/** The variable-backed fields a definition exposes, or `[]` when it has none. */
export function fieldsOf(definition: SmartObjectDefinition | undefined): readonly PlacementField[] {
  return placeableOf(definition)?.fields ?? [];
}

/** Whether a definition can be connected to another object (e.g. a door). */
export function isConnectableDefinition(definition: SmartObjectDefinition | undefined): boolean {
  return placeableOf(definition)?.connectable === true;
}
