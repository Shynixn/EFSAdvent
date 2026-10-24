/**
 * Rotatable smart objects
 * -----------------------
 * Some smart objects can be rotated through a fixed set of orientations. Rather
 * than special-casing each one in the canvas, a definition opts in by carrying
 * an {@link IRotateable} "rotation" descriptor:
 *
 * - `defaultRotation` — the index used when the object is first placed (doors
 *   open facing north, the player start faces south).
 * - `rotationCount` — how many orientations exist (4 for both doors and the
 *   player start).
 *
 * The descriptor does not itself describe *how* a rotation is applied; that
 * stays in the owning domain module (a door needs its `WARP` child's type
 * advanced, the player start needs its actor `Variable` repacked). Callers ask
 * {@link rotationOf} for the descriptor and then delegate to the domain helper.
 */

import { SmartObjectDefinition } from '../smartobject.definition';

/** Rotation behaviour of a smart object that can be turned. */
export interface IRotateable {
  /** Rotation index applied when the object is placed (0-based). */
  readonly defaultRotation: number;
  /** Number of distinct orientations this object supports. */
  readonly rotationCount: number;
}

/**
 * Attaches rotation behaviour to a smart-object definition.
 *
 * A definition with `rotation: undefined` cannot be rotated; the canvas uses
 * {@link canRotate} to decide whether to offer the "Rotate" menu item.
 */
export interface RotateableSmartObjectDefinition extends SmartObjectDefinition {
  /** Rotation descriptor, or undefined when the object cannot be rotated. */
  rotation?: IRotateable;
}

/** The rotation descriptor of a definition, when it can be rotated. */
export function rotationOf(
  definition: SmartObjectDefinition | undefined,
): IRotateable | undefined {
  return (definition as RotateableSmartObjectDefinition | undefined)?.rotation;
}

/** Whether a definition can be rotated. */
export function canRotate(definition: SmartObjectDefinition | undefined): boolean {
  const rotation = rotationOf(definition);
  return !!rotation && rotation.rotationCount > 1;
}

/**
 * The orientation a definition starts in when placed, unless the definition has
 * no rotation descriptor (then 0).
 */
export function defaultRotationOf(definition: SmartObjectDefinition | undefined): number {
  return rotationOf(definition)?.defaultRotation ?? 0;
}

/** Advances a rotation index, wrapping at the definition's orientation count. */
export function nextRotation(
  definition: SmartObjectDefinition | undefined,
  current: number,
): number {
  const rotation = rotationOf(definition);
  if (!rotation || rotation.rotationCount <= 1) {
    return current;
  }
  return (current + 1) % rotation.rotationCount;
}
