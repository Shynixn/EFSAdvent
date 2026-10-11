import { Injectable, inject } from '@angular/core';
import UPNG from 'upng-js';
import { LoggingService } from './logging.service';
import { OpfsCacheService } from './opfs-cache.service';
import { StageData } from '../entity/fsalib.entity';
import { decodeBti } from './render/bti-decoder';
import { parseBti } from './render/bti-texture';
import { decodeTexture } from './render/bti-image';
import { ImageBuffer } from './render/gba-tile-renderer';
import { ArchivePathResolver, StageRenderer, TilesetInfo } from './render/stage-renderer';

/** Shape of the .NET JSExport host created by dotnet.js. */
interface DotnetExports {
  EFSLevelHub: {
    Wasm: {
      FsaInterop: {
        ParseStage(arcData: Uint8Array): string;
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
  private static readonly DATA_ARC_PATH = 'GC4Sword_pal/data.arc';

  private loadPromise: Promise<DotnetExports> | null = null;

  /** Cached tileset definitions promise. */
  private tilesetsPromise: Promise<Record<string, TilesetInfo>> | null = null;

  /** Cached stage definitions promise. */
  private stagesPromise: Promise<Record<string, StageInfo>> | null = null;

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
    const decoded = decodeBti(raw);
    // Copy into a dedicated ArrayBuffer: UPNG wants a plain ArrayBuffer and
    // `rgba.buffer` is typed as ArrayBufferLike (may be a SharedArrayBuffer).
    const pixels = new Uint8Array(decoded.rgba);
    const png = UPNG.encode([pixels.buffer], decoded.width, decoded.height, 0);
    return {
      path,
      width: decoded.width,
      height: decoded.height,
      pngDataUrl: `data:image/png;base64,${this.toBase64(png)}`,
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
    let resolver = new ArchivePathResolver(stageFiles.map((f) => f.Path));

    // Boss archives don't carry tileset/sprite resources; fall back to data.arc.
    const dataArc = await this.readDataArc();
    if (dataArc) {
      const dataFiles = await this.listArchiveFiles(dataArc);
      resolver = new ArchivePathResolver([
        ...stageFiles.map((f) => f.Path),
        ...dataFiles.map((f) => f.Path),
      ]);
    }

    const renderer = new StageRenderer(
      stage,
      async (path) => {
        if (stageFiles.some((f) => f.Path === path)) {
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

  /** Reads the game's shared `data.arc` from OPFS, or null if not extracted. */
  private async readDataArc(): Promise<Uint8Array | null> {
    try {
      const bytes = await this.opfs.readExtractedFile(FSALibService.DATA_ARC_PATH);
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  /** Encodes an {@link ImageBuffer} as a PNG data URL. */
  encodePng(image: ImageBuffer): string {
    // ImageBuffer stores RGBA8888 already, which is what UPNG.encode expects.
    const pixels = new Uint8Array(image.pixels);
    const png = UPNG.encode([pixels.buffer], image.width, image.height, 0);
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
