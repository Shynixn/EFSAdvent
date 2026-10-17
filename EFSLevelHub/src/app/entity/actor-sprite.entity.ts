/**
 * Actor sprite extraction
 * -----------------------
 * The actor catalog only defines `rendering` for actors that draw a sprite or a
 * BTI texture. Most `TileObject` / `Property` / `Object` actors (a switch, a
 * warp, a chest, the player start…) have NO render definition: the game draws
 * them itself, so the editor needs an icon for its palette from somewhere else.
 *
 * We therefore **generate** icons from the game's own data at ISO-import time
 * (nothing is shipped with the app):
 *
 * 1. Enumerate the `TIMG` folder of the extracted `data.arc`.
 * 2. Decode every BTI texture (FSALib's decoder, same as stage rendering).
 * 3. Find each actor's sprite with EFSAdvent's name/variable convention — see
 *    {@link actorSpriteKeys}, ported from `GetActorInfoBitmap` in EFSAdvent's
 *    `Form1.cs`. EFSAdvent embeds the icons in the game's own TIMG files, so
 *    searching them reproduces its `data/actorsprites` set from the disc.
 * 4. Write the icon as a PNG under `/editor/cache/image/actorsprite/<KEY>.png`
 *    (the same cache layout used for tileset/room previews).
 *
 * Icons are looked up by **sprite key** (`PONT`, `WARP_21`, `DOOR_1_0`, …), so a
 * template/actor whose render definition is missing can still show a preview.
 */

/** One generated icon: where it lives plus the box it is anchored to. */
export interface ActorSpriteIcon {
  /** Sprite key, e.g. `WARP_21`. */
  key: string;
  /** Editor-store path of the PNG. */
  path: string;
  /** Icon width in pixels (native icon scale). */
  width: number;
  /** Icon height in pixels. */
  height: number;
  /** X offset of the icon's left edge from the box's horizontal centre. */
  ox: number;
  /** Y offset of the icon's top edge from the box's bottom edge (negative). */
  oy: number;
}

/** The four bytes of an actor `Variable`, byte 1 first (EFSAdvent's `V` order). */
export function spriteVariableBytes(variable: number): [number, number, number, number] {
  const v = variable >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/**
 * EFSAdvent's sprite keys for an actor + variable, most specific first.
 *
 * Ported from `GetActorInfoBitmap` (`Form1.cs`), which resolves an icon by
 * stuffing the relevant variable bits into the file name:
 *
 * - `DOOR`: `DOOR_<((v2 & 0xf) << 1 | v1 >> 7)>_<v2 >> 4>` (types 5/7 are plain
 *   doors and use `DOOR_5` / `DOOR_7`),
 * - `RBPN`: `RBPN_<((v2 & 0xf) << 1 | v1 >> 7)>`,
 * - `STBL`: `STBL_<v2 & 0x7f>`,
 * - any other actor: `<ID>_<v1 & 0x7f>`, then the plain `<ID>`.
 *
 * Keys are returned with their fallbacks (most specific first) so callers can
 * simply try each one. Note the icons this project generates are named by the
 * ACTOR ID (not by these keys), but the convention is kept because saved actor
 * variables select the same variants EFSAdvent shows.
 */
export function actorSpriteKeys(id: string, variable = 0): string[] {
  const [v1, v2] = spriteVariableBytes(variable);
  const name = id.toUpperCase();
  switch (name) {
    case 'DOOR': {
      const doorType = v1 & 0x7f;
      if (doorType === 5 || doorType === 7) {
        return ['DOOR_5', 'DOOR_7', 'DOOR'];
      }
      const facing = ((v2 & 0xf) << 1) | (v1 >> 7);
      return [`DOOR_${facing}_${v2 >> 4}`, 'DOOR'];
    }
    case 'RBPN':
      return [`RBPN_${((v2 & 0xf) << 1) | (v1 >> 7)}`, 'RBPN'];
    case 'STBL':
      return [`STBL_${v2 & 0x7f}`, 'STBL'];
    default:
      return [`${name}_${v1 & 0x7f}`, name];
  }
}

/**
 * Editor-store folder holding the generated actor icons.
 * Mirrors the other preview caches (`cache/image/...`).
 */
export const ACTOR_SPRITE_CACHE_DIR = 'cache/image/actorsprite';

/** Editor-store path of one generated icon (named by ACTOR ID). */
export function actorSpritePath(actorId: string): string {
  return `${ACTOR_SPRITE_CACHE_DIR}/${actorId.toUpperCase()}.png`;
}
