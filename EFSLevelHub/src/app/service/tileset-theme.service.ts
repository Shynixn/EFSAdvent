import { Injectable, inject, signal } from '@angular/core';
import { FSALibService } from './fsalib.service';
import { StageEditorService } from './stage-editor.service';
import { StagePreviewService } from './stage-preview.service';
import { LoggingService } from './logging.service';
import { TilesetTheme } from '../entity/tileset.util';

/**
 * TilesetThemeService
 * -------------------
 * Shared "Theme" (tileset) setting for a stage, used by the room page's toolbox.
 *
 * A stage's tileset is a *stage-level* setting (`Map.TileSheetId`), so it must be
 * shared across every open room of that stage and reflected everywhere. To
 * achieve that this service:
 *
 * - loads the global tileset list once (from the game's `tilesets.json`),
 * - keeps the selected index per stage id as a signal (so all open rooms of the
 *   same stage observe the same value and update reactively),
 * - applies changes directly on the shared {@link StageEditorService} `StageData`
 *   graph (so the room canvas' renderer immediately reflects the new tileset),
 * - caches tileset preview thumbnails for the picker (from the ISO-import cache,
 *   with an on-demand render fallback).
 */
@Injectable({ providedIn: 'root' })
export class TilesetThemeService {
  private readonly fsaLib = inject(FSALibService);
  private readonly stageEditor = inject(StageEditorService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly logger = inject(LoggingService);

  /** Global tileset list (loaded once). */
  private readonly themeList = signal<TilesetTheme[]>([]);
  /** Preview URL per tileset index. */
  private readonly previewMap = signal<Record<number, string>>({});
  /** Selected tileset index per stage id. */
  private readonly selectedMap = signal<Record<string, number>>({});

  /** Whether the tile list / previews are loading. */
  private readonly loading = signal(false);
  private readonly previewsLoading = signal(false);

  /** Available themes, ordered by tileset index. */
  readonly themes = this.themeList.asReadonly();
  /** Preview URL per tileset index. */
  readonly previews = this.previewMap.asReadonly();
  /** Whether the theme list is loading. */
  readonly themesLoading = this.loading.asReadonly();
  /** Whether theme previews are loading. */
  readonly themePreviewsLoading = this.previewsLoading.asReadonly();

  /** One-time global load guard. */
  private loadPromise: Promise<void> | null = null;

  /**
   * Selected tileset index for a stage as a reactive signal accessor.
   *
   * Reading it inside a template/computed tracks changes, so every open room of
   * the same stage reflects a theme change made in another room.
   */
  selectedIndex(stageId: string): number {
    return this.selectedMap()[stageId] ?? this.stageEditor.get(stageId)?.data.Map.TileSheetId ?? 0;
  }

  /** Records the current theme of a stage (e.g. when the stage loads). */
  setSelected(stageId: string, index: number): void {
    this.selectedMap.update((map) => ({ ...map, [stageId]: index }));
  }

  /** Human-readable name of a stage's current theme. */
  themeName(stageId: string): string {
    const index = this.selectedIndex(stageId);
    const match = this.themeList().find((theme) => theme.index === index);
    return match?.name ?? `Tileset ${index}`;
  }

  /** Ensures the global theme list + previews are loaded (once). */
  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.loading.set(true);
    this.previewsLoading.set(true);
    try {
      let themes = this.themeList();
      if (themes.length === 0) {
        themes = await this.fsaLib.loadTilesetThemes();
        this.themeList.set(themes);
      }

      const previews: Record<number, string> = { ...this.previewMap() };
      for (const theme of themes) {
        if (previews[theme.index]) {
          continue;
        }
        try {
          // Prefer the preview cached at ISO import; render on the fly only when
          // it is missing (e.g. a stage opened before the cache was generated).
          let url = await this.stagePreview.readTilesetPreviewUrl(theme.index);
          if (!url) {
            url = await this.fsaLib.renderTilesetPreview(theme.index, new Uint8Array(0));
          }
          if (url) {
            previews[theme.index] = url;
          } else {
            this.logger.warn(`TilesetTheme: no preview for tileset ${theme.index}.`);
          }
        } catch (error) {
          this.logger.warn(
            `TilesetTheme: failed to render preview for tileset ${theme.index}`,
            error,
          );
        }
      }
      this.previewMap.set(previews);
    } finally {
      this.loading.set(false);
      this.previewsLoading.set(false);
    }
  }

  /**
   * Applies a theme to a stage by updating the shared `Map.TileSheetId` and the
   * selected-index signal. Does NOT persist — the archive is rewritten on save.
   *
   * @returns Whether the selection actually changed (so callers can flag dirty).
   */
  applyTheme(stageId: string, theme: TilesetTheme): boolean {
    const loaded = this.stageEditor.get(stageId);
    const current = loaded?.data.Map.TileSheetId ?? this.selectedMap()[stageId] ?? -1;
    if (current === theme.index) {
      return false;
    }
    if (loaded) {
      loaded.data.Map.TileSheetId = theme.index;
    }
    this.setSelected(stageId, theme.index);
    this.logger.info(
      `TilesetTheme: "${theme.name}" (tileset ${theme.index}) applied to "${stageId}".`,
    );
    return true;
  }
}
