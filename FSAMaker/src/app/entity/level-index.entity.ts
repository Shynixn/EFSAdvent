/**
 * Public level search index
 * -------------------------
 * Types and URL helpers shared by the **generator** (`scripts/build-level-search-index.mjs`,
 * run at build time) and the **Level Explorer page** (which loads it in the
 * browser).
 *
 * The published content lives under `public/level/`:
 *
 * ```
 * public/level/searchindex.json      ← this index
 * public/level/<guid>/manifest.json  ← a stage's or world's definition
 * public/level/<guid>/stage.arc      ← a stage's archive
 * public/level/<guid>/stages/<n>.json│.arc  ← a world's stages
 * ```
 *
 * A manifest is a **world** when it has a `stages` array, otherwise a **stage**.
 */

/** Root folder (relative to the site root) that published levels live in. */
export const LEVEL_ROOT = 'level';

/**
 * Fallback preview image, used until the editor's own world map
 * (`/editor/cache/image/worldmap.png`) is available — i.e. before the game
 * files have been imported. Shipped with the site.
 */
export const LEVEL_FALLBACK_PREVIEW = `${LEVEL_ROOT}/default.svg`;

/** File name of the generated search index, relative to {@link LEVEL_ROOT}. */
export const SEARCH_INDEX_FILE = 'searchindex.json';

/** Kind of entry a search hit refers to. */
export type LevelKind = 'stage' | 'world';

/**
 * One searchable level (a published stage or world).
 *
 * Kept deliberately flat and small: the browser uses it to render cards
 * directly, so no manifest fetch is needed to show the list.
 */
export interface LevelIndexEntry {
  /** Entry id: the stage/world guid (also its folder name under `level/`). */
  id: string;
  kind: LevelKind;
  name: string;
  author: string;
  /** Creation date (`yyyy-MM-dd`), when the manifest has one. */
  creationDate?: string;
  /** Number of stages the world references (worlds only; stages have none). */
  stageCount?: number;
  /** Stage ids referenced by a world, in slot order (worlds only). */
  stages?: string[];
}

/** Shape of `public/level/searchindex.json`. */
export interface LevelSearchIndex {
  /** Schema version of this file. */
  version: number;
  /** ISO timestamp of when the index was generated. */
  generated: string;
  /** Root the entries' folders live in (always {@link LEVEL_ROOT}). */
  root: string;
  /** Total number of entries (stages + worlds). */
  count: number;
  entries: LevelIndexEntry[];
  /**
   * FlexSearch documents index, pre-built by the generator and exported with
   * `export: true`. Kept opaque here; {@link LevelIndexService} re-imports it.
   */
  index: LevelSearchIndexData;
}

/** Opaque serialized FlexSearch index (an object of per-field arrays). */
export type LevelSearchIndexData = Record<string, unknown>;

/** Builds the public URL of a stage/world folder. */
export function levelFolderUrl(id: string): string {
  return `${LEVEL_ROOT}/${id}`;
}

/** Builds the public URL of an entry's manifest. */
export function levelManifestUrl(id: string): string {
  return `${levelFolderUrl(id)}/manifest.json`;
}
