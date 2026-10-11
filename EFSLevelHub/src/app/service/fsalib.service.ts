import { Injectable, inject } from '@angular/core';
import UPNG from 'upng-js';
import { LoggingService } from './logging.service';
import { OpfsCacheService } from './opfs-cache.service';
import { StageData } from '../entity/fsalib.entity';
import { parseBti } from './render/bti-texture';
import { decodeTexture } from './render/bti-image';
import { ImageBuffer } from './render/gba-tile-renderer';
import {
  ArchivePathResolver,
  RenderOptions,
  ROOM_PIXELS,
  StageRenderer,
  TilesetInfo,
} from './render/stage-renderer';

/** Shape of the .NET JSExport host created by dotnet.js. */
interface DotnetExports {
  EFSLevelHub: {
    Wasm: {
      FsaInterop: {
        ParseStage(arcData: Uint8Array): string;
        RetargetStageIndex(arcData: Uint8Array, targetIndex: number): Uint8Array;
        MergeStageContent(targetArcData: Uint8Array, sourceArcData: Uint8Array): Uint8Array;
        ListArchiveFiles(arcData: Uint8Array): string;
        ReadArchiveFile(arcData: Uint8Array, path: string): Uint8Array;
        EnsureAssets(): string;
        GetTilesets(): string;
        GetStages(): string;
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

  /** Base path (under the dev server) where the wasm runtime files are served. */
  private static readonly WASM_BASE = 'fsalib/';
  /** Assembly that carries the [JSExport] interop. */
  private static readonly ASSEMBLY = 'EFSLevelHub.Wasm';
  /** Archive holding the game's shared tileset/sprite/palette resources. */
  private static readonly DATA_ARC_PATH = 'GC4swords/data.arc';

  private loadPromise: Promise<DotnetExports> | null = null;

  /** Cached tileset definitions promise. */
  private tilesetsPromise: Promise<Record<string, TilesetInfo>> | null = null;

  /** Cached stage definitions promise. */
  private stagesPromise: Promise<Record<string, StageInfo>> | null = null;

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
    const fsa = exports.EFSLevelHub.Wasm.FsaInterop;
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
  private async getFsa(): Promise<DotnetExports['EFSLevelHub']['Wasm']['FsaInterop']> {
    const exports = await this.getExports();
    return exports.EFSLevelHub.Wasm.FsaInterop;
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
    const stageFiles = await this.listArchiveFiles(arcData);
    const stagePathSet = new Set(stageFiles.map((f) => f.Path));
    let resolver = new ArchivePathResolver(stageFiles.map((f) => f.Path));

    // Boss archives don't carry tileset/sprite resources; fall back to data.arc.
    // `data.arc` bytes + its file list are cached, so this is a one-time cost.
    const dataArc = await this.readDataArc();
    if (dataArc) {
      resolver = new ArchivePathResolver([...stageFiles.map((f) => f.Path), ...this.dataArcPaths]);
    }

    const renderer = new StageRenderer(
      stage,
      async (path) => {
        if (stagePathSet.has(path)) {
          return this.readArchiveFile(arcData, path);
        }
        if (!dataArc) {
          throw new Error(`Resource "${path}" not found in stage archive or data.arc`);
        }
        return this.readArchiveFile(dataArc, path);
      },
      resolver,
      tilesets ?? (await this.loadTilesets()),
    );
    await renderer.init();
    return renderer;
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
      try {
        const bytes = await this.opfs.readExtractedFile(FSALibService.DATA_ARC_PATH);
        if (bytes.byteLength === 0) {
          return null;
        }

        const files = await this.listArchiveFiles(bytes);
        this.dataArcPaths = files.map((f) => f.Path);
        this.logger.info(`FSALib: cached data.arc (${files.length} file(s)).`);
        return bytes;
      } catch {
        return null;
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

  /** Loads and caches the tileset definitions FSALib has loaded from its assets. */
  async loadTilesets(): Promise<Record<string, TilesetInfo>> {
    if (!this.tilesetsPromise) {
      this.tilesetsPromise = this.getFsa()
        .then((fsa) => {
          // FSALib reads its definitions from `assets/*.json`, which doesn't
          // exist in the browser-wasm VFS until we materialize it.
          fsa.EnsureAssets();
          const parsed = JSON.parse(fsa.GetTilesets()) as Record<string, TilesetInfo> & {
            error?: string;
          };
          if (typeof parsed.error === 'string') {
            throw new Error(parsed.error);
          }
          return parsed as Record<string, TilesetInfo>;
        })
        .catch((err) => {
          this.logger.error('FSALib: failed to read tilesets from wasm', err);
          return {} as Record<string, TilesetInfo>;
        });
    }
    return this.tilesetsPromise;
  }

  /** Loads and caches the stage definitions FSALib has loaded from its assets. */
  async loadStages(): Promise<Record<string, StageInfo>> {
    if (!this.stagesPromise) {
      this.stagesPromise = this.getFsa()
        .then((fsa) => {
          fsa.EnsureAssets();
          const parsed = JSON.parse(fsa.GetStages()) as Record<string, StageInfo> & {
            error?: string;
          };
          if (typeof parsed.error === 'string') {
            throw new Error(parsed.error);
          }
          return parsed as Record<string, StageInfo>;
        })
        .catch((err) => {
          this.logger.error('FSALib: failed to read stages from wasm', err);
          return {} as Record<string, StageInfo>;
        });
    }
    return this.stagesPromise;
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
