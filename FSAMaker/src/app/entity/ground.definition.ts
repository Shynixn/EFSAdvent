/**
 * Ground definitions
 * ------------------
 * The hard-coded catalog of grounds available to the ground brush.
 *
 * A ground is a repeating pattern of tiles. Unlike a decoration, a ground is
 * painted tile-by-tile with the brush, never dragged.
 */

/**
 * A selectable "ground" for the ground brush.
 *
 * A ground is a repeating pattern of tiles (drawn by `pattern`). When `pattern`
 * is omitted the ground fills with {@link tile}.
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
  { id: 'deep-water', tile: 7 },
];

/** Looks up a ground definition by id. */
export function findGroundDefinition(id: string): GroundDefinition | undefined {
  return GROUND_DEFINITIONS.find((definition) => definition.id === id);
}

/** Resolves the tile a ground paints at a given in-room coordinate. */
export function groundTileAt(definition: GroundDefinition, row: number, col: number): number {
  return definition.pattern ? definition.pattern(row, col) : definition.tile;
}
