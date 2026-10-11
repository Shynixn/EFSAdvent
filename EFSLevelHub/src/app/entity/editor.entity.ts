/** A user-created world stored in the editor's `userdata.json`. */
export interface WorldData {
  id: string;
  name: string;
  /** Relative path of the world's background image inside `/editor`, e.g. `cache/image/worldmap.png`. */
  mapImage: string;
  /** Ids of stages that belong to this world. */
  stageIds: string[];
}
