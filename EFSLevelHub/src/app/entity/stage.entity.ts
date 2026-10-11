/** A stage (level) stored in the editor's `userdata.json`. */
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
