import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../component/button/button.component';
import { LoadingModalComponent } from '../../component/loading-modal/loading-modal.component';
import { LoadingOverlayComponent } from '../../component/loading-overlay/loading-overlay.component';
import { MapGridComponent } from '../../component/map-grid/map-grid.component';
import { StageService, StageFile } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StageEditorService } from '../../service/stage-editor.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { StageRoomService } from '../../service/stage-room.service';
import { UnsavedChangesService } from '../../service/unsaved-changes.service';
import { LoggingService } from '../../service/logging.service';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';
import { nextPaint } from '../../util/paint';

/**
 * StagePage
 * ---------
 * A sub-page of "My Stages" showing a single stage's map layout as a grid of
 * rooms plus the generated thumbnail. Clicking a room opens it on the dedicated
 * room page.
 *
 * Opening the page registers a tab under the My Stages nav; the close button
 * removes the tab and returns to the stages list.
 */
@Component({
  selector: 'app-stage-page',
  imports: [ButtonComponent, LoadingModalComponent, LoadingOverlayComponent, MapGridComponent],
  templateUrl: './stage-page.html',
  styleUrl: './stage-page.css',
})
export class StagePage implements OnInit, OnDestroy {
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly stageEditor = inject(StageEditorService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly stageRoom = inject(StageRoomService);
  private readonly unsaved = inject(UnsavedChangesService);
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

  /** Blob URL of the generated thumbnail (all rooms concatenated), if any. */
  readonly thumbnailUrl = signal<string | null>(null);
  /** Error from preview generation, if any (shown instead of the thumbnail). */
  readonly previewError = signal('');

  /** Whether there are unsaved edits for this stage (tiles and/or theme). */
  readonly dirty = computed(() => this.stageEditor.isDirty(this.stageId()));
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

  /** Teardown for the `beforeunload` listener (installed while on this page). */
  private removeUnloadListener: (() => void) | null = null;

  /** Display name shown in the header (falls back to the id). */
  readonly stageName = computed(() => this.stage()?.name ?? 'Stage');

  /** Header title (the stage name). */
  readonly headerTitle = computed(() => this.stageName());

  /** Whether anything has unsaved edits for this stage. */
  readonly hasUnsavedChanges = computed(() => this.dirty());

  /**
   * Whether the Save button is actionable. Saving is always allowed (it simply
   * writes the current archive), except while a save is already running or the
   * blocking preview-generation modal is up.
   */
  readonly canSave = computed(() => !this.saving() && !this.generatingPreviews());

  ngOnInit(): void {
    // Warn before a page refresh/close while this stage has unsaved edits.
    this.removeUnloadListener = this.unsaved.preventUnload(() => this.stageId());

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
    this.removeUnloadListener?.();
  }

  /** Sets the active stage, opens its tab and loads its archive. */
  private async loadStageById(id: string): Promise<void> {
    this.stageId.set(id);
    // Tell the room service which stage's selection is now on screen.
    this.stageRoom.setActiveStage(id);
    this.thumbnailUrl.set(null);
    this.previewError.set('');

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

    // Let the loading overlay paint before the (blocking) parse/render work.
    await nextPaint();

    try {
      const loaded = await this.stageEditor.load(id);
      if (!loaded) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      this.stageData.set(loaded.data);
      this.lastSaved.set(this.stage()?.lastSaved ?? null);
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
  private async generatePreviews(
    stage: StageData,
    bytes: Uint8Array,
    force = false,
  ): Promise<void> {
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

  /** Opens a room on its dedicated room page (registers a nested tab). */
  openRoom(roomIndex: number): void {
    const emptyValue = this.stageData()?.Map.EmptyRoomValue ?? -1;
    if (roomIndex < 0 || roomIndex === emptyValue) {
      return;
    }
    const stageId = this.stageId();
    this.stageTabs.openRoom(stageId, roomIndex);
    this.stageRoom.setActiveStage(stageId);
    this.stageRoom.open(stageId, roomIndex);
    void this.router.navigate(['/my-stages', stageId, 'rooms', roomIndex]);
  }

  /**
   * The header "x": closes the stage tab and returns to the stages list. If the
   * stage has unsaved changes, a native confirm asks whether to save first.
   */
  async closeTop(): Promise<void> {
    await this.close();
  }

  /**
   * Applies pending edits back to the stage's archive and refreshes the derived
   * previews (thumbnail + room PNGs).
   *
   * Saving is always permitted — even with no pending changes it simply
   * re-writes the current archive — so the button is never a dead end.
   */
  async save(): Promise<void> {
    const id = this.stageId();
    if (this.saving() || this.generatingPreviews()) {
      return;
    }

    this.saving.set(true);
    this.previewError.set('');
    try {
      const result = await this.stageEditor.save(id, this.stageRoom.dirtyLayers());
      if (!result) {
        this.previewError.set('Failed to save the stage.');
        return;
      }

      await this.stageService.markSaved(id, result.savedAt);
      this.lastSaved.set(result.savedAt.toISOString());
      this.stageRoom.setDirty(false);
      this.stageRoom.clearDirtyLayers();

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
  async close(): Promise<void> {
    const id = this.stageId();
    // Ask about unsaved changes; when the user agrees, save before leaving.
    const proceed = await this.unsaved.confirmDiscard(id, 'close this stage', () => this.save());
    if (!proceed) {
      return;
    }
    this.stageTabs.close(id);
    // Drop the stage's room selection so reopening it starts on the map grid.
    this.stageRoom.close(id);
    void this.router.navigate(['/my-stages']);
  }
}
