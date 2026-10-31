/**
 * Tileset "themes" offered by the stage toolbox.
 *
 * The list is built at runtime from the real tileset definitions in
 * `FSALib/assets/tilesets.json` (see `FSALibService.loadTilesetThemes`), so it
 * always stays in sync with the game data. Selecting a theme sets the stage's
 * `Map.TileSheetId`, which changes the tiles used to draw every room.
 */
export interface TilesetTheme {
  /** Tileset index used by the game (maps to `Map.TileSheetId`). */
  index: number;
  /** Human-readable name shown in the theme picker. */
  name: string;
  /** True when the tileset is marked as "Development" (unfinished). */
  development?: boolean;
}
