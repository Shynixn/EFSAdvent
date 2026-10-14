/**
 * Smart objects (decorations)
 * ---------------------------
 * A smart object is a hard-coded, multi-tile decoration (e.g. a tree) that can
 * be stamped onto a room in one action. Unlike plain tiles, a placement is also
 * recorded in the stage's JSON so the editor keeps a semantic reference to it.
 *
 * Tile coordinates in a definition are **offsets** relative to the placement
 * anchor (the top-left of the object's bounding box). A tile offset may be
 * negative (e.g. a canopy that overhangs to the left of the anchor).
 */

import { ImageBuffer, TILE_SIZE } from '../service/render/gba-tile-renderer';

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
  /** Display name shown in the toolbox. */
  name: string;
  /** Tiles stamped onto the base layer. */
  bottomLayerTiles: SmartObjectTileOffset[];
  /** Tiles stamped onto the paired top layer (index + 8). */
  topLayerTiles: SmartObjectTileOffset[];
}

/** A tile coordinate recorded for a placed smart object (absolute, in-room). */
export interface SmartObjectTileRef {
  /** Absolute tile row within the room (0-31). */
  row: number;
  /** Absolute tile column within the room (0-31). */
  col: number;
}

/**
 * A smart-object placement recorded in the stage JSON.
 *
 * Stores the placement anchor (the tile the object was dropped on) plus the
 * absolute tile coordinates that were written (per layer), so the editor can
 * later resolve, move or remove it without re-deriving the definition.
 */
export interface SmartObjectPlacement {
  /** Definition id (see {@link SMART_OBJECT_DEFINITIONS}). */
  id: string;
  /** Anchor tile row the object was placed at (offsets are relative to this). */
  anchorRow: number;
  /** Anchor tile column the object was placed at. */
  anchorCol: number;
  /** Absolute tile coordinates written to the base layer. */
  bottomLayerTiles: SmartObjectTileRef[];
  /** Absolute tile coordinates written to the paired top layer. */
  topLayerTiles: SmartObjectTileRef[];
}

/**
 * Smart objects placed within a single room, keyed by the room's grid position.
 * Mirrors the `rooms` array in the stage JSON.
 */
export interface RoomSmartObjects {
  /** Room row within the stage's room grid. */
  row: number;
  /** Room column within the stage's room grid. */
  col: number;
  /** Smart objects placed in this room. */
  smartObjects: SmartObjectPlacement[];
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
    name: 'Tree',
    // Base row: trunk tiles 524, 525, 526 at columns 0..2.
    bottomLayerTiles: [
      { dRow: 0, dCol: 0, tile: 524 },
      { dRow: 0, dCol: 1, tile: 525 },
      { dRow: 0, dCol: 2, tile: 526 },
    ],
    // Canopy row (one row above), overhanging one column left: 508..511.
    topLayerTiles: [
      { dRow: -1, dCol: -1, tile: 508 },
      { dRow: -1, dCol: 0, tile: 509 },
      { dRow: -1, dCol: 1, tile: 510 },
      { dRow: -1, dCol: 2, tile: 511 },
    ],
  },
];

/** Looks up a smart-object definition by id. */
export function findSmartObjectDefinition(id: string): SmartObjectDefinition | undefined {
  return SMART_OBJECT_DEFINITIONS.find((definition) => definition.id === id);
}

/** Room layer grid dimension (32×32 tiles). */
const ROOM_DIMENSION = 32;

/** The 16 tile layers of a room (indices 0-7 base, 8-15 top). */
export interface SmartObjectTargetLayer {
  Tiles: number[];
}

/**
 * Applies a smart-object definition to a room's layers at the given anchor,
 * returning the placement (absolute tile coordinates written per layer).
 *
 * Tiles whose target falls outside the room (0-31) are skipped. The base layer
 * index is `baseLayerIndex`; its paired top layer is `baseLayerIndex + 8`.
 */
export function applySmartObject(
  definition: SmartObjectDefinition,
  anchorRow: number,
  anchorCol: number,
  layers: SmartObjectTargetLayer[],
  baseLayerIndex = 0,
): SmartObjectPlacement {
  const placement: SmartObjectPlacement = {
    id: definition.id,
    anchorRow,
    anchorCol,
    bottomLayerTiles: [],
    topLayerTiles: [],
  };

  const write = (
    offsets: SmartObjectTileOffset[],
    layerIndex: number,
    refs: SmartObjectTileRef[],
  ): void => {
    const layer = layers[layerIndex];
    if (!layer) {
      return;
    }
    for (const offset of offsets) {
      const row = anchorRow + offset.dRow;
      const col = anchorCol + offset.dCol;
      if (row < 0 || row >= ROOM_DIMENSION || col < 0 || col >= ROOM_DIMENSION) {
        continue;
      }
      layer.Tiles[row * ROOM_DIMENSION + col] = offset.tile;
      refs.push({ row, col });
    }
  };

  write(definition.bottomLayerTiles, baseLayerIndex, placement.bottomLayerTiles);
  write(definition.topLayerTiles, baseLayerIndex + 8, placement.topLayerTiles);
  return placement;
}

/** Clears a placement's tiles from a room's layers (used before moving it). */
export function clearSmartObject(
  placement: SmartObjectPlacement,
  layers: SmartObjectTargetLayer[],
  baseLayerIndex = 0,
): void {
  for (const ref of placement.bottomLayerTiles) {
    const layer = layers[baseLayerIndex];
    layer?.Tiles && (layer.Tiles[ref.row * ROOM_DIMENSION + ref.col] = 0);
  }
  for (const ref of placement.topLayerTiles) {
    const layer = layers[baseLayerIndex + 8];
    layer?.Tiles && (layer.Tiles[ref.row * ROOM_DIMENSION + ref.col] = 0);
  }
}

/**
 * Bounding box (in tiles) of a definition's tiles relative to its anchor,
 * including negative offsets. Used to size previews and hit-test drags.
 */
export function smartObjectBounds(definition: SmartObjectDefinition): {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  rows: number;
  cols: number;
} {
  const all = [...definition.bottomLayerTiles, ...definition.topLayerTiles];
  let minRow = 0;
  let minCol = 0;
  let maxRow = 0;
  let maxCol = 0;
  for (const t of all) {
    minRow = Math.min(minRow, t.dRow);
    minCol = Math.min(minCol, t.dCol);
    maxRow = Math.max(maxRow, t.dRow);
    maxCol = Math.max(maxCol, t.dCol);
  }
  return {
    minRow,
    minCol,
    maxRow,
    maxCol,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
  };
}

/**
 * Renders a definition's tiles into a fresh RGBA buffer, sized to its bounding
 * box (top-layer tiles drawn over bottom-layer tiles). Transparent where empty.
 *
 * @param drawTile Callback that rasterizes one tile id at (px, py) into the
 *                 buffer (typically `StageRenderer.drawTilesetTile`).
 */
export function renderSmartObjectPreview(
  definition: SmartObjectDefinition,
  drawTile: (target: ImageBuffer, px: number, py: number, tileId: number) => void,
): ImageBuffer {
  const bounds = smartObjectBounds(definition);
  const width = bounds.cols * TILE_SIZE;
  const height = bounds.rows * TILE_SIZE;
  const buffer = new ImageBuffer(width, height);
  buffer.fill(0, 0, 0, 0);

  const stamp = (tiles: SmartObjectTileOffset[]): void => {
    for (const t of tiles) {
      const px = (t.dCol - bounds.minCol) * TILE_SIZE;
      const py = (t.dRow - bounds.minRow) * TILE_SIZE;
      drawTile(buffer, px, py, t.tile);
    }
  };

  stamp(definition.bottomLayerTiles);
  stamp(definition.topLayerTiles);
  return buffer;
}


