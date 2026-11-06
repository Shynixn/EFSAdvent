/**
 * Block smart object (Other → Misc).
 * --------------------------------
 * A **tile-only** object: the game decides how (and whether) a block moves from
 * the TILE ID alone. The block tiles carry only `Name`/`Description`/`Collision`
 * in `tileproperties.json` — no `RequiredActorID` — so no actor is involved:
 *
 * | Tile | Name                 | Movement          |
 * |------|----------------------|-------------------|
 * | 32   | Block, not movable   | none              |
 * | 33   | Block, movable       | any direction     |
 * | 34   | Green block, movable | any (Green Link)  |
 * | 35   | Red block, movable   | any (Red Link)    |
 * | 36   | Blue block, movable  | any (Blue Link)   |
 * | 37   | Purple block, movable| any (Purple Link) |
 * | 38   | Block, movable north | north only        |
 * | 39   | Block, movable south | south only        |
 * | 54   | Block, movable west  | west only         |
 * | 55   | Block, movable east  | east only         |
 *
 * Each is a single-tile {@link SmartObjectSubType}, picked from the context
 * menu, so one placement can be switched between every block version.
 */

import { SmartObjectDefinition, SmartObjectSubType } from '../smartobject.definition';

/** Stable smart-object id. */
export const BLOCK_ID = 'block';

/**
 * Tileset id of the default block tile: `tileproperties.json` #32,
 * "Block, not movable".
 *
 * The default placement is the plain solid block; pick a movable variant from
 * the right-click **Type** menu, which re-stamps the tile in place.
 *
 * Verified against a real game room (stage 2, room 7): the game's own blocks are
 * placed as tiles 32 (not movable) and 38/39/54/55 (north/south/west/east).
 */
export const BLOCK_TILE = 32;

/** A single-tile variant stamped on the base layer. */
function tileVariant(tile: number) {
  return {
    bottomLayerTiles: [{ dRow: 0, dCol: 0, tile }],
    topLayerTiles: [],
  };
}

/**
 * Every block tile version.
 *
 * **`Block, not movable` (tile 32) is FIRST** so it is sub-type 0 — the plain
 * block a fresh placement uses, matching the game's most common block tile.
 * Choosing another entry from the right-click **Type** menu re-stamps the tile
 * with that sub-type's id.
 */
export const BLOCK_SUB_TYPES: SmartObjectSubType[] = [
  { id: 'not-movable', name: 'Block, not movable', set: [tileVariant(32)] },
  { id: 'movable-north', name: 'Block, movable north', set: [tileVariant(38)] },
  { id: 'movable-south', name: 'Block, movable south', set: [tileVariant(39)] },
  { id: 'movable-west', name: 'Block, movable west', set: [tileVariant(54)] },
  { id: 'movable-east', name: 'Block, movable east', set: [tileVariant(55)] },
  { id: 'movable', name: 'Block, movable', set: [tileVariant(33)] },
  { id: 'green', name: 'Green block, movable', set: [tileVariant(34)] },
  { id: 'red', name: 'Red block, movable', set: [tileVariant(35)] },
  { id: 'blue', name: 'Blue block, movable', set: [tileVariant(36)] },
  { id: 'purple', name: 'Purple block, movable', set: [tileVariant(37)] },
];

/**
 * The Block definition: tile-baked, with every block tile as a sub-type.
 *
 * Sub-type 0 is `Block, not movable` (tile 32) — see {@link BLOCK_SUB_TYPES} —
 * so a fresh placement is the plain block. `set` mirrors the default.
 */
export const BLOCK_DEFINITION: SmartObjectDefinition = {
  id: BLOCK_ID,
  baking: 'tile',
  name: 'Block',
  section: 'Misc',
  subTypes: BLOCK_SUB_TYPES,
  set: [tileVariant(BLOCK_TILE)],
};

/** Every Misc block object (just the one). */
export const BLOCK_DEFINITIONS: SmartObjectDefinition[] = [BLOCK_DEFINITION];

