/**
 * Force Gem (`RUPY`) smart object.
 * --------------------------------
 * Wraps the legacy "Force Gem" actor template from EFSAdvent's Items list. It is
 * actor-baked (it places a `RUPY` actor, no tiles) and renders the gem sprite
 * through the shared actor pipeline.
 *
 * `RUPY`'s own field block:
 *
 * ```
 * bit  0-7   Gem Type            (see FORCE_GEM_TYPES)
 * bit  8-15  Frames to Appear
 * bit 16-23  Interaction Type
 * bit 27-31  Activation Variable
 * ```
 *
 * IMPORTANT — `Gem Type` is EIGHT bits wide (bits 0-7), not the four bits the
 * shared `Shape` contract assumes. The Shape menu would therefore mask the value
 * to 0-15 and silently drop the high half, so the gem carries its own `gemType`
 * descriptor instead of reusing {@link ShapeableSmartObjectDefinition}.
 */

import { SmartObjectPlacement } from '../smartobject.entity';
import { ActivatableSmartObjectDefinition } from '../contract/activatable.entity';
import { ShapeChoice } from '../contract/shapeable.entity';

/** The actor id of the force gem. */
export const FORCE_GEM_ACTOR_ID = 'RUPY';

/** Stable smart-object id for the force gem. */
export const FORCE_GEM_ID = 'force-gem';

/**
 * The selectable gem types (FSALib `RUPY` field `Gem Type`, bits 0-7).
 *
 * Values 16-18 exist in the actor definition but are flagged `Broken` — the
 * "Key / Big Key / Letter Invisible" gems render nothing and are excluded here
 * on purpose, so the editor cannot place an invisible unusable gem.
 */
export const FORCE_GEM_TYPES: ShapeChoice[] = [
  { value: 0, name: 'Small Green (1)' },
  { value: 1, name: 'Small Blue (5)' },
  { value: 2, name: 'Small Red (20)' },
  { value: 3, name: 'Small Purple (50)' },
  { value: 4, name: 'Green (100)' },
  { value: 5, name: 'Blue (150)' },
  { value: 6, name: 'Red (200)' },
  { value: 7, name: 'Purple (300)' },
  { value: 8, name: 'Big Green (1000)' },
  { value: 9, name: 'Big Blue (1500)' },
  { value: 10, name: 'Big Red (2000)' },
  { value: 11, name: 'Big Purple (3000)' },
];

/** Bit mask of the `Gem Type` field (bits 0-7) in the actor `Variable`. */
export const GEM_TYPE_BITS_MASK = 0xff;

/** The `Gem Type` submenu descriptor carried by the definition. */
export interface IGemType {
  /** Gem type applied when the object is placed. */
  readonly defaultType: number;
  /** The selectable gem types, in context-menu order. */
  readonly types: readonly ShapeChoice[];
  /** The context-menu group label. */
  readonly label: string;
}

/** A smart-object definition that exposes a `Gem Type` submenu. */
export interface GemTypeSmartObjectDefinition extends ActivatableSmartObjectDefinition {
  /** Gem-type descriptor, or undefined when the object has none. */
  gemType?: IGemType;
}

/**
 * The force-gem smart-object definition.
 *
 * `actorVariable` sets `Interaction Type = 3` (`Does not Despawn`) in bits 16-23
 * with `Gem Type 0` in bits 0-7 — the layout real stage archives use for a
 * collectible gem.
 *
 * NOTE ON THE LEGACY TEMPLATE: EFSAdvent's line is `V:0,0,0,1.`, which packs as
 * `0x01000000` because the `V` bytes are listed LSB-first (`packVariable(b4, b3,
 * b2, b1)`). That puts `1` in byte 4 (bits 24-31), NOT the interaction type — and
 * it is why copying the template literally produces a gem that cannot be picked
 * up. The template is a plain "spawn one green gem" preset, so the sensible
 * editor default is a normal collectible instead.
 */
export const FORCE_GEM_DEFINITION: GemTypeSmartObjectDefinition = {
  id: FORCE_GEM_ID,
  baking: 'actor',
  name: 'Force Gem',
  section: 'Items',
  actorId: FORCE_GEM_ACTOR_ID,
  // Interaction Type 3 (`Does not Despawn`), Gem Type 0 (Small Green).
  actorVariable: 3 << 16,
  gemType: { defaultType: 0, types: FORCE_GEM_TYPES, label: 'Gem Type' },
  // Describe the `Gem Type` field generically so the context menu renders it
  // like any other variable-backed field (no gem-specific menu code needed).
  placement: {
    fields: [
      {
        id: 'gem-type',
        label: 'Gem Type',
        choices: FORCE_GEM_TYPES.map((entry) => ({ value: entry.value, label: entry.name })),
        value: (placement) => decodeGemType(placement.actorVariable ?? 0),
        withValue: (placement, value) => withForceGemType(placement, value),
      },
    ],
  },
  set: [{ bottomLayerTiles: [], topLayerTiles: [] }],
};

/** The gem-type descriptor of a definition, when it has one. */
export function gemTypeOf(definition: { readonly id: string } | undefined): IGemType | undefined {
  if (!definition || definition.id !== FORCE_GEM_ID) {
    return undefined;
  }
  return FORCE_GEM_DEFINITION.gemType;
}

/** Reads the gem type (bits 0-7) out of an actor `Variable`. */
export function decodeGemType(variable: number): number {
  return (variable >>> 0) & GEM_TYPE_BITS_MASK;
}

/** Writes a gem type (bits 0-7), keeping every other field. */
export function encodeGemType(variable: number, gemType: number): number {
  return (((variable >>> 0) & ~GEM_TYPE_BITS_MASK) | (gemType & GEM_TYPE_BITS_MASK)) >>> 0;
}

/** Applies a new gem type to a force-gem placement. */
export function withForceGemType(
  placement: SmartObjectPlacement,
  gemType: number,
): SmartObjectPlacement {
  return {
    ...placement,
    actorVariable: encodeGemType(placement.actorVariable ?? 0, gemType),
  };
}

/** Whether a smart-object id refers to the force gem. */
export function isForceGem(id: string): boolean {
  return id === FORCE_GEM_ID;
}
