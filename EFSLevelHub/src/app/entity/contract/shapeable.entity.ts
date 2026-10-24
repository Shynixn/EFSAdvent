/**
 * Shaped smart objects
 * --------------------
 * Some actor-baked smart objects pick their layout from a `Shape` enum packed
 * into the actor `Variable` (bits 0-3 of `FSALib`'s `Goal Shape` field). A
 * definition opts in by carrying an {@link IShapeable} descriptor:
 *
 * - `defaultShape` — the shape index used when the object is first placed.
 * - `shapes` — the selectable shapes, in menu order.
 *
 * The descriptor does not apply the change itself; the owning domain module
 * repacks the actor `Variable` (see e.g. `withImprisoningFieldShape`).
 */

import { SmartObjectDefinition } from '../smartobject.definition';

/** One selectable value of an actor's `Shape` field. */
export interface ShapeChoice {
  /** Shape index stored in the actor `Variable` (bits 0-3). */
  value: number;
  /** Display name shown in the context menu. */
  name: string;
}

/** Shape behaviour of a smart object. */
export interface IShapeable {
  /** Shape index applied when the object is placed. */
  readonly defaultShape: number;
  /** The selectable shapes, in context-menu order. */
  readonly shapes: readonly ShapeChoice[];
}

/** A smart-object definition that exposes a `Shape` submenu. */
export interface ShapeableSmartObjectDefinition extends SmartObjectDefinition {
  /** Shape descriptor, or undefined when the object has no shapes. */
  shape?: IShapeable;
}

/** The shape descriptor of a definition, when it has shapes. */
export function shapeOf(
  definition: SmartObjectDefinition | undefined,
): IShapeable | undefined {
  return (definition as ShapeableSmartObjectDefinition | undefined)?.shape;
}

/** Whether a definition offers shape choices. */
export function canShape(definition: SmartObjectDefinition | undefined): boolean {
  const shape = shapeOf(definition);
  return !!shape && shape.shapes.length > 1;
}

/** The shape index a definition starts with (0 when it has no shapes). */
export function defaultShapeOf(definition: SmartObjectDefinition | undefined): number {
  return shapeOf(definition)?.defaultShape ?? 0;
}

/** Bit mask of the `Shape` field (bits 0-3) in the actor `Variable`. */
export const SHAPE_BITS_MASK = 0x0f;

/** Reads the shape index out of an actor `Variable`. */
export function decodeShape(variable: number): number {
  return (variable >>> 0) & SHAPE_BITS_MASK;
}

/** Writes a shape index into an actor `Variable`, keeping every other field. */
export function encodeShape(variable: number, shape: number): number {
  return (((variable >>> 0) & ~SHAPE_BITS_MASK) | (shape & SHAPE_BITS_MASK)) >>> 0;
}
