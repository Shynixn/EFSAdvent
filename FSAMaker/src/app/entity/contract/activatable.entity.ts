/**
 * Activatable smart objects
 * -------------------------
 * Some actor objects act as a **source** (something that happens) or a
 * **target** (something that reacts) in a room-local variable chain:
 *
 * ```
 *   GOL2 (goal, source)   --destroys-->  sets local variable N
 *   GOAL (target)         --waits on-->  local variable N
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
  /**
   * `true` when becoming a target must ALSO switch the object into
   * "uses a variable" mode — turn on `Type` bit 0 and give it its own non-zero
   * `Set Variable` (bits 22-26).
   *
   * That combination is what makes an object start HIDDEN and appear only once
   * the source sets the shared variable: every gated `GOAL` in the shipped
   * levels is exactly `0x81C00001` (Uses Variable + Set Variable 7 + Activation
   * Variable 16), against an ungated `0x00000000`.
   *
   * Only a definition whose `Type` field really does carry a "Uses Variable"
   * flag should set this — writing bit 0 on an actor that uses bits 0-7 for
   * something else (e.g. `GOL2`'s `Goal Shape`) corrupts that field.
   */
  readonly usesVariable?: boolean;
  /**
   * `Interaction Type` value (bits 16-23) that makes this actor appear only
   * once its `Activation Variable` is set.
   *
   * For the Force Gem (`RUPY`) that is `26` — *"Appears, activated by
   * variable"*. Applying it turns a plain collectible into an activation
   * TARGET, and clearing it restores the plain behaviour.
   *
   * Undefined when the actor has no interaction-type driven target mode; such a
   * definition is a target purely through its `Activation Variable` bits.
   */
  readonly activatedInteractionType?: number;
  /**
   * `Interaction Type` value to restore when the object stops being a target.
   *
   * Defaults to the value the definition is placed with, so unlinking returns
   * the actor to the state the user originally placed.
   */
  readonly inactiveInteractionType?: number;
  /**
   * Bit offset of the `Set Variable` field **for actors whose layout differs
   * from the usual bits 22-26**.
   *
   * Most sources (e.g. `GOL2`) write a variable in bits 22-26, which is the
   * default. The floor switch (`SWTH`) is different: its catalog calls the field
   * `Triggered Local Variable` and puts it at bits **27-31** — the same bits
   * almost every other actor uses for `Activation Variable`. Writing 22-26 on a
   * switch scribbles over `Vertical Trigger Area`, so the switch sets nothing
   * and linked targets never appear.
   *
   * Omit to keep the standard 22-26 location.
   */
  readonly setVariableBitOffset?: number;
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

/** Alias for {@link isActivationSource}: a source *activates* other objects. */
export const isActivator = isActivationSource;

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

/** Bits 16-23: `Interaction Type` (how an item actor appears/behaves). */
export const INTERACTION_TYPE_MASK = 0xff;
const INTERACTION_TYPE_SHIFT = 16;

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
 * Like {@link encodeSetVariable}, but writes at an arbitrary bit offset.
 *
 * Needed for actors whose "variable I trigger" field is NOT bits 22-26 — the
 * floor switch (`SWTH`) keeps it at bits 27-31.
 */
export function encodeSetVariableAt(variable: number, value: number, bitOffset: number): number {
  const cleared = (variable >>> 0) & ~(SET_VARIABLE_MASK << bitOffset);
  return (cleared | ((value & SET_VARIABLE_MASK) << bitOffset)) >>> 0;
}

/** Reads the triggered variable from an arbitrary bit offset. */
export function decodeSetVariableAt(variable: number, bitOffset: number): number {
  return ((variable >>> bitOffset) & SET_VARIABLE_MASK) >>> 0;
}

/** Reads the `Interaction Type` (bits 16-23) out of an actor `Variable`. */
export function decodeInteractionType(variable: number): number {
  return ((variable >>> INTERACTION_TYPE_SHIFT) & INTERACTION_TYPE_MASK) >>> 0;
}

/** Writes the `Interaction Type` (bits 16-23), keeping every other field. */
export function encodeInteractionType(variable: number, value: number): number {
  const cleared = (variable >>> 0) & ~(INTERACTION_TYPE_MASK << INTERACTION_TYPE_SHIFT);
  return (cleared | ((value & INTERACTION_TYPE_MASK) << INTERACTION_TYPE_SHIFT)) >>> 0;
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
