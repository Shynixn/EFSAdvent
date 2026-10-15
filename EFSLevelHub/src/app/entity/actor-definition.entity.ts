/**
 * Actor definitions
 * -----------------
 * A projected view of FSALib's actor catalog (`assets/actors/*.json`), as
 * returned by the WASM `GetActors` export. Every placed actor references one of
 * these by its 4-character id.
 *
 * Property names are PascalCase because System.Text.Json serializes C# property
 * names as-is (no camelCase policy), matching the other WASM DTOs.
 *
 * The same catalog drives the editor's **Enemies** toolbox section and the
 * on-canvas actor rendering: each definition maps a `Variable` value (masked by
 * `BitMask`) to one or more render variants that pick a sprite (via the SOB
 * sprite-attribute lists) or a raw BTI texture.
 */

/** How an actor definition maps to on-screen resources. */
export interface ActorRenderVariant {
  /** Pixel offset applied when drawing (may be negative). */
  XOffset: number;
  YOffset: number;
  /** Scale applied to the sprite. */
  XScale: number;
  YScale: number;
  /** Rotation in degrees. */
  Rotation: number;
  /** Sprite index inside the SOB attribute list (-1 selects the BTI path). */
  SpriteIndex: number;
  /** Which SOB sprite-attribute list to use. */
  SpriteListIndex: number;
  /** Palette index to read from (-1 = all). */
  ReplacementPaletteIndex: number;
  /** Palette index to replace (-1 = all). */
  TargetPaletteIndex: number;
  /** Raw BTI texture drawn when `SpriteIndex` is -1. */
  BtiFile: string;
}

/** One `Variable & BitMask` key and the variants drawn for it. */
export interface ActorRenderKey {
  Key: number;
  Variants: ActorRenderVariant[];
}

/** A single actor type in the editor catalog. */
export interface ActorDefinition {
  /** 4-character actor id (e.g. `AMOS`). */
  Id: string;
  Name: string;
  Description: string;
  InternalName: string;
  /** Category name, e.g. `Enemy`, `Boss`, `NPC`, `Object`, `Item`. */
  Category: string;
  /** Whether the actor has no GBA-variant sprite. */
  NoGBASprite: boolean;
  /** Level resource names used to locate the actor's sprite files. */
  Resources: string[];
  /** Bit mask applied to `Actor.Variable` to pick a render key. */
  BitMask: number;
  /**
   * Render variants keyed by `Variable & BitMask`. Omitted entirely for actors
   * that define no variants (the WASM JSON drops null/empty properties).
   */
  Rendering?: ActorRenderKey[];
}

/** Resolves the render variants a variable value selects (bit mask aware). */
export function actorVariants(
  definition: ActorDefinition,
  variable: number,
): ActorRenderVariant[] {
  const keys = definition.Rendering ?? [];
  if (keys.length === 0) {
    return [];
  }
  const key = (variable & (definition.BitMask ?? 0)) >>> 0;
  const match = keys.find((entry) => entry.Key === key) ?? keys[0];
  return match?.Variants ?? [];
}

/** The first (default) render variant for an actor. */
export function actorDefaultVariant(definition: ActorDefinition): ActorRenderVariant | null {
  return actorVariants(definition, 0)[0] ?? null;
}
