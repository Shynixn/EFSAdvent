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
import {
  RoomCanvasComponent,
  RoomGroundChange,
  RoomTileChange,
} from '../../component/room-canvas/room-canvas.component';
import { ThemePickerComponent } from '../../component/theme-picker/theme-picker.component';
import { LoadingOverlayComponent } from '../../component/loading-overlay/loading-overlay.component';
import { StageService, StageFile } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { StageEditorService } from '../../service/stage-editor.service';
import { StagePreviewService } from '../../service/stage-preview.service';
import { StageRoomService } from '../../service/stage-room.service';
import { TilesetThemeService } from '../../service/tileset-theme.service';
import { UnsavedChangesService } from '../../service/unsaved-changes.service';
import {
  IsoBuilderService,
  BlobIsoWriter,
  FileStreamIsoWriter,
  IsoWriter,
} from '../../service/iso-builder.service';
import { IsoSourceService } from '../../service/iso-source.service';
import { LoggingService } from '../../service/logging.service';
import { RoomData, StageData } from '../../entity/fsalib.entity';
import { GroundDefinition, GroundLayer, createGroundLayer } from '../../entity/ground.entity';
import { SmartObjectPlacement } from '../../entity/smartobject.entity';
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
  private readonly isoBuilder = inject(IsoBuilderService);
  private readonly isoSource = inject(IsoSourceService);
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
  /** Whether the paired top layer is composited over the base layer. */
  readonly topLayer = signal(true);
  /** Whether painting targets the top layer instead of the base layer. */
  readonly paintTop = signal(false);
  /** Tile value painted by the editor. */
  readonly brushTile = signal(1);

  /** Active tool: `brush` paints tiles, `hand` moves placed smart objects. */
  readonly tool = signal<'brush' | 'hand' | 'eraser'>('brush');

  /**
   * Smart objects (decorations) placed in the current room. Populated only by
   * placing a decoration (never derived from tiles) and persisted to the stage
   * JSON on save.
   */
  readonly smartObjects = signal<SmartObjectPlacement[]>([]);

  /**
   * Ground layers painted in the current room (one entry per base layer).
   * Persisted to the stage JSON on save; `0` tiles mean "unpainted".
   */
  readonly groundLayers = signal<GroundLayer[]>([]);

  /** Currently selected ground for the ground brush (null = tile brush). */
  readonly selectedGround = signal<GroundDefinition | null>(null);

  /** Selected ground's id (bound to the toolbox Ground box). */
  readonly selectedGroundId = computed(() => this.selectedGround()?.id ?? '');

  /**
   * The ground grid for the active base layer (row-major tile ids, `null` when
   * this layer has no ground painted yet). Drawn under the room layers.
   */
  readonly activeGroundTiles = computed<number[] | null>(() => {
    const base = this.layerIndex();
    const layer = this.groundLayers().find((entry) => entry.baseLayerId === base);
    return layer ? layer.bottomLayerTiles : null;
  });

  /** Whether the brush currently paints ground (a ground is selected). */
  readonly groundMode = computed(() => this.selectedGround() !== null);

  /** Tile id painted by the ground brush (0 when no ground is selected). */
  readonly groundTile = computed(() => this.selectedGround()?.tile ?? 0);

  /**
   * The stage's definition file as last read from disk (null while loading).
   * The displayed {@link stageJson} is derived from this plus the current
   * room's in-memory smart objects, so the preview reflects unsaved edits.
   */
  private readonly stageFile = signal<StageFile | null>(null);

  /**
   * Live, pretty-printed JSON of the stage's definition file with the current
   * room's in-memory smart objects and ground merged in — so newly placed/
   * moved decorations and painted ground show here immediately, before a save.
   */
  readonly stageJson = computed<string | null>(() => {
    const file = this.stageFile();
    if (!file) {
      return null;
    }
    const grid = this.roomGridPosition();
    if (!grid) {
      return JSON.stringify(file, null, 2);
    }
    const merged = this.composeRoomRecord(file, grid);
    return JSON.stringify(merged, null, 2);
  });

  /**
   * Returns a copy of the stage file with this room's in-memory smart objects
   * and ground merged into its `rooms` array (reflecting unsaved edits).
   */
  private composeRoomRecord(file: StageFile, grid: { row: number; col: number }): StageFile {
    const placements = this.smartObjects();
    const ground = this.groundLayers().filter(
      (layer) =>
        layer.bottomLayerTiles.some((t) => t !== 0) || layer.topLayerTiles.some((t) => t !== 0),
    );
    const rooms = (file.rooms ?? []).filter(
      (room) => !(room.row === grid.row && room.col === grid.col),
    );
    if (placements.length > 0 || ground.length > 0) {
      const entry: (typeof rooms)[number] = {
        row: grid.row,
        col: grid.col,
        smartObjects: placements,
      };
      if (ground.length > 0) {
        entry.ground = ground;
      }
      rooms.push(entry);
    }
    return { ...file, rooms: rooms.length > 0 ? rooms : undefined };
  }

  /**
   * Whether this stage has unsaved edits (tile changes and/or a theme change),
   * tracked on the shared {@link StageEditorService} so the stage page and
   * room page agree on a single per-stage flag.
   */
  readonly dirty = computed(() => this.stageEditor.isDirty(this.stageId()));

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

  /** Whether a source ISO is available for a test export. */
  readonly canExport = signal(false);

  /** Whether an export is currently in flight (drives the loading overlay). */
  readonly exporting = signal(false);

  /** Whether the "Export Test ISO" button is actionable. */
  readonly canSaveAndExport = computed(
    () => !this.saving() && !this.exporting() && this.canExport() && this.room() != null,
  );

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

  /**
   * Snapshot of the ground grids baked into the room layers at the last save,
   * keyed by base layer id. Used to revert ground tiles that were removed since
   * the previous save (the room layer would otherwise keep them forever).
   */
  private bakedGround = new Map<number, { bottom: number[]; top: number[] }>();

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
      this.selectedGround.set(null);
      // A different room's layers are about to be shown; forget what we baked.
      this.bakedGround.clear();
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

      // Load any smart objects + ground previously recorded for this room.
      const grid = this.roomGridPosition();
      const record = grid
        ? await this.stageService.getRoomRecord(stageId, grid.row, grid.col)
        : null;
      this.smartObjects.set(record?.smartObjects ?? []);
      this.groundLayers.set((record?.ground ?? []).map((layer) => ({ ...layer })));

      // Show the stage's current definition file in the System column.
      this.stageFile.set(await this.stageService.getStageFile(stageId));

      // Register this room as an open tab and mark the stage active so the side
      // nav highlights it and the stage page's save picks up the edits.
      this.stageTabs.openRoom(stageId, roomIndex);
      this.stageRoom.setActiveStage(stageId);
      this.stageRoom.open(stageId, roomIndex);

      // Whether a test ISO can be exported (a source disc image must be saved).
      void this.isoSource.exists().then((has) => this.canExport.set(has));
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

  /**
   * Records a ground edit: the canvas already wrote the tile into the active
   * ground grid, so here we just flag the stage dirty and remember the change.
   * Ground lives in the stage JSON (not the room archive), so no archive layer
   * needs re-serializing.
   */
  onGroundChanged(change: RoomGroundChange): void {
    this.stageEditor.setDirty(this.stageId(), true);
    this.groundLayers.update((layers) => {
      const existing = layers.find((layer) => layer.baseLayerId === change.baseLayerId);
      if (existing) {
        // Clone so the signal value changes identity and dependent computed
        // values (e.g. the live stage JSON preview) re-evaluate.
        return layers.map((layer) =>
          layer === existing
            ? {
                ...layer,
                bottomLayerTiles: [...layer.bottomLayerTiles],
                topLayerTiles: [...layer.topLayerTiles],
              }
            : layer,
        );
      }
      // First paint on this layer: create its ground grids and copy in the tile.
      const created = createGroundLayer(change.baseLayerId);
      created.bottomLayerTiles[change.y * 32 + change.x] = change.tile;
      return [...layers, created];
    });
  }

  /** Selects a ground for the ground brush and switches to the brush tool. */
  selectGround(ground: GroundDefinition): void {
    this.selectedGround.set(ground);
    // Painting ground requires the brush, so select it automatically.
    this.tool.set('brush');
  }

  /** Clears the selected ground (returns to the tile brush). */
  clearGround(): void {
    this.selectedGround.set(null);
  }

  /** Switches to the hand tool when the user starts dragging a decoration. */
  onDecorationDragStarted(): void {
    this.tool.set('hand');
  }

  /**
   * Removes every smart object (decoration) and all ground painted in the
   * current room from the stage JSON. The room's tile layers are left as-is
   * (decorations already stamped their tiles into the archive on save), so this
   * only clears the semantic records in the stage definition file.
   */
  clearRoomData(): void {
    this.stageEditor.setDirty(this.stageId(), true);
    this.smartObjects.set([]);
    this.groundLayers.set([]);
  }

  /**
   * Records a placed decoration: its tiles were already stamped onto the room
   * layers by the canvas, so here we mark both the base and top layers dirty
   * (they are persisted to the archive on save) and remember the placement so
   * it can be written to the stage JSON.
   */
  onDecorationPlaced(placement: SmartObjectPlacement): void {
    this.stageEditor.setDirty(this.stageId(), true);
    const base = placement.baseLayerId;
    this.stageRoom.markLayerDirty(this.roomIndex(), base);
    this.stageRoom.markLayerDirty(this.roomIndex(), base + 8);
    this.smartObjects.update((list) => [...list, placement]);
  }

  /**
   * Records a moved decoration: the canvas already cleared the old tiles and
   * stamped the new ones, so here we replace the placement in the list and mark
   * both layers dirty.
   */
  onDecorationMoved(event: { from: SmartObjectPlacement; to: SmartObjectPlacement }): void {
    this.stageEditor.setDirty(this.stageId(), true);
    const base = event.to.baseLayerId;
    this.stageRoom.markLayerDirty(this.roomIndex(), base);
    this.stageRoom.markLayerDirty(this.roomIndex(), base + 8);
    this.smartObjects.update((list) =>
      list.map((placement) => (placement === event.from ? event.to : placement)),
    );
  }

  /**
   * Records a rotated decoration: the canvas already cleared the old variant's
   * tiles and stamped the next one, so here we replace the placement and mark
   * both layers dirty.
   */
  onDecorationRotated(event: { from: SmartObjectPlacement; to: SmartObjectPlacement }): void {
    this.stageEditor.setDirty(this.stageId(), true);
    const base = event.to.baseLayerId;
    this.stageRoom.markLayerDirty(this.roomIndex(), base);
    this.stageRoom.markLayerDirty(this.roomIndex(), base + 8);
    this.smartObjects.update((list) =>
      list.map((placement) => (placement === event.from ? event.to : placement)),
    );
  }

  /**
   * Records a deleted decoration: the canvas already cleared its stamped tiles,
   * so here we drop the placement from the room list and mark both layers dirty.
   */
  onDecorationDeleted(placement: SmartObjectPlacement): void {
    this.stageEditor.setDirty(this.stageId(), true);
    const base = placement.baseLayerId;
    this.stageRoom.markLayerDirty(this.roomIndex(), base);
    this.stageRoom.markLayerDirty(this.roomIndex(), base + 8);
    this.smartObjects.update((list) => list.filter((entry) => entry !== placement));
  }

  /**
   * Room grid position (row/col) of the currently open room, derived from the
   * map layout's row-major `Rooms` array. Returns null when unknown.
   */
  private roomGridPosition(): { row: number; col: number } | null {
    const layout = this.stageData()?.Map;
    if (!layout) {
      return null;
    }
    const index = layout.Rooms.indexOf(this.roomIndex());
    if (index < 0) {
      return null;
    }
    const cols = layout.XDimension || 1;
    return { row: Math.floor(index / cols), col: index % cols };
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
   * Bakes the painted ground into the room's tile layers so it is written into
   * the stage archive (.arc) on save.
   *
   * Ground is stored separately from the room layers (in the stage JSON) so the
   * canvas can draw it as an underlay. On save each ground grid is composed into
   * the room's base layer (and its paired top layer):
   *
   * - where ground is painted and no smart object covers the tile, the ground
   *   tile is written (ground acts as the room's base layer);
   * - where ground was painted at the **previous** save but is now empty, the
   *   stale baked tile is cleared, so erasing ground actually removes it from the
   *   archive;
   * - **intersections**: a smart object wins. Its base-layer tiles are written
   *   over the ground, and the ground that sat under them is not baked (one tile
   *   can only hold one value). Decoration tiles on the paired top layer never
   *   hide ground, so the ground underneath them is still baked.
   *
   * Marks the affected layers dirty so {@link StageEditorService.save} writes
   * them back.
   */
  private bakeGroundIntoRoom(): void {
    const room = this.room();
    const roomIndex = this.roomIndex();
    if (!room) {
      return;
    }
    const DIM = 32;
    const groundLayers = this.groundLayers();
    const bases = new Set<number>([
      ...groundLayers.map((layer) => layer.baseLayerId),
      ...this.bakedGround.keys(),
    ]);

    for (const base of bases) {
      const bottomLayer = room.Layers[base];
      const topLayer = room.Layers[base + 8];
      const ground = groundLayers.find((layer) => layer.baseLayerId === base);
      const baked = this.bakedGround.get(base);
      const nextBottom = new Array<number>(DIM * DIM).fill(0);
      const nextTop = new Array<number>(DIM * DIM).fill(0);
      let changed = false;

      // Tiles a smart object owns on this base layer (its own tiles win over
      // ground on the base layer; top-layer tiles never hide ground).
      const owned = new Set<number>();
      for (const placement of this.smartObjects()) {
        if (placement.baseLayerId !== base) {
          continue;
        }
        for (const ref of placement.bottomLayerTiles) {
          owned.add(ref.row * DIM + ref.col);
        }
      }

      for (let offset = 0; offset < DIM * DIM; offset++) {
        const tile = ground ? ground.bottomLayerTiles[offset] : 0;
        const top = ground ? ground.topLayerTiles[offset] : 0;
        const hadGround = (baked?.bottom[offset] ?? 0) !== 0 || (baked?.top[offset] ?? 0) !== 0;

        // Base tile: ground wins unless a smart object owns the tile.
        if (tile !== 0 && !owned.has(offset)) {
          if (bottomLayer && bottomLayer.Tiles[offset] !== tile) {
            bottomLayer.Tiles[offset] = tile;
            changed = true;
          }
          nextBottom[offset] = tile;
        } else if (hadGround && !owned.has(offset)) {
          // Ground was baked here before but is gone now: clear the stale tile.
          if (bottomLayer && bottomLayer.Tiles[offset] !== 0) {
            bottomLayer.Tiles[offset] = 0;
            changed = true;
          }
        }

        // Paired top layer: ground top tiles are always baked (nothing hides
        // them except a ground top tile at the same spot).
        if (top !== 0) {
          if (topLayer && topLayer.Tiles[offset] !== top) {
            topLayer.Tiles[offset] = top;
            changed = true;
          }
          nextTop[offset] = top;
        } else if (baked && baked.top[offset] !== 0) {
          if (topLayer && topLayer.Tiles[offset] !== 0) {
            topLayer.Tiles[offset] = 0;
            changed = true;
          }
        }
      }

      if (ground) {
        this.bakedGround.set(base, { bottom: nextBottom, top: nextTop });
      } else {
        this.bakedGround.delete(base);
      }
      if (changed) {
        this.stageRoom.markLayerDirty(roomIndex, base);
        this.stageRoom.markLayerDirty(roomIndex, base + 8);
      }
    }
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
    // Let the "Saving..." overlay paint before the (blocking) serialization.
    await nextPaint();
    try {
      // Stamp the painted ground into the room layers first so it is baked into
      // the archive by the save below (ground otherwise only lives in the JSON).
      this.bakeGroundIntoRoom();
      const result = await this.stageEditor.save(id, this.stageRoom.dirtyLayers());
      if (!result) {
        this.loadError.set('Failed to save the room.');
        return;
      }
      await this.stageService.markSaved(id, result.savedAt);
      this.lastSaved.set(result.savedAt.toISOString());
      this.stageRoom.setDirty(false);
      this.stageRoom.clearDirtyLayers();

      // Persist the room's smart objects + ground into the stage JSON (after
      // markSaved, which also rewrites that file, so the two do not clobber
      // each other).
      const grid = this.roomGridPosition();
      if (grid) {
        const ground = this.groundLayers().filter(
          (layer) =>
            layer.bottomLayerTiles.some((t) => t !== 0) || layer.topLayerTiles.some((t) => t !== 0),
        );
        await this.stageService.saveRoomSmartObjects(
          id,
          grid.row,
          grid.col,
          this.smartObjects(),
          ground,
        );
      }

      // Refresh the displayed stage JSON now that it has been rewritten.
      this.stageFile.set(await this.stageService.getStageFile(id));

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

  /**
   * Saves the current room, then builds a "test" ISO in which every stage slot
   * is replaced with this stage's archive, prompting the user to save it.
   *
   * Uses the File System Access API's save picker when available; otherwise
   * falls back to a standard blob download.
   */
  async saveAndExportTestIso(): Promise<void> {
    const stageId = this.stageId();
    if (!this.canSaveAndExport()) {
      return;
    }

    // Persist the current edits first so the exported archive includes them.
    await this.save();
    if (this.stageEditor.isDirty(stageId)) {
      // The save failed — do not export a stale archive.
      return;
    }

    const suggestedName = `${(this.stageName() || 'stage').replace(/[^\w.-]+/g, '_')}_test.iso`;

    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn })
      .showSaveFilePicker;
    let writer: IsoWriter;
    if (picker) {
      let handle: FileSystemFileHandle;
      try {
        handle = await picker({
          suggestedName,
          types: [
            { description: 'GameCube ISO', accept: { 'application/octet-stream': ['.iso'] } },
          ],
        });
      } catch {
        // User cancelled the save dialog — do nothing.
        return;
      }
      writer = new FileStreamIsoWriter(await handle.createWritable());
    } else {
      writer = new BlobIsoWriter();
    }

    const blobWriter = writer instanceof BlobIsoWriter ? writer : null;

    this.exporting.set(true);
    try {
      const result = await this.isoBuilder.exportTestIso(stageId, writer);

      if (blobWriter) {
        this.downloadBlob(blobWriter.toBlob(), suggestedName);
      }
      this.logger.info(
        `RoomPage: test ISO export done — first slot replaced with stage "${stageId}" ` +
          `(${result.retargetedArcs} re-indexed, ${this.formatBytes(result.outputSize)}).`,
      );
    } catch (error) {
      this.logger.error('RoomPage: test ISO export failed', error);
    } finally {
      this.exporting.set(false);
    }
  }

  /** Triggers a browser download of the given blob via a temporary link. */
  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Formats a byte count for display. */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/** Minimal typing for `window.showSaveFilePicker`. */
type SaveFilePickerFn = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;
