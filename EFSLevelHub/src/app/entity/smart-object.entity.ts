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
  /**
   * Base layer the object was placed on (0-7). Its paired top layer is
   * `baseLayerId + 8`. Recorded so the object can be resolved, moved or
   * removed independently of the editor's currently active layer.
   */
  baseLayerId: number;
  /** Anchor tile row the object was placed at (offsets are relative to this). */
  anchorRow: number;
  /** Anchor tile column the object was placed at. */
  anchorCol: number;
  /** Absolute tile coordinates written to the base layer (`baseLayerId`). */
  bottomLayerTiles: SmartObjectTileRef[];
  /** Absolute tile coordinates written to the paired top layer (`baseLayerId + 8`). */
  topLayerTiles: SmartObjectTileRef[];
}

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

/**
 * Everything recorded for a single room in the stage JSON, keyed by the room's
 * grid position. Mirrors the `rooms` array in the stage JSON.
 */
export interface RoomSmartObjects {
  /** Room row within the stage's room grid. */
  row: number;
  /** Room column within the stage's room grid. */
  col: number;
  /** Smart objects (decorations) placed in this room. */
  smartObjects: SmartObjectPlacement[];
  /** Ground layers painted in this room, one entry per base layer. */
  ground?: GroundLayer[];
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
    baseLayerId: baseLayerIndex,
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
  baseLayerIndex = placement.baseLayerId ?? 0,
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

// --- Ground -----------------------------------------------------------------

/** Room layer grid dimension (32×32), exported for ground grids. */
export const GROUND_DIMENSION = ROOM_DIMENSION;

/**
 * A selectable "ground" for the ground brush.
 *
 * A ground is a repeating pattern of tiles (drawn by `pattern` below). Unlike a
 * smart object, a ground is painted tile-by-tile with the brush, never dragged.
 */
export interface GroundDefinition {
  /** Stable id, e.g. `grass`. */
  id: string;
  /** Representative tile id (used for the preview swatch and as a fallback). */
  tile: number;
  /**
   * Tile id for a given in-room (row, col). Defaults to a constant fill using
   * {@link tile} when omitted; may be overridden to produce a pattern.
   */
  pattern?: (row: number, col: number) => number;
}

/**
 * Hard-coded catalog of available grounds.
 *
 * Each entry maps to a game ground tile id (see `FSALib/assets/tileproperties.json`).
 * Grounds fill the room tile-by-tile with a single tile.
 */
export const GROUND_DEFINITIONS: GroundDefinition[] = [
  { id: 'default-ground', tile: 443 },
  { id: 'ground-variance', tile: 435 },
  { id: 'ground-flower', tile: 436 },
  { id: 'ground-to-rock-438', tile: 438 },
  {
    id: 'ground-to-rock-437-453',
    tile: 437,
    pattern: (row, col) => ((row + col) % 2 === 0 ? 437 : 453),
  },
  {
    id: 'ground-to-rock-439-442',
    tile: 439,
    pattern: (row, col) => ((row + col) % 2 === 0 ? 439 : 442),
  },
  {
    id: 'ground-to-rock-440-441',
    tile: 440,
    pattern: (row, col) => ((row + col) % 2 === 0 ? 440 : 441),
  },
  {
    id: 'ground-to-rock-455-458',
    tile: 455,
    pattern: (row, col) => ((row + col) % 2 === 0 ? 455 : 458),
  },
  {
    id: 'ground-to-rock-456-457',
    tile: 456,
    pattern: (row, col) => ((row + col) % 2 === 0 ? 456 : 457),
  },
  { id: 'ground-to-rock-454', tile: 454 },
  { id: 'rock-ground-444', tile: 444 },
  { id: 'rock-ground-445', tile: 445 },
  { id: 'rock-ground-459', tile: 459 },
  { id: 'rock-ground-460', tile: 460 },
  { id: 'rock-ground-461', tile: 461 },
  { id: 'tall-grass', tile: 116 },
];

/** Looks up a ground definition by id. */
export function findGroundDefinition(id: string): GroundDefinition | undefined {
  return GROUND_DEFINITIONS.find((definition) => definition.id === id);
}

/** Resolves the tile a ground paints at a given in-room coordinate. */
export function groundTileAt(definition: GroundDefinition, row: number, col: number): number {
  return definition.pattern ? definition.pattern(row, col) : definition.tile;
}

/** Creates an empty (all-zero) ground grid for one layer. */
export function createGroundLayer(baseLayerId: number): GroundLayer {
  return {
    baseLayerId,
    bottomLayerTiles: new Array<number>(ROOM_DIMENSION * ROOM_DIMENSION).fill(0),
    topLayerTiles: new Array<number>(ROOM_DIMENSION * ROOM_DIMENSION).fill(0),
  };
}
