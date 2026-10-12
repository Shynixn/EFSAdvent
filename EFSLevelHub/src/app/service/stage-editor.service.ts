import { Injectable, inject, signal } from '@angular/core';
import { EditorService } from './editor.service';
import { FSALibService } from './fsalib.service';
import { LoggingService } from './logging.service';
import { stageArcFilePath } from './stage.service';
import { StageData } from '../entity/fsalib.entity';
import { StageRenderer } from './render/stage-renderer';

/** A parsed stage plus its archive bytes and renderer, ready for editing. */
export interface LoadedStage {
  id: string;
  data: StageData;
  arcBytes: Uint8Array;
  renderer: StageRenderer;
}

/**
 * StageEditorService
 * ------------------
 * Shared, per-stage editor state. Loading a stage parses its archive once and
 * builds a {@link StageRenderer}, then caches the result so both the stage page
 * and the room page reuse the same instance (no re-parse, no re-load of the
 * tileset) and — importantly — edits to the room layers share one
 * {@link StageData} graph.
 */
@Injectable({ providedIn: 'root' })
export class StageEditorService {
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
  private readonly logger = inject(LoggingService);

  /** Cache keyed by stage id. */
  private readonly cache = new Map<string, LoadedStage>();

  /** The most recently loaded stage (drives reactive UI). */
  private readonly current = signal<LoadedStage | null>(null);

  /** The currently loaded stage, if any. */
  readonly loaded = this.current.asReadonly();

  /**
   * Loads (or returns the cached) parsed stage + renderer for `stageId`.
   *
   * @returns The loaded stage, or `null` when the archive is missing.
   */
  async load(stageId: string): Promise<LoadedStage | null> {
    const cached = this.cache.get(stageId);
    if (cached) {
      this.current.set(cached);
      return cached;
    }

    const bytes = await this.editor.readEditorFile(stageArcFilePath(stageId));
    if (!bytes) {
      this.logger.warn(`StageEditor: no archive for stage "${stageId}".`);
      return null;
    }

    const data = await this.fsaLib.parseStage(bytes);
    const renderer = await this.fsaLib.createStageRenderer(data, bytes);
    await renderer.prepareTileset();

    const loaded: LoadedStage = { id: stageId, data, arcBytes: bytes, renderer };
    this.cache.set(stageId, loaded);
    this.current.set(loaded);
    this.logger.info(`StageEditor: loaded stage "${stageId}" (map ${data.Map.Index}).`);
    return loaded;
  }

  /** Returns a previously loaded stage without triggering a load. */
  get(stageId: string): LoadedStage | null {
    return this.cache.get(stageId) ?? null;
  }

  /**
   * Persists pending edits to a stage's archive by re-serializing it with the
   * current in-memory `StageData` and writing it back to `/editor/stage/<id>.arc`.
   *
   * Right now the only persisted change is the stage's tileset
   * (`Map.TileSheetId`), which lives in the map CSV header; the wasm re-writes
   * the archive so the change survives a reload and stays in sync with the theme
   * picked in the UI.
   *
   * @returns The new archive bytes (and the timestamp they were written), or
   *          `null` when the stage is not loaded / the save failed.
   */
  async save(stageId: string): Promise<{ bytes: Uint8Array; savedAt: Date } | null> {
    const loaded = this.cache.get(stageId);
    if (!loaded) {
      this.logger.warn(`StageEditor: nothing to save for stage "${stageId}".`);
      return null;
    }

    const bytes = await this.fsaLib.setStageTileSheet(loaded.arcBytes, loaded.data.Map.TileSheetId);
    if (!bytes) {
      this.logger.error(`StageEditor: failed to serialize stage "${stageId}".`);
      return null;
    }

    await this.editor.writeEditorFile(stageArcFilePath(stageId), bytes);

    // The archive changed, so the cached renderer/bytes are stale. Invalidate
    // and reload so subsequent reads use the freshly written archive.
    this.cache.delete(stageId);
    if (this.current()?.id === stageId) {
      this.current.set(null);
    }
    await this.load(stageId);

    const savedAt = new Date();
    this.logger.info(
      `StageEditor: saved stage "${stageId}" (tileset ${loaded.data.Map.TileSheetId}).`,
    );
    return { bytes, savedAt };
  }

  /** Drops a stage from the cache (e.g. after it is edited/re-serialized). */
  invalidate(stageId: string): void {
    this.cache.delete(stageId);
    if (this.current()?.id === stageId) {
      this.current.set(null);
    }
  }
}
