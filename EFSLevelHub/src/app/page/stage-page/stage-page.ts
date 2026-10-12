import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../component/button/button.component';
import { LoadingModalComponent } from '../../component/loading-modal/loading-modal.component';
import { ModalComponent } from '../../component/modal/modal.component';
import { StageService, StageFile } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StageEditorService } from '../../service/stage-editor.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { EditorService } from '../../service/editor.service';
import { FSALibService } from '../../service/fsalib.service';
import { LoggingService } from '../../service/logging.service';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';
import { TilesetTheme } from '../../entity/tileset.util';

/**
 * StagePage
 * ---------
 * A sub-page of "My Stages" showing a single stage's map layout as a grid of
 * rooms plus the generated thumbnail. Clicking a room opens it on the room
 * page. A toolbox on the right hosts the (currently single) Theme action.
 *
 * Opening the page registers a tab under the My Stages nav; the close button
 * removes the tab and returns to the stages list.
 */
@Component({
  selector: 'app-stage-page',
  imports: [ButtonComponent, LoadingModalComponent, ModalComponent],
  templateUrl: './stage-page.html',
  styleUrl: './stage-page.css',
})
export class StagePage implements OnInit, OnDestroy {
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly stageEditor = inject(StageEditorService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly editor = inject(EditorService);
  private readonly fsaLib = inject(FSALibService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** Id of the stage being viewed. */
  readonly stageId = signal('');
  /** Stage definition (name, author, …) for the header. */
  readonly stage = signal<StageFile | null>(null);

  /** Parsed stage graph from wasm (null until loaded). */
  readonly stageData = signal<StageData | null>(null);
  /** Whether the archive is being read/parsed. */
  readonly isLoading = signal(false);
  /** Load error message, if any. */
  readonly loadError = signal('');

  /** Whether the (blocking) preview-generation modal is open. */
  readonly generatingPreviews = signal(false);
  /** Status message shown in the preview-generation modal. */
  readonly previewMessage = signal('Preparing previews…');

  /** Whether the theme picker modal is open. */
  readonly themeOpen = signal(false);
  /** Theme options (real tilesets loaded from the game's `tilesets.json`). */
  readonly themes = signal<TilesetTheme[]>([]);
  /** Whether the theme list is still loading. */
  readonly themesLoading = signal(false);
  /** Active tileset index (bound to `Map.TileSheetId`). */
  readonly currentThemeIndex = signal(0);
  /** PNG data URL previews per tileset index (loaded when the modal opens). */
  readonly themePreviews = signal<Record<number, string>>({});
  /** Whether theme previews are loading. */
  readonly themePreviewsLoading = signal(false);
  /** Whether a preview load has completed (success or not) for this stage. */
  private readonly themePreviewsLoaded = signal(false);

  /** Blob URL of the generated thumbnail (all rooms concatenated), if any. */
  readonly thumbnailUrl = signal<string | null>(null);
  /** Error from preview generation, if any (shown instead of the thumbnail). */
  readonly previewError = signal('');

  /** Whether there are unsaved edits (e.g. a newly picked theme). */
  readonly dirty = signal(false);
  /** Whether a save is currently in flight. */
  readonly saving = signal(false);
  /** ISO timestamp of the last successful save, if any. */
  readonly lastSaved = signal<string | null>(null);

  /** `yyyy-MM-dd HH:mm` of the last save, or a placeholder when never saved. */
  readonly lastSavedLabel = computed(() => {
    const iso = this.lastSaved();
    if (!iso) {
      return 'Not saved yet';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return 'Not saved yet';
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  });

  /** Route param subscription; re-loads when the open stage tab changes. */
  private paramSub: Subscription | null = null;

  /** Display name shown in the header (falls back to the id). */
  readonly stageName = computed(() => this.stage()?.name ?? 'Stage');

  ngOnInit(): void {
    // React to the route param so switching between open stage tabs (which
    // reuses this component instance) reloads the selected stage.
    this.paramSub = this.route.paramMap.subscribe((params) => {
      const id = params.get('stageId') ?? '';
      if (id && (id !== this.stageId() || !this.stage())) {
        void this.loadStageById(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
  }

  /** Sets the active stage, opens its tab and loads its archive. */
  private async loadStageById(id: string): Promise<void> {
    this.stageId.set(id);
    this.thumbnailUrl.set(null);
    this.previewError.set('');
    // Theme previews are per-stage (the list is global, the thumbnails come from
    // the shared cache but are keyed by tileset, so just re-run the loader).
    this.themePreviewsLoaded.set(false);

    await this.stageService.load();
    const stage = this.stageService.getById(id);
    if (!stage) {
      this.logger.warn(`StagePage: unknown stage "${id}" — returning to My Stages.`);
      void this.router.navigate(['/my-stages']);
      return;
    }
    this.stage.set(stage);
    this.stageTabs.open(id);
    await this.loadStage();
  }

  /** Reads the stage archive from the editor store and parses it with wasm. */
  private async loadStage(): Promise<void> {
    const id = this.stageId();
    this.isLoading.set(true);
    this.loadError.set('');
    this.stageData.set(null);
    this.thumbnailUrl.set(null);
    this.previewError.set('');

    try {
      const loaded = await this.stageEditor.load(id);
      if (!loaded) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      this.stageData.set(loaded.data);
      this.currentThemeIndex.set(loaded.data.Map.TileSheetId);
      this.lastSaved.set(this.stage()?.lastSaved ?? null);
      this.dirty.set(false);
      this.logger.info(
        `StagePage: parsed stage ${loaded.data.Index} ` +
          `(map ${loaded.data.Map.Index}, ${loaded.data.Map.XDimension}x${loaded.data.Map.YDimension}).`,
      );

      // Generate the room previews + thumbnail (blocking modal) when missing.
      void this.generatePreviews(loaded.data, loaded.arcBytes);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to load the stage.');
      this.logger.error(`StagePage: failed to load stage "${id}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Renders/caches the stage's preview images, showing the loading modal. */
  private async generatePreviews(stage: StageData, bytes: Uint8Array, force = false): Promise<void> {
    const id = this.stageId();
    this.generatingPreviews.set(true);
    this.previewMessage.set('Generating stage previews…');
    this.previewError.set('');
    try {
      await this.stagePreview.ensurePreviews(
        id,
        stage,
        bytes,
        (progress) => {
          this.previewMessage.set(progress.message);
        },
        force,
      );
    } catch (error) {
      // Preview generation is non-fatal — the page still works without it.
      this.previewError.set(error instanceof Error ? error.message : 'Preview generation failed.');
      this.logger.error(`StagePage: preview generation failed for "${id}"`, error);
    } finally {
      this.generatingPreviews.set(false);
      await this.loadThumbnail();
    }
  }

  /** Loads the generated thumbnail as a blob URL for display. */
  private async loadThumbnail(): Promise<void> {
    const id = this.stageId();
    try {
      const url = await this.stagePreview.readThumbnailUrl(id);
      this.thumbnailUrl.set(url);
    } catch (error) {
      this.logger.error(`StagePage: failed to load thumbnail for "${id}"`, error);
    }
  }

  /** The primary map layout, if loaded. */
  map(): MapLayoutData | null {
    return this.stageData()?.Map ?? null;
  }

  /** Grid width (rooms). */
  mapWidth(): number {
    return this.stageData()?.Map.XDimension ?? 0;
  }

  /** Grid height (rooms). */
  mapHeight(): number {
    return this.stageData()?.Map.YDimension ?? 0;
  }

  /** Row index helper for iterating the grid in the template. */
  range(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i);
  }

  /** The empty-room sentinel reported by wasm. */
  emptyRoomValue(): number {
    return this.stageData()?.Map.EmptyRoomValue ?? -1;
  }

  /** Room index at (x, y) in the row-major array, or the empty sentinel. */
  roomAt(x: number, y: number): number {
    const layout = this.map();
    if (!layout) {
      return -1;
    }
    return layout.Rooms[x + y * this.mapWidth()] ?? this.emptyRoomValue();
  }

  /** True if the cell at (x, y) is empty (no room). */
  isEmpty(x: number, y: number): boolean {
    return this.roomAt(x, y) === this.emptyRoomValue();
  }

  /** True if the cell is the map's start room. */
  isStart(x: number, y: number): boolean {
    const layout = this.map();
    return !!layout && x === layout.StartX && y === layout.StartY;
  }

  /** Opens a room on the room page (registers a nested tab). */
  openRoom(roomIndex: number): void {
    if (roomIndex < 0 || roomIndex === this.emptyRoomValue()) {
      return;
    }
    void this.router.navigate(['/my-stages', this.stageId(), 'room', roomIndex]);
  }

  /** Opens the theme picker modal and (lazily) generates tileset previews. */
  openTheme(): void {
    this.themeOpen.set(true);
    void this.loadThemePreviews();
  }

  /** Closes the theme picker modal. */
  closeTheme(): void {
    this.themeOpen.set(false);
  }

  /** Renders a preview image per theme (once) for the theme picker. */
  private async loadThemePreviews(): Promise<void> {
    if (this.themePreviewsLoading() || this.themePreviewsLoaded()) {
      return;
    }
    const loaded = this.stageEditor.get(this.stageId());
    if (!loaded) {
      return;
    }

    this.themePreviewsLoading.set(true);
    try {
      this.themesLoading.set(true);

      // Load the real tileset list from the wasm (once).
      let themes = this.themes();
      if (themes.length === 0) {
        themes = await this.fsaLib.loadTilesetThemes();
        this.themes.set(themes);
      }

      const previews: Record<number, string> = {};
      for (const theme of themes) {
        if (previews[theme.index]) {
          continue;
        }
        try {
          // Prefer the preview cached at ISO import; render on the fly only when
          // it is missing (e.g. a stage opened before the cache was generated).
          let url = await this.stagePreview.readTilesetPreviewUrl(theme.index);
          if (!url) {
            url = await this.fsaLib.renderTilesetPreview(theme.index, loaded.arcBytes);
          }
          if (url) {
            previews[theme.index] = url;
          } else {
            this.logger.warn(`StagePage: no preview for tileset ${theme.index}.`);
          }
        } catch (error) {
          this.logger.warn(`StagePage: failed to render preview for tileset ${theme.index}`, error);
        }
      }
      this.themePreviews.set(previews);
      this.themePreviewsLoaded.set(true);
    } finally {
      this.themePreviewsLoading.set(false);
      this.themesLoading.set(false);
    }
  }

  /** Applies a tileset theme by setting the stage's `Map.TileSheetId`. */
  selectTheme(theme: TilesetTheme): void {
    const stage = this.stageData();
    if (!stage) {
      return;
    }
    if (stage.Map.TileSheetId !== theme.index) {
      stage.Map.TileSheetId = theme.index;
      this.dirty.set(true);
    }
    this.currentThemeIndex.set(theme.index);
    this.logger.info(`StagePage: theme "${theme.name}" (tileset ${theme.index}) selected.`);
    this.closeTheme();
  }

  /**
   * Applies pending edits back to the stage's archive and refreshes the derived
   * previews (thumbnail + room PNGs) so they reflect the new theme.
   */
  async save(): Promise<void> {
    const id = this.stageId();
    if (this.saving() || !this.dirty()) {
      return;
    }

    this.saving.set(true);
    this.previewError.set('');
    try {
      const result = await this.stageEditor.save(id);
      if (!result) {
        this.previewError.set('Failed to save the stage.');
        return;
      }

      await this.stageService.markSaved(id, result.savedAt);
      this.lastSaved.set(result.savedAt.toISOString());
      this.dirty.set(false);

      // The archive changed, so regenerate previews and refresh the thumbnail.
      const loaded = this.stageEditor.get(id);
      if (loaded) {
        this.stageData.set(loaded.data);
        await this.generatePreviews(loaded.data, loaded.arcBytes, true);
      }
      this.logger.info(`StagePage: saved stage "${id}".`);
    } catch (error) {
      this.previewError.set(error instanceof Error ? error.message : 'Failed to save the stage.');
      this.logger.error(`StagePage: failed to save stage "${id}"`, error);
    } finally {
      this.saving.set(false);
    }
  }

  /** Closes the stage tab and returns to the stages list. */
  close(): void {
    const id = this.stageId();
    this.stageTabs.close(id);
    void this.router.navigate(['/my-stages']);
  }
}
