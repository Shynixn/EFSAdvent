/** A reference from a world to one of its stages. */
export interface WorldStageRef {
  /** Source archive name, e.g. `boss010.arc`. */
  arcFileName: string;
  /** Id of the stage definition file (`<uuid>`). */
  id: string;
}

/** Schema version written to every world definition file. */
export const WORLD_FILE_VERSION = 1;

/** A world stored in the editor's `/editor/world/<uuid>.json`. */
export interface WorldData {
  id: string;
  name: string;
  author: string;
  stages: WorldStageRef[];
  /** Schema version of the world file; always {@link WORLD_FILE_VERSION}. */
  version: number;
  /** Creation date as an ISO day (`yyyy-MM-dd`). */
  creationDate: string;
}

/**
 * A stage (level) stored in the editor's `userdata.json`.
 *
 * Note: `fsalib.entity.ts` also exports a `StageData`, but that is the WASM
 * archive DTO — a different shape. Prefer an explicit import alias when both
 * are needed in the same file.
 */
export interface StageData {
  /** Stable id, e.g. the source archive id (`boss010`). */
  id: string;
  /** Unique identifier shown on the stage card. */
  uuid: string;
  /** Display name, e.g. "Lake Hylia". */
  name: string;
  /** Display name of the stage's author. */
  author: string;
  /** Relative path of the stage's map preview image inside `/editor`. */
  mapImage: string;
  /** SHA-256 hash of the source archive bytes. */
  hash: string;
  /** Default stages shipped with the game cannot be edited. */
  locked: boolean;
}
