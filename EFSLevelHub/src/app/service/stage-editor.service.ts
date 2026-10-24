import { Injectable, computed, inject, signal } from '@angular/core';
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
   * Stages with unsaved edits (tile changes and/or a theme change), keyed by
   * stage id. A stage is marked dirty when an editor mutates it and cleared on
   * a successful save — this drives the "unsaved changes" prompts at the stage
   * level (refresh / close a stage), shared by the stage and room pages.
   */
  private readonly dirtyStages = signal<Record<string, boolean>>({});

  /** Whether the given stage has unsaved edits. */
  isDirty(stageId: string): boolean {
    return this.dirtyStages()[stageId] === true;
  }

  /** Whether any stage has unsaved edits. */
  readonly hasAnyDirty = computed(() => Object.values(this.dirtyStages()).some(Boolean));

  /** Marks (or clears) a stage's unsaved-edit flag. */
  setDirty(stageId: string, dirty: boolean): void {
    if (!stageId) {
      return;
    }
    this.dirtyStages.update((map) => {
      if ((map[stageId] === true) === dirty) {
        return map;
      }
      const next = { ...map };
      if (dirty) {
        next[stageId] = true;
      } else {
        delete next[stageId];
      }
      return next;
    });
  }

  /** Clears the unsaved-edit flag for a stage. */
  clearDirty(stageId: string): void {
    this.setDirty(stageId, false);
  }

  /**
   * Loads (or returns the cached) parsed stage + renderer for `stageId`.
   *
   * @returns The loaded stage, or `null` when the archive is missing.
   */
  async load(stageId: string): Promise<LoadedStage | null> {
    const cached = this.cache.get(stageId);
    if (cached) {
      this.logger.info(`StageEditor: reusing cached stage "${stageId}".`);
      this.current.set(cached);
      return cached;
    }

    const total = this.logger.startTimer(`StageEditor.load("${stageId}")`);

    const readTimer = this.logger.startTimer('StageEditor.readArchive');
    const bytes = await this.editor.readEditorFile(stageArcFilePath(stageId));
    readTimer.stop(`StageEditor: archive "${stageId}" read`);
    if (!bytes) {
      this.logger.warn(`StageEditor: no archive for stage "${stageId}".`);
      total.stop('StageEditor: load failed —');
      return null;
    }
    this.logger.info(`StageEditor: archive "${stageId}" is ${bytes.byteLength} byte(s).`);

    const parseTimer = this.logger.startTimer('StageEditor.parseStage');
    const data = await this.fsaLib.parseStage(bytes);
    parseTimer.stop(`StageEditor: parsed archive of "${stageId}"`);

    const renderTimer = this.logger.startTimer('StageEditor.createStageRenderer');
    const renderer = await this.fsaLib.createStageRenderer(data, bytes);
    renderTimer.stop(`StageEditor: created renderer for "${stageId}"`);

    const tilesetTimer = this.logger.startTimer('StageEditor.prepareTileset');
    await renderer.prepareTileset();
    tilesetTimer.stop(`StageEditor: prepared tileset for "${stageId}"`);

    const loaded: LoadedStage = { id: stageId, data, arcBytes: bytes, renderer };
    this.cache.set(stageId, loaded);
    this.current.set(loaded);
    this.logger.info(`StageEditor: loaded stage "${stageId}" (map ${data.Map.Index}).`);
    total.stop(`StageEditor: "${stageId}" fully loaded`);
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
    dirtyActorRooms: readonly number[] = [],
  ): Promise<{ bytes: Uint8Array; savedAt: Date } | null> {
    const loaded = this.cache.get(stageId);
    if (!loaded) {
      this.logger.warn(`StageEditor: nothing to save for stage "${stageId}".`);
      return null;
    }

    let bytes = await this.fsaLib.setStageTileSheet(loaded.arcBytes, loaded.data.Map.TileSheetId);
    if (!bytes) {
      this.logger.error(`StageEditor: failed to serialize stage "${stageId}" (tileset).`);
      return null;
    }

    // The background music lives in the same map CSV headers, so it needs its
    // own re-serialization pass (`Map` + `MapSingleplayer`).
    const musicBytes = await this.fsaLib.setStageBackgroundMusic(
      bytes,
      loaded.data.Map.BackgroundMusicId,
    );
    if (!musicBytes) {
      this.logger.error(`StageEditor: failed to serialize stage "${stageId}" (background music).`);
      return null;
    }
    bytes = musicBytes;

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

    // Write back each room whose actor list changed (enemies).
    for (const roomIndex of dirtyActorRooms) {
      const actors = loaded.data.Rooms[roomIndex]?.Actors;
      if (!actors) {
        continue;
      }
      const updated = await this.fsaLib.setRoomActors(bytes, roomIndex, actors);
      if (!updated) {
        this.logger.error(
          `StageEditor: failed to serialize actors of room ${roomIndex} in "${stageId}".`,
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

    this.setDirty(stageId, false);
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

  /**
   * Creates, pastes or deletes the room bound to a map-grid cell.
   *
   * The change is written straight to the stage archive (allocating/freeing the
   * room slot and rebinding the cell in both map layouts, see
   * `FsaInterop.SetRoomSlot`), so no in-memory dirty state is involved. The cache
   * is invalidated — callers reload with {@link load} to get the new layout.
   *
   * @param stageId      Stage being edited.
   * @param x            Grid column.
   * @param y            Grid row.
   * @param copyFromRoom Room whose content is copied (paste), or -1.
   * @param deleteRoom   When true, delete the cell's room instead.
   * @returns The new archive bytes, or null when the operation failed.
   */
  async setRoomSlot(
    stageId: string,
    x: number,
    y: number,
    copyFromRoom = -1,
    deleteRoom = false,
  ): Promise<Uint8Array | null> {
    const loaded = this.cache.get(stageId);
    if (!loaded) {
      this.logger.warn(`StageEditor: nothing loaded for stage "${stageId}".`);
      return null;
    }

    const bytes = await this.fsaLib.setRoomSlot(loaded.arcBytes, x, y, copyFromRoom, deleteRoom);
    if (!bytes) {
      this.logger.error(`StageEditor: room slot update failed at ${x},${y} in "${stageId}".`);
      return null;
    }

    await this.editor.writeEditorFile(stageArcFilePath(stageId), bytes);
    this.invalidate(stageId);
    this.logger.info(
      `StageEditor: ${deleteRoom ? 'deleted' : 'created'} room at ${x},${y} in "${stageId}".`,
    );
    return bytes;
  }
}
