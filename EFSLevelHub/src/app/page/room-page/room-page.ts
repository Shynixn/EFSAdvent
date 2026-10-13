import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../component/button/button.component';
import { SystemColumnComponent } from '../../component/system-column/system-column.component';
import { ToolboxColumnComponent } from '../../component/toolbox-column/toolbox-column.component';
import { RoomCanvasComponent, RoomTileChange } from '../../component/room-canvas/room-canvas.component';
import { ThemePickerComponent } from '../../component/theme-picker/theme-picker.component';
import { LoadingOverlayComponent } from '../../component/loading-overlay/loading-overlay.component';
import { StageService } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StageEditorService } from '../../service/stage-editor.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { StageRoomService } from '../../service/stage-room.service';
import { TilesetThemeService } from '../../service/tileset-theme.service';
import { UnsavedChangesService } from '../../service/unsaved-changes.service';
import { LoggingService } from '../../service/logging.service';
import { RoomData, StageData } from '../../entity/fsalib.entity';
import { TilesetTheme } from '../../entity/tileset.util';
import { StageRenderer } from '../../service/render/stage-renderer';
import { nextPaint } from '../../util/paint';

/**
 * RoomPage
 * --------
 * Dedicated editor for a single room of a stage, routed at
 * `my-stages/:stageId/rooms/:roomIndex`.
 *
 * Layout mirrors the stage page so the two feel of a piece:
 * - a top action bar (close + room name + save),
 * - a left toolbar panel holding the map grid (flush against the app's side
 *   nav, no spacing) for quick room swapping,
 * - the room canvas + layer controls in the middle,
 * - a toolbox on the right.
 *
 * The toolbox hosts the **Theme** setting (the stage's tileset) and hides the
 * tile palette's manual-drawing tools behind an **Advanced** collapsible
 * section. The theme lives in {@link TilesetThemeService} so it is shared across
 * every open room of the stage and reflects changes reactively.
 */
@Component({
  selector: 'app-room-page',
  imports: [
    ButtonComponent,
    LoadingOverlayComponent,
    SystemColumnComponent,
    ToolboxColumnComponent,
    RoomCanvasComponent,
    ThemePickerComponent,
  ],
  templateUrl: './room-page.html',
  styleUrl: './room-page.css',
})
export class RoomPage implements OnInit, OnDestroy {
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly stageEditor = inject(StageEditorService);
  private readonly stagePreview = inject(StagePreviewService);
  private readonly stageRoom = inject(StageRoomService);
  private readonly themeService = inject(TilesetThemeService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** Id of the stage this room belongs to. */
  readonly stageId = signal('');
  /** Room index being edited. */
  readonly roomIndex = signal(-1);

  /** Parsed stage graph (shared with the stage page). */
  readonly stageData = signal<StageData | null>(null);
  /** Display name of the stage. */
  readonly stageName = signal('Stage');
  /** The room being edited (null until loaded). */
  readonly room = signal<RoomData | null>(null);
  /** Renderer shared with the stage editor. */
  readonly renderer = signal<StageRenderer | null>(null);

  /** Whether the room is loading. */
  readonly isLoading = signal(false);
  /** Load error message, if any. */
  readonly loadError = signal('');

  /** Active layer being edited (0-7 base, 8-15 top). */
  readonly layerIndex = signal(0);
  /** Whether the GBA tileset/layer is drawn. */
  readonly gba = signal(false);
  /** Tile value painted by the editor. */
  readonly brushTile = signal(1);

  /**
   * Whether this stage has unsaved edits (tile changes and/or a theme change),
   * tracked on the shared {@link StageEditorService} so the stage page and
   * room page agree on a single per-stage flag.
   */
  readonly dirty = computed(() => this.stageEditor.isDirty(this.stageId()));

  /** Whether the "Advanced" toolbox section (manual tile drawing) is expanded. */
  readonly advancedOpen = signal(false);

  /** Whether the theme picker modal is open. */
  readonly themeOpen = signal(false);

  /** Active tileset index of the stage (shared across open rooms). */
  readonly themeIndex = computed(() => this.themeService.selectedIndex(this.stageId()));

  /** Whether the theme picker tilesets are still loading. */
  readonly themesLoading = this.themeService.themesLoading;

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

  /** Human-readable name of the stage's current tileset theme. */
  readonly themeName = computed(() => {
    const index = this.themeIndex();
    const match = this.themeService.themes().find((theme) => theme.index === index);
    return match?.name ?? `Tileset ${index}`;
  });

  /** Header title for the room. */
  readonly headerTitle = computed(() => `${this.stageName()} · Room ${this.roomIndex()}`);

  /** Whether a save can run right now. */
  readonly canSave = computed(() => !this.saving() && this.room() != null);

  /** Route param subscription; re-loads when the open room changes. */
  private paramSub: Subscription | null = null;

  /**
   * Monotonic load token: bumped on every load so a slower earlier load cannot
   * overwrite the state of a newer one (the paint yield makes overlap possible).
   */
  private loadToken = 0;

  /** Teardown for the `beforeunload` listener (installed while on this page). */
  private removeUnloadListener: (() => void) | null = null;

  /** The room canvas (used to force a redraw after a theme change). */
  private readonly roomCanvas = viewChild(RoomCanvasComponent);

  constructor() {
    // Mirror this room's dirty state into the shared service so the stage page
    // and side nav can reflect a single "unsaved changes" indicator.
    effect(() => this.stageRoom.setDirty(this.dirty()));

    // After a save the archive is re-serialized and re-parsed, so reload to
    // drop references to the stale room objects (keeping the current view).
    effect(() => {
      const version = this.stageEditor.saveVersion();
      if (version > 0) {
        void this.loadRoom(true);
      }
    });
  }

  ngOnInit(): void {
    // Warn before a page refresh/close while this stage has unsaved edits.
    // (Navigating between rooms does NOT prompt — only a full page unload.)
    this.removeUnloadListener = this.unsaved.preventUnload(() => this.stageId());

    this.paramSub = this.route.paramMap.subscribe((params) => {
      const stageId = params.get('stageId') ?? '';
      const roomIndex = Number(params.get('roomIndex') ?? '-1');
      if (stageId && roomIndex >= 0) {
        void this.load(stageId, roomIndex);
      }
    });
  }

  ngOnDestroy(): void {
    this.paramSub?.unsubscribe();
    this.removeUnloadListener?.();
  }

  /** Loads the stage + room for the given route params. */
  private async load(stageId: string, roomIndex: number): Promise<void> {
    const token = ++this.loadToken;
    const changed = stageId !== this.stageId() || roomIndex !== this.roomIndex();

    // Only show the blocking overlay when the stage archive has not been parsed
    // yet. Once a stage is loaded, switching between its rooms is instant (the
    // room data is already in memory), so no overlay is needed.
    const needsOverlay = !this.stageEditor.get(stageId);

    this.stageId.set(stageId);
    this.roomIndex.set(roomIndex);
    if (changed) {
      this.layerIndex.set(0);
      this.gba.set(false);
      this.room.set(null);
    }

    this.isLoading.set(needsOverlay);
    this.loadError.set('');

    if (needsOverlay) {
      // Let the loading overlay paint before the (blocking) parse/render work.
      await nextPaint();
      if (token !== this.loadToken) {
        return;
      }
    }

    try {
      await this.stageService.load();
      const stage = this.stageService.getById(stageId);
      if (!stage) {
        this.logger.warn(`RoomPage: unknown stage "${stageId}" — returning to My Stages.`);
        void this.router.navigate(['/my-stages']);
        return;
      }
      this.stageName.set(stage.name);
      this.lastSaved.set(stage.lastSaved ?? null);

      const loaded = await this.stageEditor.load(stageId);
      if (!loaded) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      this.stageData.set(loaded.data);
      this.renderer.set(loaded.renderer);
      // Seed the shared theme service with the stage's current tileset.
      this.themeService.setSelected(stageId, loaded.data.Map.TileSheetId);
      void this.themeService.ensureLoaded();

      const room = loaded.data.Rooms[roomIndex] ?? null;
      if (!room) {
        this.loadError.set(`Room ${roomIndex} does not exist in this stage.`);
        return;
      }
      this.room.set(room);

      // Register this room as an open tab and mark the stage active so the side
      // nav highlights it and the stage page's save picks up the edits.
      this.stageTabs.openRoom(stageId, roomIndex);
      this.stageRoom.setActiveStage(stageId);
      this.stageRoom.open(stageId, roomIndex);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to load the room.');
      this.logger.error(`RoomPage: failed to load room ${roomIndex} of "${stageId}"`, error);
    } finally {
      if (token === this.loadToken) {
        this.isLoading.set(false);
      }
    }
  }

  /** Reloads the current room (used after a save re-parses the archive). */
  private async loadRoom(keepView = false): Promise<void> {
    const stageId = this.stageId();
    const roomIndex = this.roomIndex();
    if (!stageId || roomIndex < 0) {
      return;
    }
    if (!keepView) {
      this.layerIndex.set(0);
      this.gba.set(false);
    }

    const loaded = this.stageEditor.load(stageId);
    const stage = await loaded;
    if (!stage) {
      return;
    }
    this.stageData.set(stage.data);
    this.renderer.set(stage.renderer);
    this.room.set(stage.data.Rooms[roomIndex] ?? null);
  }

  /** Records a tile edit so the layer is written back on save. */
  onTileChanged(change: RoomTileChange): void {
    this.stageEditor.setDirty(this.stageId(), true);
    this.stageRoom.markLayerDirty(this.roomIndex(), change.layerIndex);
  }

  /** Swaps to another room via the map grid. */
  selectRoom(roomIndex: number): void {
    if (roomIndex < 0 || roomIndex === this.roomIndex()) {
      return;
    }
    void this.router.navigate(['/my-stages', this.stageId(), 'rooms', roomIndex]);
  }

  /** Opens the theme picker modal (loads tileset previews lazily). */
  openTheme(): void {
    this.themeOpen.set(true);
    void this.themeService.ensureLoaded();
  }

  /** Closes the theme picker modal. */
  closeTheme(): void {
    this.themeOpen.set(false);
  }

  /**
   * Applies a tileset theme to the stage. The change is written to the shared
   * stage graph + theme service, so every open room reflects it immediately.
   */
  selectTheme(theme: TilesetTheme): void {
    if (this.themeService.applyTheme(this.stageId(), theme)) {
      this.stageEditor.setDirty(this.stageId(), true);
      // The tileset lives on the shared renderer; force the canvas to repaint.
      void this.roomCanvas()?.redraw();
    }
    this.closeTheme();
  }

  /**
   * Saves the stage (which also persists this room's dirty layers) and refreshes
   * the room from the re-parsed archive.
   */
  async save(): Promise<void> {
    const id = this.stageId();
    const roomIndex = this.roomIndex();
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      const result = await this.stageEditor.save(id, this.stageRoom.dirtyLayers());
      if (!result) {
        this.loadError.set('Failed to save the room.');
        return;
      }
      await this.stageService.markSaved(id, result.savedAt);
      this.lastSaved.set(result.savedAt.toISOString());
      this.stageRoom.setDirty(false);
      this.stageRoom.clearDirtyLayers();

      // Regenerate this room's cached preview so the stage page thumbnail /
      // map grid stay in sync with the edit.
      const loaded = this.stageEditor.get(id);
      if (loaded) {
        try {
          await this.stagePreview.ensurePreviews(id, loaded.data, loaded.arcBytes, undefined, true);
        } catch (error) {
          this.logger.warn(`RoomPage: preview refresh failed for "${id}"`, error);
        }
      }
      this.logger.info(`RoomPage: saved stage "${id}" (room ${roomIndex}).`);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to save the room.');
      this.logger.error(`RoomPage: failed to save stage "${id}"`, error);
    } finally {
      this.saving.set(false);
    }
  }

  /** Closes the room, returning to its stage page. */
  close(): void {
    const stageId = this.stageId();
    this.stageTabs.closeRoom(stageId, this.roomIndex());
    this.stageRoom.close(stageId);
    void this.router.navigate(['/my-stages', stageId]);
  }
}
