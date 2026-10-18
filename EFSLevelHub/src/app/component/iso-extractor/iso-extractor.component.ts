import { Component, OnInit, inject, signal } from '@angular/core';
import { IsoExtractorService } from '../../service/iso-extractor.service';
import { IsoSourceService } from '../../service/iso-source.service';
import { OpfsCacheService } from '../../service/opfs-cache.service';
import { GameStateService } from '../../service/game-state.service';
import { EditorService, WORLDMAP_FILE } from '../../service/editor.service';
import { StageService, DEFAULT_WORLD_STAGE_COUNT } from '../../service/stage.service';
import { WorldService } from '../../service/world.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { ActorSpriteService } from '../../service/actor-sprite.service';
import { FSALibService } from '../../service/fsalib.service';
import { LoggingService } from '../../service/logging.service';
import { ButtonComponent } from '../button/button.component';
import { ExtractionProgress, StorageEstimate } from '../../entity/iso.entity';

/**
 * IsoExtractorComponent
 * ---------------------
 * Minimal standalone UI for selecting a GameCube ISO/GCM file, extracting it
 * into OPFS, and reporting live progress + storage usage.
 *
 * Uses Angular signals + zoneless change detection: writable signals are read
 * directly in the template, so mutating them schedules change detection
 * automatically.
 */
@Component({
  selector: 'app-iso-extractor',
  imports: [ButtonComponent],
  templateUrl: './iso-extractor.component.html',
  styleUrl: './iso-extractor.component.css',
})
export class IsoExtractorComponent implements OnInit {
  private readonly isoExtractor = inject(IsoExtractorService);
  private readonly isoSource = inject(IsoSourceService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly gameState = inject(GameStateService);
  private readonly fsaLib = inject(FSALibService);
  private readonly editor = inject(EditorService);
  private readonly stageService = inject(StageService);
  private readonly worldService = inject(WorldService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly actorSprites = inject(ActorSpriteService);
  private readonly logger = inject(LoggingService);

  readonly selectedFileName = signal('');
  readonly isExtracting = signal(false);
  readonly extractedCount = signal(0);
  readonly totalFiles = signal(0);
  readonly currentFileName = signal('');
  /** Human-readable description of the current extraction phase. */
  readonly statusMessage = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly storage = signal<StorageEstimate>({ usedMB: 0, totalMB: 0 });
  /** Number of files already cached in OPFS from a previous session. */
  readonly cachedFileCount = signal(0);
  readonly isClearing = signal(false);

  ngOnInit(): void {
    void this.refreshStorage();
    void this.refreshCachedFileCount();
  }

  /** Handles the `<input type="file">` change event. */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.selectedFileName.set(file.name);
    this.resetProgress();
    void this.extract(file);
  }

  /** Runs extraction and keeps the UI state in sync. */
  private async extract(file: File): Promise<void> {
    this.isExtracting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.logger.info(`UI: extraction started for "${file.name}" (${file.size} bytes)`);

    try {
      const result = await this.isoExtractor.extractAndCacheIso(file, (progress) =>
        this.onProgress(progress),
      );

      // Generate the editor's derived assets (e.g. `/editor/cache/image/worldmap.png`).
      await this.generateEditorFiles();

      // Persist a copy of the source image so a patched ISO can be exported
      // later without asking the user to re-select the file.
      this.statusMessage.set('Saving source image for export…');
      await this.isoSource.save(file);

      this.totalFiles.set(result.totalFiles);
      this.successMessage.set(`Extraction complete — ${result.totalFiles} file(s) cached to OPFS.`);
      this.logger.info(`UI: extraction finished (${result.totalFiles} files).`);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Unknown extraction error.');
      this.logger.error('UI: extraction failed', error);
    } finally {
      this.isExtracting.set(false);
      this.currentFileName.set('');
      await this.refreshStorage();
      await this.refreshCachedFileCount();
      // Re-scan for the marker file so the shell/nav reflect the new state.
      await this.gameState.refresh();
    }
  }

  /** Applies an extraction progress event to the UI state. */
  private onProgress(progress: ExtractionProgress): void {
    this.statusMessage.set(progress.message);
    this.extractedCount.set(progress.extractedCount);
    this.totalFiles.set(progress.totalFiles);
    this.currentFileName.set(progress.currentFileName ?? '');
    this.logger.info(
      `UI progress [${progress.phase}] ${progress.message} ` +
        `(${progress.extractedCount}/${progress.totalFiles})`,
    );
  }

  /** Re-reads the OPFS storage quota for the status readout. */
  async refreshStorage(): Promise<void> {
    this.storage.set(await this.opfs.getStorageEstimate());
  }

  /** Re-counts the files currently cached under `/extracted_game`. */
  async refreshCachedFileCount(): Promise<void> {
    this.cachedFileCount.set(await this.opfs.countExtractedFiles());
  }

  /** Wipes the extracted game cache from OPFS. */
  async clearCache(): Promise<void> {
    this.isClearing.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');
    try {
      await this.opfs.clearExtractedGame();
      // Also wipe the entire editor cache (worlds, stages, worldmap, …).
      await this.editor.clearEditor();
      // And the persisted source image, which is no longer needed.
      await this.isoSource.clear();
      await this.refreshStorage();
      await this.refreshCachedFileCount();
      // Re-run the ISO/import check so the shell and settings banner reflect
      // that the game files are no longer available.
      await this.gameState.refresh();
      this.successMessage.set('Cache cleared.');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to clear cache.');
      this.logger.error('UI: clear cache failed', error);
    } finally {
      this.isClearing.set(false);
    }
  }

  private resetProgress(): void {
    this.extractedCount.set(0);
    this.totalFiles.set(0);
    this.currentFileName.set('');
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  /**
   * Generates the editor's derived files after a successful extraction.
   *
   * Produces `/editor/cache/stageassets.json` (the FSALib tileset/stage/actor
   * catalog, so later stage opens never deserialize assets in wasm),
   * `/editor/cache/image/worldmap.png` (the overworld texture) and the default
   * stage previews under `/editor/cache/<zero-guid>/`. Failures here are
   * non-fatal: extraction itself has already succeeded, so we only log a warning.
   */
  private async generateEditorFiles(): Promise<void> {
    await this.cacheStageAssets();
    await this.generateWorldmap();
    await this.importDefaultStages();
    await this.generateTilesetPreviews();
    await this.generateActorSprites();
    await this.dumpEditorStore();
  }

  /**
   * Exports every static FSALib definition to `/editor/cache/stageassets.json`.
   *
   * This is the only place the wasm asset catalog is deserialized: it costs
   * several seconds, so it is paid once at import instead of on every stage
   * open. Must run before anything that needs tilesets/stages/actors.
   */
  private async cacheStageAssets(): Promise<void> {
    try {
      this.statusMessage.set('Caching stage assets…');
      const timer = this.logger.startTimer('UI.cacheStageAssets');
      await this.fsaLib.populateStageAssets();
      timer.stop('UI:');
    } catch (error) {
      // Non-fatal: FSALibService regenerates the catalog lazily on first use.
      this.logger.warn('UI: failed to cache stage assets (will regenerate on demand)', error);
    }
  }

  /**
   * Builds the actor-sprite icon cache used by the toolbox tabs (Items, NPC,
   * Objects, Special, Switches) for actors the actor catalog cannot draw.
   *
   * Generated here — at import time — so nothing extra is shipped with the app.
   * Non-fatal on failure (the toolbox falls back to plain cards).
   */
  private async generateActorSprites(): Promise<void> {
    try {
      this.statusMessage.set('Generating actor sprites…');
      await this.actorSprites.ensureIcons((done, total, message) => {
        this.statusMessage.set(total > 0 ? `${message} (${done}/${total})` : message);
      });
    } catch (error) {
      this.logger.warn('UI: failed to generate actor sprites (non-fatal)', error);
    }
  }

  /** Decodes the overworld map texture into `/editor/cache/image/worldmap.png`. */
  private async generateWorldmap(): Promise<void> {
    try {
      const arcPath = 'GC4swords/map1.arc';
      const texturePath = 'TIMG/kk_worldmap_01.bti';
      this.logger.info(`UI: generating /editor/${WORLDMAP_FILE} from ${arcPath}…`);

      const bytes = await this.opfs.readExtractedFile(arcPath);
      const image = await this.fsaLib.decodeArchiveTexture(bytes, texturePath);
      const pngBytes = this.dataUrlToBytes(this.fsaLib.encodePng(image));
      await this.editor.writeEditorFile(WORLDMAP_FILE, pngBytes);

      this.logger.info(
        `UI: wrote /editor/${WORLDMAP_FILE} (${image.width}x${image.height}, ${pngBytes.byteLength} bytes).`,
      );
    } catch (error) {
      this.logger.warn('UI: failed to generate editor world map (non-fatal)', error);
    }
  }

  /** Registers the game's default stages and seeds the default world. */
  private async importDefaultStages(): Promise<void> {
    try {
      this.statusMessage.set('Creating stage files…');
      const stageRefs = await this.stageService.registerDefaultStages((done, total, name) => {
        this.statusMessage.set(`Creating stage files… ${done}/${total} ${name}`);
      });

      this.statusMessage.set('Creating default world…');
      const defaultStages = stageRefs.slice(0, DEFAULT_WORLD_STAGE_COUNT);
      await this.worldService.seedDefaultWorld(defaultStages);
    } catch (error) {
      this.logger.warn('UI: failed to create default stages/world (non-fatal)', error);
    }
  }

  /**
   * Renders and caches the tileset preview images used by the stage page's theme
   * picker, so opening a stage never has to render them on the fly.
   *
   * All tilesets are rendered (including development ones) so the cache stays
   * complete regardless of which the UI chooses to show. Non-fatal on failure.
   */
  private async generateTilesetPreviews(): Promise<void> {
    try {
      const indices = Object.keys(await this.fsaLib.loadTilesets()).map((key) => Number(key));
      this.statusMessage.set('Generating tileset previews…');
      await this.stagePreview.ensureTilesetPreviews(indices, (done, total) => {
        this.statusMessage.set(`Generating tileset previews… ${done}/${total}`);
      });
    } catch (error) {
      this.logger.warn('UI: failed to generate tileset previews (non-fatal)', error);
    }
  }

  /**
   * Dumps the entire editor store (`userdata.json`, every world and stage file)
   * as a single JSON log message.
   */
  private async dumpEditorStore(): Promise<void> {
    try {
      const userdata = await this.editor.loadUserData();

      const worldIds = (userdata['worlds'] as { id: string }[] | undefined) ?? [];
      const stageIds = (userdata['stages'] as { id: string }[] | undefined) ?? [];

      const worlds: unknown[] = [];
      for (const ref of worldIds) {
        worlds.push(await this.readEditorJson(`world/${ref.id}.json`));
      }

      const stages: unknown[] = [];
      for (const ref of stageIds) {
        stages.push(await this.readEditorJson(`stage/${ref.id}.json`));
      }

      const dump = { userdata, worlds, stages };
      this.logger.info('=== EDITOR STORE DUMP ===\n' + JSON.stringify(dump, null, 2));
    } catch (error) {
      this.logger.warn('UI: failed to dump editor store (non-fatal)', error);
    }
  }

  /** Reads and parses a JSON file from `/editor`, or null when missing. */
  private async readEditorJson(relativePath: string): Promise<unknown> {
    const bytes = await this.editor.readEditorFile(relativePath);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  }

  /** Decodes a `data:...;base64,` URL into raw bytes. */
  private dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
