/**
 * Entity types returned from the EFSLevelHub.Wasm module.
 *
 * These mirror the C# DTO classes in `EFSLevelHub.Wasm/Dtos.cs`, which project
 * the FSALib entities (the FSALib entities themselves can't be JSON-serialized
 * because they expose Span<T> and Stream members).
 *
 * Property names are PascalCase because System.Text.Json serializes C# property
 * names as-is by default.
 */

/** A parsed FSA stage, with its map layout, rooms, and resource archive. */
export interface StageData {
  Index: number;
  Map: MapLayoutData;
  MapSingleplayer?: MapLayoutData | null;
  Rooms: (RoomData | null)[];
  Resources: RarcDirectoryData;
  /** Only present when parsing failed. */
  error?: string;
}

/** The room layout and properties of a stage. */
export interface MapLayoutData {
  Index: number;
  StartX: number;
  StartY: number;
  IsShadowBattle: boolean;
  BackgroundMusicId: number;
  TileSheetId: number;
  NpcSheetId: number;
  OverlayTextureId: number;
  XDimension: number;
  YDimension: number;
  EmptyRoomValue: number;
  /** Row-major room indices, length = XDimension * YDimension. */
  Rooms: number[];
}

/** A room, containing multiple layers and actors. */
export interface RoomData {
  Layers: LayerData[];
  Actors: ActorData[];
}

/** A single tile layer of a room. */
export interface LayerData {
  Tiles: number[];
}

/** A single actor placed in a room. */
export interface ActorData {
  Id: string;
  Layer: number;
  X: number;
  Y: number;
  Variable: number;
}

/** A directory node within a RARC archive. */
export interface RarcDirectoryData {
  Name: string;
  Files: string[];
  Directories: Record<string, RarcDirectoryData>;
}
