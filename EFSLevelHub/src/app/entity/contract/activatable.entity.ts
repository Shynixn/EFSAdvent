/**
 * Activatable smart objects
 * -------------------------
 * Some actor objects act as a **source** (something that happens) or a
 * **target** (something that reacts) in a room-local variable chain:
 *
 * ```
 *   GOL2 (imprisoning field, source)  --destroys-->  sets local variable N
 *   GOAL (end-of-level goal, target)  --waits on-->  local variable N
 * ```
 *
 * The link itself is NOT stored in the actors: both sides simply reference the
 * same room-local variable number (1–31). A definition opts into this system by
 * carrying an {@link IActivatable} descriptor:
 *
 * - `isTarget: false` — the object is a **source**; it *writes* a variable
 *   (`SetVariable`) when it triggers. This is what the "Activates" menu action
 *   starts a link from. Note: only one activation variable can be stored in a
 *   variable, so every link from one source splits that source's `SetVariable`
 *   across at most one variable — see {@link canAcceptMoreTargets}.
 * - `isTarget: true` — the object is a **target**; it *waits on* a variable
 *   (`ActivationVariable`).
 *
 * Links are tracked in the STAGE JSON (not in the archive), because the
 * variable numbers live only in the actor `Variable`s and the editor needs to
 * remember the user's intent across saves.
 */

import { SmartObjectDefinition } from '../smartobject.definition';

/** Which side of an activation link a definition can be. */
export interface IActivatable {
  /**
   * `true` when this object REACTS to a variable (draw no "Activates" option).
   * `false` when it SETS a variable and can therefore start links.
   */
  readonly isTarget: boolean;
}

/** A definition that participates in activation links. */
export interface ActivatableSmartObjectDefinition extends SmartObjectDefinition {
  /** Activation role, or undefined when the object is not activatable. */
  activatable?: IActivatable;
}

/** The activation role of a definition, when it is activatable. */
export function activatableOf(
  definition: SmartObjectDefinition | undefined,
): IActivatable | undefined {
  return (definition as ActivatableSmartObjectDefinition | undefined)?.activatable;
}

/** Whether a definition is an activation **source** (shows "Activates"). */
export function isActivationSource(definition: SmartObjectDefinition | undefined): boolean {
  const activatable = activatableOf(definition);
  return !!activatable && !activatable.isTarget;
}

/** Whether a definition is an activation **target**. */
export function isActivationTarget(definition: SmartObjectDefinition | undefined): boolean {
  return activatableOf(definition)?.isTarget === true;
}

/**
 * The room-local variables an activation source can write. A source has exactly
 * ONE `SetVariable` field, so it can drive one variable at a time — but that one
 * variable may feed many targets (a switch opening several gates), which is why
 * the link gesture allows drawing to multiple targets in sequence.
 */
export function canAcceptMoreTargets(): boolean {
  return true;
}

// --- Variable number packing ------------------------------------------------

/** Bits 27-31: Activation Variable (what a target waits on). */
export const ACTIVATION_VARIABLE_MASK = 0x1f;
const ACTIVATION_VARIABLE_SHIFT = 27;

/** Bits 22-26: Set Variable (what a source writes when triggered). */
export const SET_VARIABLE_MASK = 0x1f;
const SET_VARIABLE_SHIFT = 22;

/** Valid room-local variable numbers (0 = none/always-active). */
export const LOCAL_VARIABLE_MIN = 1;
export const LOCAL_VARIABLE_MAX = 31;

/** Reads the Activation Variable (bits 27-31) out of an actor `Variable`. */
export function decodeActivationVariable(variable: number): number {
  return ((variable >>> ACTIVATION_VARIABLE_SHIFT) & ACTIVATION_VARIABLE_MASK) >>> 0;
}

/** Writes the Activation Variable (bits 27-31), keeping every other field. */
export function encodeActivationVariable(variable: number, value: number): number {
  const cleared = (variable >>> 0) & ~(ACTIVATION_VARIABLE_MASK << ACTIVATION_VARIABLE_SHIFT);
  return (cleared | ((value & ACTIVATION_VARIABLE_MASK) << ACTIVATION_VARIABLE_SHIFT)) >>> 0;
}

/** Reads the Set Variable (bits 22-26) out of an actor `Variable`. */
export function decodeSetVariable(variable: number): number {
  return ((variable >>> SET_VARIABLE_SHIFT) & SET_VARIABLE_MASK) >>> 0;
}

/** Writes the Set Variable (bits 22-26), keeping every other field. */
export function encodeSetVariable(variable: number, value: number): number {
  const cleared = (variable >>> 0) & ~(SET_VARIABLE_MASK << SET_VARIABLE_SHIFT);
  return (cleared | ((value & SET_VARIABLE_MASK) << SET_VARIABLE_SHIFT)) >>> 0;
}

/**
 * Picks the lowest room-local variable number not present in `used`
 * (1-31), or `null` when the room has exhausted them all.
 */
export function findFreeLocalVariable(used: readonly number[]): number | null {
  const taken = new Set(
    used.filter((value) => value >= LOCAL_VARIABLE_MIN && value <= LOCAL_VARIABLE_MAX),
  );
  for (let value = LOCAL_VARIABLE_MIN; value <= LOCAL_VARIABLE_MAX; value++) {
    if (!taken.has(value)) {
      return value;
    }
  }
  return null;
}
