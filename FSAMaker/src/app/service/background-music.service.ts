import { Injectable, inject, signal } from '@angular/core';
import { FSALibService } from './fsalib.service';
import { StageEditorService } from './stage-editor.service';
import { LoggingService } from './logging.service';

/**
 * A selectable background music track.
 *
 * Built from the game's `songs.json` (`FSALib.Assets.Songs`), so the list always
 * matches the ids the game understands.
 */
export interface BackgroundMusic {
  /** Song id stored in `Map.BackgroundMusicId`. */
  id: number;
  /** Human-readable track name. */
  name: string;
}

/**
 * BackgroundMusicService
 * ----------------------
 * Shared "Background music" setting for a stage, shown below the Theme dropdown
 * in the room page's System column (mirroring EFSAdvent's "BG Music:" combo).
 *
 * The music is a *stage-level* setting (`Map.BackgroundMusicId` in the map CSV
 * header), so — exactly like {@link TilesetThemeService} — this service:
 *
 * - loads the global track list once (from the ISO-import asset catalog),
 * - keeps the selected id per stage id as a signal, so every open room of the
 *   same stage observes the same value,
 * - applies changes directly on the shared {@link StageEditorService} `StageData`
 *   graph (`Map` + `MapSingleplayer`), which is what gets serialized on save.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundMusicService {
  private readonly fsaLib = inject(FSALibService);
  private readonly stageEditor = inject(StageEditorService);
  private readonly logger = inject(LoggingService);

  /** Global track list (loaded once). */
  private readonly trackList = signal<BackgroundMusic[]>([]);
  /** Selected song id per stage id. */
  private readonly selectedMap = signal<Record<string, number>>({});

  /** Whether the track list is loading. */
  private readonly loading = signal(false);

  /** Available tracks, ordered by song id. */
  readonly tracks = this.trackList.asReadonly();
  /** Whether the track list is loading. */
  readonly tracksLoading = this.loading.asReadonly();

  /** One-time global load guard. */
  private loadPromise: Promise<void> | null = null;

  /**
   * Selected song id for a stage as a reactive signal accessor.
   *
   * Reading it inside a template/computed tracks changes, so every open room of
   * the same stage reflects a music change made in another room.
   */
  selectedId(stageId: string): number {
    return (
      this.selectedMap()[stageId] ?? this.stageEditor.get(stageId)?.data.Map.BackgroundMusicId ?? 0
    );
  }

  /** Records the current music id of a stage (e.g. when the stage loads). */
  setSelected(stageId: string, id: number): void {
    this.selectedMap.update((map) => ({ ...map, [stageId]: id }));
  }

  /** Human-readable name of a stage's current track. */
  musicName(stageId: string): string {
    const id = this.selectedId(stageId);
    const match = this.trackList().find((track) => track.id === id);
    return match?.name ?? `Song ${id}`;
  }

  /** Ensures the global track list is loaded (once). */
  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.loading.set(true);
    try {
      if (this.trackList().length > 0) {
        return;
      }
      const songs = await this.fsaLib.loadSongs();
      this.trackList.set(
        Object.entries(songs)
          .map(([key, name]) => ({ id: Number(key), name: (name ?? '').trim() || `Song ${key}` }))
          .sort((a, b) => a.id - b.id),
      );
    } catch (error) {
      this.logger.warn('BackgroundMusic: failed to load the song list', error);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Applies a background music track to a stage by updating the shared
   * `Map.BackgroundMusicId` (and the single-player map, which is what the game
   * actually plays) plus the selected-id signal.
   *
   * Does NOT persist — the archive is rewritten on save.
   *
   * @returns Whether the selection actually changed (so callers can flag dirty).
   */
  applyMusic(stageId: string, id: number): boolean {
    const loaded = this.stageEditor.get(stageId);
    const current = loaded?.data.Map.BackgroundMusicId ?? this.selectedMap()[stageId] ?? -1;
    if (current === id) {
      return false;
    }
    if (loaded) {
      loaded.data.Map.BackgroundMusicId = id;
      if (loaded.data.MapSingleplayer) {
        loaded.data.MapSingleplayer.BackgroundMusicId = id;
      }
    }
    this.setSelected(stageId, id);
    this.logger.info(`BackgroundMusic: song ${id} applied to "${stageId}".`);
    return true;
  }
}
