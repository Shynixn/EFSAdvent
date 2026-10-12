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

/** Identifies a room layer that has unsaved edits (written on save). */
export interface DirtyLayer {
  roomIndex: number;
  layerIndex: number;
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
   * Bumped every time a stage archive is saved (re-serialized). Editors use it
   * to reload the freshly parsed data and drop references to stale objects.
   */
  private readonly saveCounter = signal(0);

  /** Monotonic count of completed saves across all stages. */
  readonly saveVersion = this.saveCounter.asReadonly();

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
   * Persists pending edits to a stage's archive by re-serializing it and writing
   * it back to `/editor/stage/<id>.arc`.
   *
   * Edits are applied to the archive only here (on save): the stage's tileset
   * (`Map.TileSheetId`, stored in the map CSV headers) and every room layer the
   * canvas marked dirty. Each step re-serializes the archive, so the output of
   * one is fed into the next.
   *
   * @param stageId     Stage to save.
   * @param dirtyLayers Room layers edited since the last save (their tile arrays
   *                    are read from the in-memory `StageData`). Defaults to none.
   * @returns The new archive bytes (and the timestamp they were written), or
   *          `null` when the stage is not loaded / the save failed.
   */
  async save(
    stageId: string,
    dirtyLayers: readonly DirtyLayer[] = [],
  ): Promise<{ bytes: Uint8Array; savedAt: Date } | null> {
    const loaded = this.cache.get(stageId);
    if (!loaded) {
      this.logger.warn(`StageEditor: nothing to save for stage "${stageId}".`);
      return null;
    }

    let bytes = await this.fsaLib.setStageTileSheet(
      loaded.arcBytes,
      loaded.data.Map.TileSheetId,
    );
    if (!bytes) {
      this.logger.error(`StageEditor: failed to serialize stage "${stageId}" (tileset).`);
      return null;
    }

    // Write back each edited room layer, chaining the re-serialized archive.
    for (const { roomIndex, layerIndex } of dirtyLayers) {
      const room = loaded.data.Rooms[roomIndex];
      const tiles = room?.Layers[layerIndex]?.Tiles;
      if (!tiles) {
        this.logger.warn(
          `StageEditor: skipping missing layer ${layerIndex} of room ${roomIndex} in "${stageId}".`,
        );
        continue;
      }
      const updated = await this.fsaLib.setRoomLayer(bytes, roomIndex, layerIndex, tiles);
      if (!updated) {
        this.logger.error(
          `StageEditor: failed to serialize layer ${layerIndex} of room ${roomIndex} in "${stageId}".`,
        );
        return null;
      }
      bytes = updated;
    }

    await this.editor.writeEditorFile(stageArcFilePath(stageId), bytes);

    // The archive changed, so the cached renderer/bytes are stale. Invalidate
    // and reload so subsequent reads use the freshly written archive.
    this.cache.delete(stageId);
    if (this.current()?.id === stageId) {
      this.current.set(null);
    }
    await this.load(stageId);

    this.saveCounter.update((n) => n + 1);

    const savedAt = new Date();
    this.logger.info(
      `StageEditor: saved stage "${stageId}" ` +
        `(tileset ${loaded.data.Map.TileSheetId}, ${dirtyLayers.length} room layer(s)).`,
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
