/**
 * Smart object definitions
 * ------------------------
 * The hard-coded catalog of smart objects available in the toolbox. A smart
 * object is a multi-tile object (e.g. a decoration such as a tree) stamped onto
 * a room in one action.
 *
 * Tile coordinates in a definition are **offsets** relative to the placement
 * anchor (the top-left of the object's bounding box). A tile offset may be
 * negative (e.g. a canopy that overhangs to the left of the anchor).
 */

/** The kind of a smart object. Currently only a placable decoration. */
export type SmartObjectType = 'decoration';

/** A single tile within a smart-object definition, relative to the anchor. */
export interface SmartObjectTileOffset {
  /** Row offset from the anchor (may be negative). */
  dRow: number;
  /** Column offset from the anchor (may be negative). */
  dCol: number;
  /** Tileset tile id (0-1023) to stamp. */
  tile: number;
}

/** A hard-coded smart-object (decoration) definition. */
export interface SmartObjectDefinition {
  /** Stable id, e.g. `tree`. */
  id: string;
  /** What kind of smart object this is (e.g. `decoration`). */
  type: SmartObjectType;
  /** Display name shown in the toolbox. */
  name: string;
  /** Tiles stamped onto the base layer. */
  bottomLayerTiles: SmartObjectTileOffset[];
  /** Tiles stamped onto the paired top layer (index + 8). */
  topLayerTiles: SmartObjectTileOffset[];
}

/**
 * Hard-coded catalog of available decorations.
 *
 * The first entry (`tree`) uses the game's tree tiles: trunk/base on the bottom
 * layer (524-526) and canopy on the top layer (508-511), with the canopy
 * overhanging one row up and one column to the left.
 */
export const SMART_OBJECT_DEFINITIONS: SmartObjectDefinition[] = [
  {
    id: 'tree',
    type: 'decoration',
    name: 'Tree',
    // Base row: trunk tiles 524, 525, 526 at columns 0..2.
    bottomLayerTiles: [
      { dRow: -2, dCol: 0, tile: 480 },
      { dRow: -2, dCol: 1, tile: 481 },
      { dRow: -2, dCol: 2, tile: 482 },
      { dRow: -2, dCol: 3, tile: 483 },
      { dRow: -1, dCol: 0, tile: 496 },
      { dRow: -1, dCol: 1, tile: 497 },
      { dRow: -1, dCol: 2, tile: 498 },
      { dRow: -1, dCol: 3, tile: 499 },
      { dRow: 0, dCol: 0, tile: 508 },
      { dRow: 0, dCol: 1, tile: 509 },
      { dRow: 0, dCol: 2, tile: 510 },
      { dRow: 0, dCol: 3, tile: 511 },
      { dRow: 1, dCol: 0, tile: 524 },
      { dRow: 1, dCol: 1, tile: 525 },
      { dRow: 1, dCol: 2, tile: 526 },
      { dRow: 1, dCol: 3, tile: 527 },
    ],
    // Canopy row (one row above), overhanging one column left: 508..511.
    topLayerTiles: [
      { dRow: -3, dCol: 0, tile: 464 },
      { dRow: -3, dCol: 1, tile: 465 },
      { dRow: -3, dCol: 2, tile: 466 },
      { dRow: -3, dCol: 3, tile: 467 },
    ],
  },
];

/** Looks up a smart-object definition by id. */
export function findSmartObjectDefinition(id: string): SmartObjectDefinition | undefined {
  return SMART_OBJECT_DEFINITIONS.find((definition) => definition.id === id);
}
