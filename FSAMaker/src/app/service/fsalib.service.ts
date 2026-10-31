import { Injectable, inject } from '@angular/core';
import UPNG from 'upng-js';
import { LoggingService } from './logging.service';
import { EditorService } from './editor.service';
import { OpfsCacheService } from './opfs-cache.service';
import { ActorData, StageData } from '../entity/fsalib.entity';
import { ActorDefinition } from '../entity/actor-definition.entity';
import { parseBti } from './render/bti-texture';
import { decodeTexture } from './render/bti-image';
import { ImageBuffer, loadPalettes } from './render/gba-tile-renderer';
import { TilesetRenderer } from './render/gba-sprite-renderer';
import { TilesetTheme } from '../entity/tileset.util';
import { TileActorDefinition, buildTileActors } from '../entity/tile-actor.entity';

/** One tile → actor entry, as emitted by the wasm `GetStageAssets` export. */
interface TileActorDto {
  Tile: number;
  Name: string;
  ActorId: string;
  ActorValue: number;
}

/**
 * OpFS path (relative to `/editor`) of the persisted FSALib asset catalog.
 *
 * Written once at ISO-import time from the wasm `GetStageAssets` export, then
 * read as plain JSON for every later stage open — no wasm asset deserialization
 * on the hot path.
 */
export const STAGE_ASSETS_FILE = 'cache/stageassets.json';

/** Shape of {@link STAGE_ASSETS_FILE} (mirrors the C# `StageAssets` payload). */
export interface StageAssetsFile {
  Tilesets: Record<string, TilesetInfo>;
  Stages: Record<string, StageInfo>;
  Actors: Record<string, ActorDefinition>;
  TileActors: TileActorDto[];
  /** Background music names keyed by song id (`Map.BackgroundMusicId`). */
  Songs?: Record<string, string>;
}
import {
  ArchivePathResolver,
  RenderOptions,
  ROOM_PIXELS,
  StageRenderer,
  TILESET_COLUMNS,
  TILESET_COUNT,
  TilesetInfo,
} from './render/stage-renderer';

/** Shape of the .NET JSExport host created by dotnet.js. */
interface DotnetExports {
  FSAMaker: {
    Wasm: {
      FsaInterop: {
        ParseStage(arcData: Uint8Array): string;
        RetargetStageIndex(arcData: Uint8Array, targetIndex: number): Uint8Array;
        MergeStageContent(targetArcData: Uint8Array, sourceArcData: Uint8Array): Uint8Array;
        SaveRoom(
          arcData: Uint8Array,
          tileSheetId: number,
          musicId: number,
          layersJson: string,
          actorsJson: string,
        ): Uint8Array;
        SetRoomSlot(
          arcData: Uint8Array,
          x: number,
          y: number,
          copyFromRoom: number,
          deleteRoom: boolean,
        ): Uint8Array;
        SetStartRoom(arcData: Uint8Array, x: number, y: number): Uint8Array;
        PasteRoomFromStage(
          destArcData: Uint8Array,
          sourceArcData: Uint8Array,
          x: number,
          y: number,
          sourceRoomIndex: number,
        ): Uint8Array;
        ListArchiveFiles(arcData: Uint8Array): string;
        ListArchiveTextures(arcData: Uint8Array): string;
        ReadArchiveFile(arcData: Uint8Array, path: string): Uint8Array;
        CacheArchive(key: string, arcData: Uint8Array): string;
        ReadCachedArchiveFiles(archiveKey: string, pathsNewlineSeparated: string): Uint8Array;
        Unzip(zipData: Uint8Array): string;
        EnsureAssets(): string;
        GetStageAssets(): string;
        GetTilesets(): string;
        GetSongs(): string;
        GetStages(): string;
        GetActors(): string;
        GetTileActors(): string;
        GetVersion(): string;
      };
    };
  };
}

/** A file entry inside a RARC archive (mirrors the C# ArchiveFileDto). */
export interface ArchiveFile {
  Path: string;
  Name: string;
  Size: number;
}

/** A file extracted from a ZIP archive. */
export interface ZipEntry {
  /** Path of the entry inside the zip, using forward slashes. */
  path: string;
  /** Raw, decoded contents of the entry. */
  data: Uint8Array;
}

/** Wire shape of a zip entry as returned by the WASM `Unzip` export. */
interface ZipEntryJson {
  Path: string;
  Data: string;
}

/** Decodes a base64 string into its raw bytes. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Unpacks the buffer produced by the wasm `ReadCachedArchiveFiles` export.
 *
 * Layout: `int32 count`, then `int32 length[count]` (-1 = unreadable), then the
 * payloads back-to-back. All integers are little-endian; slices are copies, so
 * the result survives the wasm heap being reused.
 *
 * @param packed Raw buffer from wasm.
 * @returns One entry per requested path, or `null` for unreadable files.
 */
function unpackArchiveFiles(packed: Uint8Array): (Uint8Array | null)[] {
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const count = view.getInt32(0, true);
  const results: (Uint8Array | null)[] = new Array(count);
  const headerSize = 4 + count * 4;
  let offset = headerSize;

  for (let i = 0; i < count; i++) {
    const length = view.getInt32(4 + i * 4, true);
    if (length < 0) {
      results[i] = null;
      continue;
    }
    results[i] = packed.slice(offset, offset + length);
    offset += length;
  }
  return results;
}

/** A decoded image ready for display, encoded as a PNG data URL. */
export interface ExtractedImage {
  /** Path within the archive, e.g. `TIMG/shikimono.bti`. */
  path: string;
  width: number;
  height: number;
  /** PNG data URL (`data:image/png;base64,...`). */
  pngDataUrl: string;
}

/** A stage entry from FSALib's `Assets.Stages` (mirrors the C# StageDto). */
export interface StageInfo {
  Name: string;
  /** World this stage belongs to; drives its position on the overview map. */
  WorldID: number;
  TextID: number;
  /** Title card texture, e.g. `w01_03.bti` — encodes world + stage number. */
  TitleCardGraphic: string;
}

/**
 * FSALibService
 * -------------
 * Loads the FSALib browser-wasm module and exposes its `Stage` parsing interop
 * to Angular. The module is loaded lazily on first use and cached for the
 * session.
 */
@Injectable({ providedIn: 'root' })
export class FSALibService {
  private readonly logger = inject(LoggingService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly editor = inject(EditorService);

  /** Base path (under the dev server) where the wasm runtime files are served. */
  private static readonly WASM_BASE = 'fsalib/';
  /** Assembly that carries the [JSExport] interop. */
  private static readonly ASSEMBLY = 'FSAMaker.Wasm';
  /** Archive holding the game's shared tileset/sprite/palette resources. */
  private static readonly DATA_ARC_PATH = 'GC4swords/data.arc';
  /** Key `data.arc` is cached under inside the wasm module. */
  static readonly DATA_ARC_KEY = 'data.arc';

  private loadPromise: Promise<DotnetExports> | null = null;

  /**
   * The persisted FSALib asset catalog (`/editor/cache/stageassets.json`).
   *
   * Loaded once per session and shared by every tileset/stage/actor consumer,
   * so opening a stage performs no wasm asset deserialization at all.
   */
  private assetsPromise: Promise<StageAssetsFile> | null = null;

  /** Cached tileset definitions promise. */
  private tilesetsPromise: Promise<Record<string, TilesetInfo>> | null = null;

  /** Cached stage definitions promise. */
  private stagesPromise: Promise<Record<string, StageInfo>> | null = null;

  /** Cached actor definitions promise. */
  private actorsPromise: Promise<Record<string, ActorDefinition>> | null = null;

  /** Cached tile → actor mapping promise (`tileproperties.json`). */
  private tileActorsPromise: Promise<TileActorDefinition[]> | null = null;

  /** Cached background-music list promise (`songs.json`). */
  private songsPromise: Promise<Record<string, string>> | null = null;

  /**
   * Cached `data.arc` bytes. The archive is tens of MB and is needed by every
   * stage render, so it is read from OPFS once and reused.
   */
  private dataArcPromise: Promise<Uint8Array | null> | null = null;

  /** Cached list of every file path inside `data.arc`. */
  private dataArcPaths: string[] = [];

  /** The FSALib version reported by the loaded module. */
  version: string | null = null;

  /** Lazily loads the .NET wasm runtime and returns the FSALib assembly exports. */
  private async getExports(): Promise<DotnetExports> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  private async load(): Promise<DotnetExports> {
    this.logger.info('FSALib: loading wasm module…');

    // Resolve against the document base so the dynamic import sees an absolute
    // URL; @vite-ignore stops Vite from trying to bundle the wasm loader.
    const moduleUrl = new URL(`${FSALibService.WASM_BASE}dotnet.js`, document.baseURI).href;

    const dotnetRuntime: any = await import(/* @vite-ignore */ moduleUrl);
    const dotnet = dotnetRuntime.dotnet ?? dotnetRuntime.default;

    // `create()` returns the runtime instance that exposes getAssemblyExports.
    const runtime = await dotnet
      .withConfig({
        locateFile: (path: string) =>
          new URL(`${FSALibService.WASM_BASE}${path}`, document.baseURI).href,
      })
      .create();

    // Intentionally no runMain(): this module exposes functionality purely
    // through [JSExport] and has no meaningful entry point to execute.
    const exports = (await runtime.getAssemblyExports(FSALibService.ASSEMBLY)) as DotnetExports;
    const fsa = exports.FSAMaker.Wasm.FsaInterop;
    this.version = fsa.GetVersion();
    this.logger.info(`FSALib: wasm module loaded (version ${this.version})`);
    return exports;
  }

  /**
   * Parses a stage archive and returns the FSALib `Stage` entity graph.
   *
   * @param arcData Raw bytes of a `bossXXX.arc` archive (optionally YAZ0-compressed).
   */
  async parseStage(arcData: Uint8Array): Promise<StageData> {
    const fsa = await this.getFsa();
    const json = fsa.ParseStage(arcData);
    const result = JSON.parse(json) as StageData;

    if (result.error) {
      throw new Error(`FSALib failed to parse stage: ${result.error}`);
    }
    return result;
  }

  /**
   * Re-indexes a stage archive so it can occupy a different stage slot.
   *
   * A `bossNNN.arc` is internally bound to its map index (its RARC holds
   * `B0NN`/`M0NN` folders and `0NN_…` files, and the game resolves resources by
   * that index). To place it in a different slot the internal names/data must be
   * rewritten to the destination index, which FSALib does when the stage's
   * index is changed.
   *
   * @param arcData     Raw bytes of the source archive (optionally YAZ0-compressed).
   * @param targetIndex Destination stage index (e.g. 10 for `boss010`).
   * @returns The re-indexed archive bytes (YAZ0-compressed), or null on failure.
   */
  async retargetStageIndex(arcData: Uint8Array, targetIndex: number): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const result = fsa.RetargetStageIndex(arcData, targetIndex);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Applies an entire room save in a SINGLE WASM round-trip.
   *
   * Saving used to chain one narrow setter per change (tileset, music, each
   * dirty layer, each dirty room's actors), and every one of those re-opened the
   * archive and re-serialized it twice. This applies every pending change to one
   * in-memory stage and serializes once — ~6x faster for a typical room save.
   *
   * All the inputs land in files the serializer rewrites as a whole anyway, so
   * the resulting bytes are identical to the old chained setters (verified by
   * byte comparison).
   *
   * @param arcData       Raw bytes of the stage archive.
   * @param tileSheetId   Tileset id for both map headers.
   * @param musicId       Background music id for both map headers.
   * @param layers        Room layers to replace.
   * @param actorRooms    Rooms whose actor list changed.
   * @returns The re-serialized archive, or `null` on failure.
   */
  async saveRoom(
    arcData: Uint8Array,
    tileSheetId: number,
    musicId: number,
    layers: readonly { roomIndex: number; layerIndex: number; tiles: readonly number[] }[],
    actorRooms: readonly { roomIndex: number; actors: readonly ActorData[] }[],
  ): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const layersJson = JSON.stringify(
      layers.map((entry) => ({
        roomIndex: entry.roomIndex,
        layerIndex: entry.layerIndex,
        tiles: entry.tiles,
      })),
    );
    const actorsJson = JSON.stringify(
      actorRooms.map((entry) => ({
        roomIndex: entry.roomIndex,
        actors: entry.actors.map((actor) => ({
          id: actor.Id,
          layer: actor.Layer,
          x: actor.X,
          y: actor.Y,
          variable: actor.Variable,
        })),
      })),
    );
    const result = fsa.SaveRoom(arcData, tileSheetId, musicId, layersJson, actorsJson);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Merges one stage's content (map layout, rooms, actors and layers) into
   * another stage's archive, keeping the destination's slot structure.
   *
   * Used when a world re-points a slot at a different stage: rather than swapping
   * whole archives (which crashes because each archive is bound to its own slot),
   * the destination slot's own archive is kept and its gameplay content is
   * overwritten with the source stage's.
   *
   * @param targetArcData Archive of the slot being written (its own stage).
   * @param sourceArcData Archive whose content should be copied in.
   * @returns The merged archive bytes, or null on failure.
   */
  async mergeStageContent(
    targetArcData: Uint8Array,
    sourceArcData: Uint8Array,
  ): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const result = fsa.MergeStageContent(targetArcData, sourceArcData);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Lists every file inside a RARC archive (`.arc`).
   *
   * @param arcData Raw bytes of the archive (optionally YAZ0-compressed).
   */
  async listArchiveFiles(arcData: Uint8Array): Promise<ArchiveFile[]> {
    const fsa = await this.getFsa();
    const json = fsa.ListArchiveFiles(arcData);
    const result = JSON.parse(json) as ArchiveFile[] | { error?: string };
    if (!Array.isArray(result)) {
      throw new Error(`FSALib failed to list archive: ${result.error ?? 'unknown error'}`);
    }
    return result;
  }

  /**
   * Reads a single file's raw bytes out of a RARC archive.
   *
   * @param arcData Raw bytes of the archive (optionally YAZ0-compressed).
   * @param path    Path of the file inside the archive, e.g. `TIMG/foo.bti`.
   */
  async readArchiveFile(arcData: Uint8Array, path: string): Promise<Uint8Array> {
    const fsa = await this.getFsa();
    return fsa.ReadArchiveFile(arcData, path);
  }

  /**
   * Registers an archive inside the wasm module so its bytes stop crossing the
   * JS↔wasm boundary.
   *
   * Every exported call marshals its arguments into the wasm heap, so passing
   * `data.arc` (~1.2 MB) to `ReadArchiveFile` costs ~1 s per call under the
   * interpreter no matter how small the file being read is. Caching it makes
   * that a one-time cost.
   *
   * @param key     Logical name used by {@link readCachedArchiveFiles}, e.g.
   *                `data.arc`.
   * @param arcData Raw archive bytes (optionally YAZ0-compressed).
   */
  async cacheArchive(key: string, arcData: Uint8Array): Promise<void> {
    const fsa = await this.getFsa();
    this.logger.info(`FSALib: caching archive "${key}" (${arcData.byteLength} bytes) in wasm…`);
    await this.logger.time(`FSALib.CacheArchive(${key})`, async () =>
      fsa.CacheArchive(key, arcData),
    );
  }

  /**
   * Reads many files out of an archive previously registered with
   * {@link cacheArchive}, in a single wasm call.
   *
   * @param archiveKey Key the archive was cached under.
   * @param paths      Paths to read (exact archive paths, e.g. `SCH /bg_m_sch.szs`).
   * @returns One entry per requested path, in order; `null` for files that
   *          could not be read.
   */
  async readCachedArchiveFiles(
    archiveKey: string,
    paths: readonly string[],
  ): Promise<(Uint8Array | null)[]> {
    if (paths.length === 0) {
      return [];
    }
    const fsa = await this.getFsa();
    return unpackArchiveFiles(fsa.ReadCachedArchiveFiles(archiveKey, paths.join('\n')));
  }

  /**
   * Creates, replaces or deletes the room bound to a map-grid cell.
   *
   * Creating allocates the next free room slot (optionally copying another
   * room's layers and actors) and points the cell — in both the shared and the
   * single-player map layout — at it. Deleting clears the cell and drops any
   * room no layout references any more.
   *
   * @param arcData      Stage archive bytes.
   * @param x            Grid column.
   * @param y            Grid row.
   * @param copyFromRoom Room index to copy the content from, or -1 for blank.
   * @param deleteRoom   When true, delete the cell's room instead.
   * @returns The re-serialized archive, or null on failure.
   */
  async setRoomSlot(
    arcData: Uint8Array,
    x: number,
    y: number,
    copyFromRoom = -1,
    deleteRoom = false,
  ): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const result = fsa.SetRoomSlot(arcData, x, y, copyFromRoom, deleteRoom);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Moves a stage's start room to an existing room cell and re-serializes the
   * archive.
   *
   * The start room is stored as a grid position (`MapLayout.StartX`/`StartY` in
   * the map CSV header, not a room index), so this only relocates the entry
   * point — the cell must already contain a room. Both the shared and the
   * single-player map are updated.
   *
   * @param arcData Stage archive bytes.
   * @param x       Grid column of the new start cell.
   * @param y       Grid row of the new start cell.
   * @returns The re-serialized archive, or null on failure (e.g. empty cell).
   */
  async setStartRoom(arcData: Uint8Array, x: number, y: number): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const result = fsa.SetStartRoom(arcData, x, y);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Pastes a room taken from another stage archive into a destination cell and
   * re-serializes the destination.
   *
   * Room indices are per archive, so the source room's layers and actors are
   * deep-copied into a fresh slot of the destination (the same path a
   * same-stage paste takes).
   *
   * @param destArcData       Destination stage archive bytes.
   * @param sourceArcData     Source stage archive bytes.
   * @param x                 Grid column in the destination.
   * @param y                 Grid row in the destination.
   * @param sourceRoomIndex   Room index inside the source stage.
   * @returns The re-serialized destination archive, or null on failure.
   */
  async pasteRoomFromStage(
    destArcData: Uint8Array,
    sourceArcData: Uint8Array,
    x: number,
    y: number,
    sourceRoomIndex: number,
  ): Promise<Uint8Array | null> {
    const fsa = await this.getFsa();
    const result = fsa.PasteRoomFromStage(destArcData, sourceArcData, x, y, sourceRoomIndex);
    return result && result.byteLength > 0 ? result : null;
  }

  /**
   * Lists every `.bti` texture in a RARC archive.
   *
   * Used at ISO-import time to build the actor-sprite cache from the game's own
   * textures (see `ActorSpriteService`).
   *
   * @param arcData Raw bytes of the archive (optionally YAZ0-compressed).
   */
  async listArchiveTextures(arcData: Uint8Array): Promise<ArchiveFile[]> {
    const fsa = await this.getFsa();
    const json = fsa.ListArchiveTextures(arcData);
    const result = JSON.parse(json) as ArchiveFile[] | { error?: string };
    if (!Array.isArray(result)) {
      throw new Error(`FSALib failed to list archive textures: ${result.error ?? 'unknown error'}`);
    }
    return result;
  }

  /**
   * The game's shared `data.arc` bytes, or null when the game is not extracted.
   *
   * Cached for the session (bytes + file listing), so repeated callers (stage
   * rendering, preview generation, sprite lookup) share one read.
   */
  async dataArc(): Promise<Uint8Array | null> {
    return this.readDataArc();
  }

  /** Every file path inside `data.arc` (empty when it is unavailable). */
  async dataArcFilePaths(): Promise<string[]> {
    await this.readDataArc();
    return this.dataArcPaths;
  }

  /**
   * Extracts every file from a ZIP archive (e.g. a shared stage package) and
   * returns their names and raw bytes.
   *
   * @param zipData Raw bytes of the ZIP archive.
   * @returns One entry per file, in archive order. Directory entries are
   *          omitted.
   */
  async unzip(zipData: Uint8Array): Promise<ZipEntry[]> {
    const fsa = await this.getFsa();
    const json = fsa.Unzip(zipData);
    const result = JSON.parse(json) as ZipEntryJson[] | { error?: string };
    if (!Array.isArray(result)) {
      throw new Error(`FSALib failed to read zip: ${result.error ?? 'unknown error'}`);
    }
    return result.map((entry) => ({
      path: entry.Path,
      data: base64ToBytes(entry.Data),
    }));
  }

  /**
   * Lists every `.bti` texture inside an archive, largest file first.
   *
   * This is deliberately cheap: no texture data is read or decoded, so the
   * caller can render the list without touching the GPU.
   *
   * @param arcData Raw bytes of the archive (optionally YAZ0-compressed).
   */
  async listTextures(arcData: Uint8Array): Promise<ArchiveFile[]> {
    const files = await this.listArchiveFiles(arcData);
    const textures = files
      .filter((f) => f.Name.toLowerCase().endsWith('.bti'))
      .sort((a, b) => b.Size - a.Size);
    this.logger.info(`FSALib: archive contains ${textures.length} BTI texture(s)`);
    return textures;
  }

  /**
   * Decodes a single `.bti` texture out of an archive and encodes it as a PNG.
   *
   * Decoding is only done on demand so that listing hundreds of textures does
   * not allocate hundreds of bitmaps at once.
   *
   * @param arcData Raw bytes of the archive (optionally YAZ0-compressed).
   * @param path    Path of the texture inside the archive, e.g. `TIMG/foo.bti`.
   */
  async decodeImage(arcData: Uint8Array, path: string): Promise<ExtractedImage> {
    const raw = await this.readArchiveFile(arcData, path);
    // Format-aware pipeline: correct block padding and channel/palette order.
    const image = decodeTexture(parseBti(raw));
    return {
      path,
      width: image.width,
      height: image.height,
      pngDataUrl: this.encodePng(image),
    };
  }

  /** Fetches the `FsaInterop` export surface, loading the module on first use. */
  private async getFsa(): Promise<DotnetExports['FSAMaker']['Wasm']['FsaInterop']> {
    const exports = await this.getExports();
    return exports.FSAMaker.Wasm.FsaInterop;
  }

  /**
   * Creates a {@link StageRenderer} for a parsed stage.
   *
   * Boss/level archives (`bossXXX.arc`) only contain `J3D` and `TIMG` data; the
   * shared tileset, sprite and palette resources live in the game's `data.arc`.
   * This method therefore layers the two archives: resources are looked up in
   * the stage archive first, then in `data.arc`.
   *
   * @param stage     Parsed stage (from {@link parseStage}).
   * @param arcData   Raw bytes of the stage archive the stage was parsed from.
   * @param tilesets  Tileset definitions keyed by tileset id.
   */
  async createStageRenderer(
    stage: StageData,
    arcData: Uint8Array,
    tilesets?: Record<string, TilesetInfo>,
  ): Promise<StageRenderer> {
    const stageFiles = await this.logger.time('FSALib.listStageArchiveFiles', () =>
      this.listArchiveFiles(arcData),
    );
    const stagePathSet = new Set(stageFiles.map((f) => f.Path));
    let resolver = new ArchivePathResolver(stageFiles.map((f) => f.Path));

    // Boss archives don't carry tileset/sprite resources; fall back to data.arc.
    // `data.arc` bytes + its file list are cached, so this is a one-time cost.
    const dataArc = await this.logger.time('FSALib.readDataArc', () => this.readDataArc());
    if (dataArc) {
      resolver = new ArchivePathResolver([...stageFiles.map((f) => f.Path), ...this.dataArcPaths]);
    }

    const [tilesetDefs, actorDefs] = await Promise.all([
      tilesets ?? this.logger.time('FSALib.loadTilesets', () => this.loadTilesets()),
      this.logger.time('FSALib.loadActors', () => this.loadActors()),
    ]);

    // Resource bytes fetched in batches, keyed by resolved archive path. The
    // renderer asks for resources one at a time; each miss triggers a batch
    // read of every path it is likely to need next, so the ~1 s per-call wasm
    // marshalling happens once instead of once per file.
    const prefetched = new Map<string, Uint8Array>();
    const dataArcBytes = dataArc ?? new Uint8Array(0);
    const buildPrefetchList = (): string[] => {
      if (!dataArc) {
        return [];
      }
      const wanted: string[] = [];
      const add = (path: string): void => {
        const real = resolver.resolve(path);
        if (real && !stagePathSet.has(real) && !prefetched.has(real)) {
          wanted.push(real);
        }
      };

      // Everything init() needs, plus the current tileset and NPC sprite sheets.
      add('SPL/bg_a_spl.szs');
      add('SCH/bg_base_sch.szs');
      const tileset = tilesetDefs[String(stage.Map.TileSheetId)];
      if (tileset) {
        add(`SCH/bg_${tileset.ID}_sch.szs`);
        add(`SCH/bg_${tileset.GbaID ?? tileset.ID}_sch.szs`);
        add(`SCL/bg_${tileset.ID}_scl.szs`);
        add(`SCL/bg_${tileset.ID}_gb_scl.szs`);
      }
      // NPC sprite sheets/palettes (loadSprites).
      const sheet = stage.Map.NpcSheetId.toString(16);
      add('SCH/gb_ch_obj_base_sch.szs');
      add(`SCH/gb_ch_obj_tr_sch${sheet}.szs`);
      add('SCH/enemy_sch.szs');
      add('SCH/gals2_sch.szs');
      add('SCH/player_sch.szs');
      add('SCH/gals_sch.szs');
      add('SOB/enemy_both_sob.bin');
      add('SOB/enemy_both2_sob.bin');
      add('SOB/enemy_gc_sob.bin');
      add('SOB/player_sob.bin');
      add('SOB/kage_sob.bin');
      add('SOB/player_kage_sob.bin');
      add('SCL/cu_cl_obj_base_scl.szs');
      add('SCL/gb_cl_obj_base_scl.szs');
      return wanted;
    };

    const renderer = new StageRenderer(
      stage,
      async (path) => {
        if (stagePathSet.has(path)) {
          return this.readArchiveFile(arcData, path);
        }
        if (!dataArc) {
          throw new Error(`Resource "${path}" not found in stage archive or data.arc`);
        }

        const cached = prefetched.get(path);
        if (cached) {
          return cached;
        }

        // Miss: fetch this path together with everything init/loadSprites is
        // expected to request, in one wasm call.
        const wanted = buildPrefetchList();
        if (!wanted.includes(path)) {
          wanted.push(path);
        }
        if (wanted.length === 0) {
          return this.readArchiveFile(dataArcBytes, path);
        }

        const timer = this.logger.startTimer('FSALib.prefetchDataArc');
        const payloads = await this.readCachedArchiveFiles(FSALibService.DATA_ARC_KEY, wanted);
        timer.stop(`FSALib: prefetched ${wanted.length} path(s)`);
        for (let i = 0; i < payloads.length; i++) {
          const payload = payloads[i];
          if (payload) {
            prefetched.set(wanted[i], payload);
          }
        }

        const result = prefetched.get(path);
        if (!result) {
          throw new Error(`Resource "${path}" not found in data.arc`);
        }
        return result;
      },
      resolver,
      tilesetDefs,
      actorDefs,
    );
    await this.logger.time('FSALib.StageRenderer.init', () => renderer.init());
    return renderer;
  }

  /**
   * Renders a preview image of a single tileset (all 1024 tiles in a 16×64
   * sheet), for the theme picker.
   *
   * Builds a throwaway {@link TilesetRenderer} so it does not disturb the active
   * stage renderer. The tile layout (SPL) comes from the stage archive or
   * `data.arc`; the tileset's own SCH/SCL define the graphics and colours.
   *
   * @param tilesetIndex Tileset index (`Map.TileSheetId`).
   * @param arcData      Stage archive bytes (resource lookup).
   * @param gba          Use the GBA variant of the tileset, if available.
   * @returns A PNG data URL, or null when the tileset is unknown/unreadable.
   */
  async renderTilesetPreview(
    tilesetIndex: number,
    arcData: Uint8Array,
    gba = false,
  ): Promise<string | null> {
    const tilesets = await this.loadTilesets();
    const info = tilesets[String(tilesetIndex)];
    if (!info) {
      return null;
    }

    // Tileset graphics/palettes live entirely in `data.arc`; a stage archive is
    // optional (import-time generation passes none). Only list the stage
    // archive when bytes were actually supplied — an empty buffer would make
    // the RARC parser throw.
    const hasStageArc = arcData && arcData.byteLength > 0;
    const stageFiles = hasStageArc ? await this.listArchiveFiles(arcData) : [];
    const stagePathSet = new Set(stageFiles.map((f) => f.Path));
    const dataArc = await this.readDataArc();
    const allPaths = dataArc
      ? [...stageFiles.map((f) => f.Path), ...this.dataArcPaths]
      : stageFiles.map((f) => f.Path);
    const resolver = new ArchivePathResolver(allPaths);

    const read = async (path: string): Promise<Uint8Array | null> => {
      const real = resolver.resolve(path);
      if (!real) {
        return null;
      }
      try {
        const bytes = stagePathSet.has(real)
          ? await this.readArchiveFile(arcData, real)
          : dataArc
            ? await this.readArchiveFile(dataArc, real)
            : null;
        return bytes && bytes.byteLength > 0 ? bytes : null;
      } catch {
        return null;
      }
    };

    const renderer = new TilesetRenderer();

    const spl = await read('SPL/bg_a_spl.szs');
    if (spl) {
      renderer.loadTileLayout(spl);
    }
    const id = gba ? (info.GbaID ?? info.ID) : info.ID;
    const sch = await read(`SCH/bg_${id}_sch.szs`);
    if (sch) {
      renderer.loadTiles(sch);
    }
    const scl = await read(gba ? `SCL/bg_${info.ID}_gb_scl.szs` : `SCL/bg_${info.ID}_scl.szs`);
    if (scl) {
      const palettes = loadPalettes(scl);
      for (let i = 0; i < palettes.length && i < renderer.palettes.length; i++) {
        renderer.palettes[i] = palettes[i];
      }
    }

    // Draw the full sheet on a neutral backdrop so transparent tiles read.
    const target = new ImageBuffer(
      TILESET_COLUMNS * 16,
      Math.ceil(TILESET_COUNT / TILESET_COLUMNS) * 16,
    );
    target.fill(96, 96, 108, 255);
    for (let i = 0; i < TILESET_COUNT; i++) {
      renderer.drawTile(target, (i & 0xf) * 16, (i >> 4) * 16, i);
    }
    return this.encodePng(target);
  }

  /**
   * Pre-reads every resource a {@link StageRenderer} can request into a plain
   * `path → bytes` record, so the rendering can happen in a Web Worker without
   * access to WASM or OPFS.
   *
   * The set of resources is bounded: the fixed tileset/sprite/palette files plus
   * the stage's own TIMG textures. Paths are resolved against the combined
   * stage + `data.arc` listing (same layering as {@link createStageRenderer}).
   *
   * @param stage   Parsed stage.
   * @param arcData Raw stage archive bytes.
   * @returns A record keyed by the archive's real path.
   */
  async gatherStageResources(
    stage: StageData,
    arcData: Uint8Array,
  ): Promise<Record<string, Uint8Array>> {
    const stageFiles = await this.listArchiveFiles(arcData);
    const stagePathSet = new Set(stageFiles.map((f) => f.Path));

    const dataArc = await this.readDataArc();
    const allPaths = dataArc
      ? [...stageFiles.map((f) => f.Path), ...this.dataArcPaths]
      : stageFiles.map((f) => f.Path);
    const resolver = new ArchivePathResolver(allPaths);

    // The fixed files the renderer reads, plus the stage's own textures.
    const tilesets = await this.loadTilesets();
    const tilesetInfo = tilesets[String(stage.Map.TileSheetId)];
    const wanted = new Set<string>([
      'SPL/bg_a_spl.szs',
      'SCH/bg_base_sch.szs',
      'SCH/gb_ch_obj_base_sch.szs',
      `SCH/gb_ch_obj_tr_sch${stage.Map.NpcSheetId.toString(16)}.szs`,
      'SCH/enemy_sch.szs',
      'SCH/gals2_sch.szs',
      'SCH/player_sch.szs',
      'SCH/gals_sch.szs',
      'SOB/enemy_both_sob.bin',
      'SOB/enemy_both2_sob.bin',
      'SOB/enemy_gc_sob.bin',
      'SOB/player_sob.bin',
      'SOB/kage_sob.bin',
      'SOB/player_kage_sob.bin',
      'SCL/cu_cl_obj_base_scl.szs',
      'SCL/gb_cl_obj_base_scl.szs',
    ]);
    if (tilesetInfo) {
      wanted.add(`SCH/bg_${tilesetInfo.ID}_sch.szs`);
      wanted.add(`SCH/bg_${tilesetInfo.GbaID ?? tilesetInfo.ID}_sch.szs`);
      wanted.add(`SCL/bg_${tilesetInfo.ID}_scl.szs`);
      wanted.add(`SCL/bg_${tilesetInfo.GbaID ?? tilesetInfo.ID}_gb_scl.szs`);
    }

    // Every .bti texture named in the stage's TIMG folder.
    const timg = stage.Resources?.Directories?.['TIMG'];
    if (timg) {
      for (const name of timg.Files) {
        if (name.toLowerCase().endsWith('.bti')) {
          wanted.add(`TIMG/${name}`);
        }
      }
    }

    const resources: Record<string, Uint8Array> = {};
    for (const path of wanted) {
      const real = resolver.resolve(path);
      if (!real) {
        continue;
      }
      try {
        const bytes = stagePathSet.has(real)
          ? await this.readArchiveFile(arcData, real)
          : dataArc
            ? await this.readArchiveFile(dataArc, real)
            : null;
        if (bytes && bytes.byteLength > 0) {
          resources[real] = bytes;
        }
      } catch {
        // Missing optional resources are fine; the renderer handles nulls.
      }
    }
    return resources;
  }

  /**
   * Reads the game's shared `data.arc` from OPFS, or null if not extracted.
   *
   * The bytes and their file-path list are cached for the session so that
   * rendering many stages does not re-read/re-parse the archive each time.
   */
  private async readDataArc(): Promise<Uint8Array | null> {
    if (this.dataArcPromise) {
      return this.dataArcPromise;
    }

    this.dataArcPromise = (async () => {
      const timer = this.logger.startTimer('FSALib.readDataArc');
      try {
        const bytes = await this.opfs.readExtractedFile(FSALibService.DATA_ARC_PATH);
        if (bytes.byteLength === 0) {
          return null;
        }
        this.logger.info(
          `FSALib: read data.arc (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB).`,
        );

        const files = await this.logger.time('FSALib.listDataArcFiles', () =>
          this.listArchiveFiles(bytes),
        );
        this.dataArcPaths = files.map((f) => f.Path);
        this.logger.info(`FSALib: cached data.arc (${files.length} file(s)).`);

        // Keep the bytes inside wasm too, so later resource reads transfer only
        // the requested payloads instead of re-marshalling the whole archive.
        await this.cacheArchive(FSALibService.DATA_ARC_KEY, bytes);
        return bytes;
      } catch {
        return null;
      } finally {
        timer.stop('FSALib:');
      }
    })();

    return this.dataArcPromise;
  }

  /**
   * Encodes an {@link ImageBuffer} as a PNG data URL.
   *
   * UPNG's signature is `encode(bufs, w, h, ps, dels, forbidPlte)`:
   *
   * - `ps` is a *quantization scale*, not a colour count, so any non-zero
   *   value reduces the colour space.
   * - Unless `forbidPlte` is set, UPNG emits an **indexed** (colour-type 3)
   *   PNG whenever the image has 256 or fewer colours. That silently drops
   *   pixels whose palette entry has alpha 0 and collapses entries that share
   *   RGB but differ in alpha.
   *
   * Passing `forbidPlte = true` forces lossless RGBA8888, which is what the
   * GX decoders produce and what the tests compare against AuroraLib.
   */
  encodePng(image: ImageBuffer): string {
    // ImageBuffer stores RGBA8888 already, which is what UPNG.encode expects.
    const pixels = new Uint8Array(image.pixels);
    // The bundled @types/upng-js stub omits the trailing `forbidPlte` flag,
    // but the runtime supports it (see node_modules/upng-js/UPNG.js line 385).
    // Without it UPNG emits an indexed PNG and loses alpha-0 pixels.
    const encode = UPNG.encode as (
      bufs: ArrayBuffer[],
      w: number,
      h: number,
      ps: number,
      dels: number[] | undefined,
      forbidPlte: boolean,
    ) => ArrayBuffer;
    const png = encode([pixels.buffer], image.width, image.height, 0, undefined, true);
    return `data:image/png;base64,${this.toBase64(png)}`;
  }

  /**
   * Reads a `.bti` texture out of an archive and decodes it with the
   * format-aware pipeline (preserving I4/RGB5A3/CMPR semantics).
   *
   * @param arcData Raw bytes of the archive.
   * @param path    Path of the texture inside the archive.
   */
  async decodeArchiveTexture(arcData: Uint8Array, path: string): Promise<ImageBuffer> {
    const raw = await this.readArchiveFile(arcData, path);
    return decodeTexture(parseBti(raw));
  }

  /**
   * Returns the shared FSALib asset catalog, loading it from OPFS once.
   *
   * The catalog is generated at ISO-import time by {@link populateStageAssets}
   * and contains the tilesets, stages, actors and tile→actor definitions. When
   * it is missing (e.g. a cache created before this file existed) it is
   * regenerated from wasm on demand, which is the slow path this design avoids.
   */
  async stageAssets(): Promise<StageAssetsFile> {
    if (!this.assetsPromise) {
      this.assetsPromise = this.readStageAssets().then(async (cached) => {
        if (cached) {
          return cached;
        }
        this.logger.warn(
          `FSALib: /editor/${STAGE_ASSETS_FILE} is missing — regenerating from wasm (slow path).`,
        );
        return this.populateStageAssets();
      });
    }
    return this.assetsPromise;
  }

  /**
   * Extracts every static FSALib definition in a single wasm call and persists
   * it to `/editor/cache/stageassets.json`.
   *
   * Called once at ISO-import time. Afterwards all asset reads are plain JSON
   * reads from OPFS; only stage-archive parsing still uses wasm.
   */
  async populateStageAssets(): Promise<StageAssetsFile> {
    const timer = this.logger.startTimer('FSALib.GetStageAssets');
    const fsa = await this.getFsa();
    const json = fsa.GetStageAssets();
    timer.stop(`FSALib: catalog JSON is ${json.length} char(s)`);

    const parsed = JSON.parse(json) as StageAssetsFile & { error?: string };
    if (parsed.error) {
      throw new Error(`FSALib failed to export stage assets: ${parsed.error}`);
    }

    const assets: StageAssetsFile = {
      Tilesets: parsed.Tilesets ?? {},
      Stages: parsed.Stages ?? {},
      Actors: parsed.Actors ?? {},
      TileActors: parsed.TileActors ?? [],
      Songs: parsed.Songs ?? {},
    };

    await this.editor.writeEditorFile(
      STAGE_ASSETS_FILE,
      new TextEncoder().encode(JSON.stringify(assets)),
    );
    this.logger.info(
      `FSALib: cached ${Object.keys(assets.Tilesets).length} tileset(s), ` +
        `${Object.keys(assets.Stages).length} stage(s), ` +
        `${Object.keys(assets.Actors).length} actor(s) to /editor/${STAGE_ASSETS_FILE}.`,
    );

    // Warm the per-domain caches so callers that already asked for a slice get
    // the freshly written data.
    this.assetsPromise = Promise.resolve(assets);
    this.tilesetsPromise = Promise.resolve(assets.Tilesets);
    this.stagesPromise = Promise.resolve(assets.Stages);
    this.actorsPromise = Promise.resolve(assets.Actors);
    this.tileActorsPromise = Promise.resolve(this.buildTileActorList(assets.TileActors));
    this.songsPromise = Promise.resolve(assets.Songs ?? {});
    return assets;
  }

  /** Reads the persisted catalog from OPFS, or null when it is missing/invalid. */
  private async readStageAssets(): Promise<StageAssetsFile | null> {
    const bytes = await this.editor.readEditorFile(STAGE_ASSETS_FILE);
    if (!bytes || bytes.byteLength === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StageAssetsFile;
      if (!parsed.Tilesets || !parsed.Actors) {
        this.logger.warn(`FSALib: /editor/${STAGE_ASSETS_FILE} is malformed.`);
        return null;
      }
      return {
        Tilesets: parsed.Tilesets,
        Stages: parsed.Stages ?? {},
        Actors: parsed.Actors,
        TileActors: parsed.TileActors ?? [],
        Songs: parsed.Songs ?? {},
      };
    } catch (error) {
      this.logger.warn(`FSALib: failed to parse /editor/${STAGE_ASSETS_FILE}`, error);
      return null;
    }
  }

  /** Converts the raw tile→actor entries into the editor's lookup structure. */
  private buildTileActorList(entries: TileActorDto[]): TileActorDefinition[] {
    return buildTileActors(
      Object.fromEntries(
        entries.map((entry) => [
          String(entry.Tile),
          {
            Name: entry.Name,
            RequiredActorID: entry.ActorId,
            ActorValue: entry.ActorValue || undefined,
          },
        ]),
      ),
    );
  }

  /** The tileset definitions from the persisted catalog. */
  async loadTilesets(): Promise<Record<string, TilesetInfo>> {
    if (!this.tilesetsPromise) {
      this.tilesetsPromise = this.stageAssets().then((assets) => assets.Tilesets);
    }
    return this.tilesetsPromise;
  }

  /**
   * Builds the list of selectable tileset "themes" from the real tileset
   * definitions (originally `tilesets.json`), so the picker always stays in
   * sync with the game data instead of a hard-coded list.
   *
   * @param includeDevelopment Include tilesets marked as "Development".
   * @returns Themes ordered by tileset index.
   */
  async loadTilesetThemes(includeDevelopment = false): Promise<TilesetTheme[]> {
    const tilesets = await this.loadTilesets();
    return Object.entries(tilesets)
      .map(([key, info]) => ({
        index: Number(key),
        name: (info.Name ?? `Tileset ${key}`).trim(),
        development: (info.AssetState ?? '')
          .split(',')
          .some((flag) => flag.trim().toLowerCase() === 'development'),
      }))
      .filter((theme) => includeDevelopment || !theme.development)
      .sort((a, b) => a.index - b.index);
  }

  /**
   * The background music names from FSALib's `songs.json`, keyed by song id.
   *
   * A stage's `Map.BackgroundMusicId` is an index into this list; the room
   * editor's music dropdown is built from it.
   */
  async loadSongs(): Promise<Record<string, string>> {
    if (!this.songsPromise) {
      this.songsPromise = this.stageAssets().then(async (assets) => {
        const cached = assets.Songs ?? {};
        if (Object.keys(cached).length > 0) {
          return cached;
        }
        // Catalogs written before songs were included have no `Songs` key, so
        // ask wasm directly rather than showing an empty dropdown.
        try {
          const fsa = await this.getFsa();
          const songs = JSON.parse(fsa.GetSongs()) as Record<string, string> & { error?: string };
          return songs.error ? {} : songs;
        } catch {
          return {};
        }
      });
    }
    return this.songsPromise;
  }

  /**
   * Tiles that imply an actor, from FSALib's `tileproperties.json`
   * (`RequiredActorID`). E.g. tile 48 is the Chest tile for `TKRA`.
   */
  async loadTileActors(): Promise<TileActorDefinition[]> {
    if (!this.tileActorsPromise) {
      this.tileActorsPromise = this.stageAssets().then((assets) =>
        this.buildTileActorList(assets.TileActors),
      );
    }
    return this.tileActorsPromise;
  }

  /** The stage definitions from the persisted catalog (keyed by `bossNNN`). */
  async loadStages(): Promise<Record<string, StageInfo>> {
    if (!this.stagesPromise) {
      this.stagesPromise = this.stageAssets().then((assets) => assets.Stages);
    }
    return this.stagesPromise;
  }

  /**
   * The actor definitions from the persisted catalog, keyed by the 4-character
   * actor id.
   *
   * Drives the editor's Enemies toolbox section and the on-canvas actor
   * rendering.
   */
  async loadActors(): Promise<Record<string, ActorDefinition>> {
    if (!this.actorsPromise) {
      this.actorsPromise = this.stageAssets().then((assets) => assets.Actors);
    }
    return this.actorsPromise;
  }

  /**
   * Renders every room of a stage into a single map-layout PNG.
   *
   * The stage's `Map` grid is walked row-major; each non-empty room is rendered
   * (base + top layers) into its own 512×512 buffer and composited into the
   * resulting grid image at the cell's position.
   *
   * @param arcData Raw bytes of a `bossXXX.arc` archive.
   * @returns A wide PNG data URL of the full stage layout.
   */
  async renderStageMap(arcData: Uint8Array): Promise<string> {
    const stage = await this.parseStage(arcData);
    const layout = stage.Map;
    const cols = layout.XDimension;
    const rows = layout.YDimension;

    const renderer = await this.createStageRenderer(stage, arcData);
    const target = new ImageBuffer(cols * ROOM_PIXELS, rows * ROOM_PIXELS);
    target.fill(0, 0, 0, 255);

    // A single scratch buffer is reused for every room; `fill` clears it between
    // draws, avoiding a ~1 MB allocation per room.
    const room = new ImageBuffer(ROOM_PIXELS, ROOM_PIXELS);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const roomIndex = layout.Rooms[x + y * cols];
        if (roomIndex == null || roomIndex === layout.EmptyRoomValue) {
          continue;
        }

        room.fill(0, 0, 0, 255);
        await renderer.draw(room, roomIndex, 0, RenderOptions.Layers);
        target.blendFrom(room, x * ROOM_PIXELS, y * ROOM_PIXELS);
      }
    }

    this.logger.info(`FSALib: rendered stage map (${cols}x${rows} rooms, ${target.width}px wide).`);
    return this.encodePng(target);
  }

  /** Chunked ArrayBuffer -> base64 (avoids call-stack overflow on large images). */
  private toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
}
