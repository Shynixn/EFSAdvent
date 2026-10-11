import { Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';
import { StageData } from '../entity/fsalib.entity';

/** Shape of the .NET JSExport host created by dotnet.js. */
interface DotnetExports {
  EFSLevelHub: {
    Wasm: {
      FsaInterop: {
        ParseStage(arcData: Uint8Array): string;
        GetVersion(): string;
      };
    };
  };
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

  /** Base path (under the dev server) where the wasm runtime files are served. */
  private static readonly WASM_BASE = 'fsalib/';
  /** Assembly that carries the [JSExport] interop. */
  private static readonly ASSEMBLY = 'EFSLevelHub.Wasm';

  private loadPromise: Promise<DotnetExports> | null = null;

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
    const exports = await this.getExports();
    const json = exports.EFSLevelHub.Wasm.FsaInterop.ParseStage(arcData);
    const result = JSON.parse(json) as StageData;

    if (result.error) {
      throw new Error(`FSALib failed to parse stage: ${result.error}`);
    }
    return result;
  }
}
