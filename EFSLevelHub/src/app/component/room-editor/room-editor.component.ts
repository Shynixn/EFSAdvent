import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RoomCanvasComponent, RoomTileChange } from '../room-canvas/room-canvas.component';
import { MapGridComponent } from '../map-grid/map-grid.component';
import { StageEditorService } from '../../service/stage-editor.service';
import { StageRoomService } from '../../service/stage-room.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { LoggingService } from '../../service/logging.service';
import { RoomData, StageData } from '../../entity/fsalib.entity';
import { StageRenderer } from '../../service/render/stage-renderer';

/**
 * RoomEditorComponent
 * -------------------
 * The main room editor: renders a single room on {@link RoomCanvasComponent}
 * (editable canvas + tile selection) together with a layer selector and a GBA
 * toggle.
 *
 * It is embedded by the stage page and swapped in *instead of* the map grid +
 * thumbnail when a room is opened. It deliberately has no header of its own —
 * the stage page's single "x" closes the room first and then the stage.
 *
 * Two pieces of chrome assist with quick navigation and advanced editing:
 * a floating {@link MapGridComponent} card (top-left) to swap rooms without
 * leaving the editor, and a toolbox card on the right. The toolbox shows the
 * stage's theme as a (read-only) stage setting and hides the tile palette's
 * "manual draw" tooling behind an **Advanced** collapsible section.
 */
@Component({
  selector: 'app-room-editor',
  imports: [RoomCanvasComponent, MapGridComponent],
  templateUrl: './room-editor.component.html',
  styleUrl: './room-editor.component.css',
})
export class RoomEditorComponent implements OnChanges {
  private readonly stageEditor = inject(StageEditorService);
  private readonly stageRoom = inject(StageRoomService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly logger = inject(LoggingService);

  /** Id of the stage this room belongs to. */
  @Input() stageId = '';
  /** Room index being edited. */
  @Input() roomIndex = -1;
  /**
   * The parsed stage (shared with the stage page) — used by the quick-swap map
   * grid card. Optional so the editor still works when rendered standalone.
   */
  @Input() stageData: StageData | null = null;
  /** Display name of the stage's current tileset theme (read-only setting). */
  @Input() themeName = '';

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
  gba = signal(false);
  /** Tile value painted by the editor. */
  readonly brushTile = signal(1);
  /** Whether the room has unsaved edits. */
  readonly dirty = signal(false);

  /** Whether the "Advanced" toolbox section (manual tile drawing) is expanded. */
  readonly advancedOpen = signal(false);
  /** Whether the floating quick-swap map grid card is shown. */
  readonly gridCardOpen = signal(true);

  /** Whether the map-grid quick-swap card can be shown. */
  readonly hasStageData = computed(() => !!this.stageData?.Map);

  constructor() {
    // Mirror this room's dirty state into the shared service so the stage
    // page's header can show a single "Unsaved changes" indicator.
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stageId'] || changes['roomIndex']) {
      void this.loadRoom();
    }
  }

  /** Loads the stage editor state and selects the requested room. */
  private async loadRoom(keepView = false): Promise<void> {
    const stageId = this.stageId;
    const roomIndex = this.roomIndex;
    if (!stageId || roomIndex < 0) {
      return;
    }

    this.isLoading.set(true);
    this.loadError.set('');
    this.room.set(null);
    this.dirty.set(false);
    if (!keepView) {
      this.layerIndex.set(0);
      this.gba.set(false);
    }

    try {
      const loaded = await this.stageEditor.load(stageId);
      if (!loaded) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      // Adopt the shared stage graph when the host did not supply it, so the
      // quick-swap map grid card still works.
      if (!this.stageData) {
        this.stageData = loaded.data;
      }
      const room = loaded.data.Rooms[roomIndex] ?? null;
      if (!room) {
        this.loadError.set(`Room ${roomIndex} does not exist in this stage.`);
        return;
      }
      this.renderer.set(loaded.renderer);
      this.room.set(room);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to load the room.');
      this.logger.error(`RoomEditor: failed to load room ${roomIndex} of "${stageId}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Records a tile edit so the layer is written back on save. */
  onTileChanged(change: RoomTileChange): void {
    this.dirty.set(true);
    this.stageRoom.markLayerDirty(this.roomIndex, change.layerIndex);
  }

  /** Swaps to another room from the quick-swap map grid card. */
  selectRoom(roomIndex: number): void {
    if (roomIndex < 0 || roomIndex === this.roomIndex) {
      return;
    }
    const stageId = this.stageId;
    this.stageTabs.openRoom(stageId, roomIndex);
    this.stageRoom.setActiveStage(stageId);
    this.stageRoom.open(stageId, roomIndex);
  }

  /** Toggles the Advanced (manual drawing) toolbox section. */
  toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }

  /** Toggles the floating map-grid quick-swap card. */
  toggleGridCard(): void {
    this.gridCardOpen.update((open) => !open);
  }
}
