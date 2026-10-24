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
export function actorVariants(definition: ActorDefinition, variable: number): ActorRenderVariant[] {
  const keys = definition.Rendering ?? [];
  if (keys.length === 0) {
    return [];
  }
  const key = (variable & (definition.BitMask ?? 0)) >>> 0;

  const exact = keys.find((entry) => entry.Key === key);
  if (exact) {
    return exact.Variants;
  }

  // No exact entry. Rather than blindly falling back to the FIRST key (which
  // snaps every unmatched variable back to the default look), pick the key that
  // preserves as much of `key` as possible, most-significant bits first.
  //
  // `PLAS` (player start) is the motivating case: it only defines a lying
  // sprite for one facing (west, keys 304-307). Asking for "lying + south"
  // yields 256 (0x100), which has no entry — so we must drop only the DIRECTION
  // bits and keep state (bit 8) + colour (bits 0-3), resolving to a lying sprite
  // instead of standing-green.
  const best = closestKey(keys, key);
  return best?.Variants ?? [];
}

/**
 * The render key sharing the most significant bits with `key`.
 *
 * Higher bits win ties first: a key with the same bit 8 (state) is preferred
 * over one that merely shares bits 0-3 (colour), so an unsupported facing keeps
 * the requested state/colour and only concedes the direction.
 */
function closestKey(keys: readonly ActorRenderKey[], key: number): ActorRenderKey | undefined {
  let best: ActorRenderKey | undefined;
  let bestWeight = -1;
  for (const entry of keys) {
    let weight = 0;
    let weightSum = 0;
    for (let bit = 0; bit <= 15; bit++) {
      const shift = 1 << (bit - 4 >= 0 ? bit - 4 : 0);
      weightSum += shift;
      if (entry.Key & key & (1 << bit)) {
        weight += shift;
      }
    }
    const score = weight / weightSum;
    if (score > bestWeight) {
      best = entry;
      bestWeight = score;
    }
  }
  return best;
}

/** The first (default) render variant for an actor. */
export function actorDefaultVariant(definition: ActorDefinition): ActorRenderVariant | null {
  return actorVariants(definition, 0)[0] ?? null;
}
