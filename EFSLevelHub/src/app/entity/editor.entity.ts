/** A reference from a world to one of its stages. */
export interface WorldStageRef {
  /** Source archive name, e.g. `boss010.arc`. */
  arcFileName: string;
  /** Id of the stage definition file (`<uuid>`). */
  id: string;
}

/** A world stored in the editor's `/editor/world/<uuid>.json`. */
export interface WorldData {
  id: string;
  name: string;
  author: string;
  stages: WorldStageRef[];
}
