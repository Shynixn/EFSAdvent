import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../component/button/button.component';
import { LoadingModalComponent } from '../../component/loading-modal/loading-modal.component';
import {
  RoomCanvasComponent,
  RoomTileChange,
} from '../../component/room-canvas/room-canvas.component';
import { StageService, StageFile, stageArcFilePath } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { EditorService } from '../../service/editor.service';
import { FSALibService } from '../../service/fsalib.service';
import { LoggingService } from '../../service/logging.service';
import { MapLayoutData, RoomData, StageData } from '../../entity/fsalib.entity';
import { ImageBuffer } from '../../service/render/gba-tile-renderer';
import {
  RenderOptions,
  VISIBLE_ROOM_HEIGHT,
  VISIBLE_ROOM_WIDTH,
  StageRenderer,
} from '../../service/render/stage-renderer';

/**
 * StagePage
 * ---------
 * A sub-page of "My Stages" showing a single stage's map layout as a grid of
 * rooms. Clicking a room renders it (base + top layers) to a preview image.
 *
 * Opening the page registers a tab under the My Stages nav; the close button
 * removes the tab and returns to the stages list.
 */
@Component({
  selector: 'app-stage-page',
  imports: [ButtonComponent, LoadingModalComponent, RoomCanvasComponent],
  templateUrl: './stage-page.html',
  styleUrl: './stage-page.css',
})
export class StagePage implements OnInit, OnDestroy {
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
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

  /** Room index the user last clicked (highlighted in the grid). */
  readonly selectedRoom = signal<number | null>(null);
  /** PNG data URL of the selected room's render. */
  readonly roomRenderUrl = signal<string | null>(null);
  /** Whether the selected room is rendering. */
  readonly isRenderingRoom = signal(false);
  /** Room-render error message, if any. */
  readonly renderError = signal('');

  /** Whether the (blocking) preview-generation modal is open. */
  readonly generatingPreviews = signal(false);
  /** Status message shown in the preview-generation modal. */
  readonly previewMessage = signal('Preparing previews…');

  // --- Room editor state ----------------------------------------------------

  /** The room currently open in the editor (null when none). */
  readonly editorRoom = signal<RoomData | null>(null);
  /** Renderer used by the editor canvas (built lazily). */
  readonly editorRenderer = signal<StageRenderer | null>(null);
  /** Active layer being edited (0-7 base, 8-15 top). */
  readonly editorLayer = signal(0);
  /** Whether the editor draws the GBA tileset/layers. */
  readonly editorGba = signal(false);
  /** Tile value painted by the editor. */
  readonly brushTile = signal(1);
  /** Whether the stage has unsaved edits. */
  readonly dirty = signal(false);

  /** Blob URL of the generated thumbnail (all rooms concatenated), if any. */
  readonly thumbnailUrl = signal<string | null>(null);
  /** Error from preview generation, if any (shown instead of the thumbnail). */
  readonly previewError = signal('');

  /** Stage renderer for the loaded archive, built lazily on first render. */
  private stageRenderer: StageRenderer | null = null;
  /** Raw stage archive bytes, kept so the renderer can re-read resources. */
  private arcBytes: Uint8Array | null = null;

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
    this.stageRenderer = null;
    this.arcBytes = null;
  }

  /** Sets the active stage, opens its tab and loads its archive. */
  private async loadStageById(id: string): Promise<void> {
    this.stageId.set(id);
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
    this.selectedRoom.set(null);
    this.roomRenderUrl.set(null);
    this.renderError.set('');
    this.stageRenderer = null;
    this.arcBytes = null;
    this.thumbnailUrl.set(null);
    this.previewError.set('');

    try {
      const bytes = await this.editor.readEditorFile(stageArcFilePath(id));
      if (!bytes) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      this.arcBytes = bytes;

      const stage = await this.fsaLib.parseStage(bytes);
      this.stageData.set(stage);
      this.logger.info(
        `StagePage: parsed stage ${stage.Index} ` +
          `(map ${stage.Map.Index}, ${stage.Map.XDimension}x${stage.Map.YDimension}).`,
      );

      // Build the shared renderer now (used by the room editor + previews) so
      // the tileset/palette is ready before any room is opened.
      void this.prepareRenderer(stage, bytes);

      // Generate the room previews + thumbnail (blocking modal) when missing.
      void this.generatePreviews(stage, bytes);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to load the stage.');
      this.logger.error(`StagePage: failed to load stage "${id}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Builds the shared renderer and pre-loads its tileset on stage load. */
  private async prepareRenderer(stage: StageData, bytes: Uint8Array): Promise<void> {
    try {
      if (!this.stageRenderer) {
        this.stageRenderer = await this.fsaLib.createStageRenderer(stage, bytes);
      }
      await this.stageRenderer.prepareTileset();
      this.editorRenderer.set(this.stageRenderer);
    } catch (error) {
      this.logger.error(`StagePage: failed to build the stage renderer`, error);
    }
  }

  /** Renders/caches the stage's preview images, showing the loading modal. */
  private async generatePreviews(stage: StageData, bytes: Uint8Array): Promise<void> {
    const id = this.stageId();
    this.generatingPreviews.set(true);
    this.previewMessage.set('Generating stage previews…');
    this.previewError.set('');
    try {
      await this.stagePreview.ensurePreviews(id, stage, bytes, (progress) => {
        this.previewMessage.set(progress.message);
      });
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

  /** Selects a room: shows its preview and opens it in the room editor. */
  selectRoom(roomIndex: number): void {
    if (roomIndex < 0 || roomIndex === this.emptyRoomValue()) {
      return;
    }
    this.selectedRoom.set(roomIndex);
    void this.renderRoom(roomIndex);
    this.openRoomEditor(roomIndex);
  }

  /**
   * Opens a room in the editor canvas. The renderer is built on stage load
   * ({@link prepareRenderer}); this only selects the room.
   */
  private openRoomEditor(roomIndex: number): void {
    const stage = this.stageData();
    if (!stage) {
      return;
    }
    this.editorRoom.set(stage.Rooms[roomIndex] ?? null);
  }

  /** Applies a tile edit from the room editor and marks the stage dirty. */
  onTileChanged(change: RoomTileChange): void {
    this.dirty.set(true);
    this.logger.debug(
      `StagePage: tile edit layer ${change.layerIndex} (${change.x},${change.y}) = ${change.tile}`,
    );
  }

  /**
   * Selects a room and shows its preview. Uses the cached `room_<index>.png`
   * image when available, falling back to a live render only if it is missing.
   */
  private async renderRoom(roomIndex: number): Promise<void> {
    const stage = this.stageData();
    const bytes = this.arcBytes;
    if (!stage || !bytes) {
      this.renderError.set('Stage is not loaded.');
      return;
    }

    this.isRenderingRoom.set(true);
    this.renderError.set('');

    try {
      // Prefer the cached preview generated when the stage was opened.
      const cached = await this.stagePreview.readRoomPreviewUrl(this.stageId(), roomIndex);
      if (cached) {
        this.roomRenderUrl.set(cached);
        return;
      }

      // Cache miss — render it live.
      if (!this.stageRenderer) {
        this.stageRenderer = await this.fsaLib.createStageRenderer(stage, bytes);
      }

      // Render into a cropped-height buffer: the renderer's writes below the
      // visible area are skipped, dropping the band the game hides.
      const target = new ImageBuffer(VISIBLE_ROOM_WIDTH, VISIBLE_ROOM_HEIGHT);
      target.fill(0, 0, 0, 255);
      await this.stageRenderer.draw(target, roomIndex, 0, RenderOptions.Layers);
      this.roomRenderUrl.set(this.fsaLib.encodePng(target));
    } catch (error) {
      this.renderError.set(error instanceof Error ? error.message : 'Failed to render the room.');
      this.logger.error(`StagePage: failed to render room ${roomIndex}`, error);
    } finally {
      this.isRenderingRoom.set(false);
    }
  }

  /** Closes the stage tab and returns to the stages list. */
  close(): void {
    const id = this.stageId();
    this.stageTabs.close(id);
    void this.router.navigate(['/my-stages']);
  }
}
