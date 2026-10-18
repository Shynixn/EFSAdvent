import { TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { ROOM_PIXELS, TV_PIXELS, VISIBLE_ROOM_WIDTH } from '../../service/render/stage-renderer';

/**
 * Room grid dimension (32×32 tiles).
 *
 * The room canvas rasterizes its `<canvas>` backing store at this size (in
 * tiles), so the browser itself provides any crop: writes below the cropped
 * rows are simply dropped.
 */
export const DIMENSION = 32;

/** Tile rows the TV level shows — the bottom band below this row is cut off. */
export const TV_TILES_H = 24;

/** Full pixel height of a room layer (512px). */
export const ROOM_HEIGHT = ROOM_PIXELS;

/** Pixel height of the cropped (TV level) room window. */
export const TV_ROOM_HEIGHT = TV_PIXELS;

/**
 * Whether a base layer is rendered cropped like the game's TV view.
 *
 * Only the **Main Layer** (base layer 0, TV level) is cropped: the game shows
 * its top 24 of 32 tile rows. The **Dark World** (layer 1) and the **Gameboy
 * layers** (2-7) must stay fully visible, otherwise the editor hides tiles the
 * GBA levels actually use.
 */
export function isCroppedLayer(baseLayer: number): boolean {
  return baseLayer === 0;
}

/**
 * Pixel size of a room layer canvas.
 *
 * - Cropped layers: {@link VISIBLE_ROOM_WIDTH}×{@link TV_ROOM_HEIGHT} (512×384,
 *   i.e. tile rows 0-23).
 * - Uncropped layers: the full 512×512 grid, so the bottom rows stay visible
 *   and editable.
 */
export function roomCanvasSize(cropped: boolean): { width: number; height: number } {
  return {
    width: VISIBLE_ROOM_WIDTH,
    height: cropped ? TV_ROOM_HEIGHT : ROOM_HEIGHT,
  };
}

/** Tile rows shown by a layer canvas (`cropped` = TV level / Main layer). */
export function roomCanvasTilesH(cropped: boolean): number {
  return cropped ? TV_TILES_H : DIMENSION;
}

/**
 * The layer canvas's CSS size. Every canvas uses the same 1.5625× scale (a 16px
 * tile becomes 25 CSS px), so cropped and uncropped layers line up horizontally
 * and a tile keeps its size across sections.
 */
export function roomCanvasStyleSize(cropped: boolean): { width: number; height: number } {
  const { width, height } = roomCanvasSize(cropped);
  return { width: (width * 25) / 16, height: (height * 25) / 16 };
}

/** Pixel origin of a tile in a layer canvas. */
export function tileOrigin(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE, y: row * TILE_SIZE };
}
