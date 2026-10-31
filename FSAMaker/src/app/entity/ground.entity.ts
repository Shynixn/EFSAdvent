/**
 * Ground
 * ------
 * Ground is a tile painted with the ground brush. Unlike a decoration, a ground
 * is applied tile-by-tile across the entire room (a full 32×32 grid per base
 * layer) and acts as the room's base layer where it is painted.
 *
 * A ground grid is stored as a flat, row-major array of tile ids; `0` means the
 * tile has not been painted by the ground brush.
 *
 * The selectable ground catalog lives in `ground.definition.ts`; this module
 * re-exports it so callers have a single import for everything ground-related.
 */

import { GroundDefinition } from './ground.definition';

export { GROUND_DEFINITIONS, findGroundDefinition } from './ground.definition';
export type { GroundDefinition } from './ground.definition';

/** Room layer grid dimension (32×32 tiles). */
export const ROOM_DIMENSION = 32;

/** Room layer grid dimension (32×32), exported for ground grids. */
export const GROUND_DIMENSION = ROOM_DIMENSION;

/**
 * A ground paint record for one base layer of a room.
 *
 * Stores a full room-sized grid of tile ids for both the base and its paired
 * top layer (length {@link ROOM_DIMENSION}²). A value of `0` means the tile has
 * not been painted by the ground brush.
 */
export interface GroundLayer {
  /** Base layer this ground belongs to (0-7). Paired top layer is `+ 8`. */
  baseLayerId: number;
  /** Full-canvas ground tile ids for the base layer (row-major, 0 = empty). */
  bottomLayerTiles: number[];
  /** Full-canvas ground tile ids for the paired top layer (row-major, 0 = empty). */
  topLayerTiles: number[];
}

/** Creates an empty (all-zero) ground grid for one layer. */
export function createGroundLayer(baseLayerId: number): GroundLayer {
  return {
    baseLayerId,
    bottomLayerTiles: new Array<number>(ROOM_DIMENSION * ROOM_DIMENSION).fill(0),
    topLayerTiles: new Array<number>(ROOM_DIMENSION * ROOM_DIMENSION).fill(0),
  };
}

/** Resolves the tile a ground paints at a given in-room coordinate. */
export function groundTileAt(definition: GroundDefinition, row: number, col: number): number {
  return definition.pattern ? definition.pattern(row, col) : definition.tile;
}
