/** A user-created world stored in the editor's `userdata.json`. */
export interface WorldData {
  id: string;
  /** Unique identifier shown on the world card. */
  uuid: string;
  name: string;
  /** Display name of the world's author. */
  author: string;
  /** Relative path of the world's background image inside `/editor`, e.g. `cache/image/worldmap.png`. */
  mapImage: string;
  /** Ids of stages that belong to this world. */
  stageIds: string[];
}
