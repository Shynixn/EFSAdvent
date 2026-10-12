import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '../../component/button/button.component';
import { RoomCanvasComponent } from '../../component/room-canvas/room-canvas.component';
import { StageEditorService } from '../../service/stage-editor.service';
import { StageService, StageFile } from '../../service/stage.service';
import { StageTabsService } from '../../service/stage-tabs.service';
import { LoggingService } from '../../service/logging.service';
import { RoomData } from '../../entity/fsalib.entity';
import { StageRenderer } from '../../service/render/stage-renderer';

/**
 * RoomPage
 * --------
 * A sub-page of a stage that edits a single room on the {@link RoomCanvasComponent}
 * (the main room editor). It shows the room canvas and the tile selection, and
 * a layer selector / GBA toggle.
 *
 * Opening the page registers a room tab nested under the stage's tab in the nav;
 * the close button removes the room tab and returns to the stage.
 */
@Component({
  selector: 'app-room-page',
  imports: [ButtonComponent, RoomCanvasComponent],
  templateUrl: './room-page.html',
  styleUrl: './room-page.css',
})
export class RoomPage implements OnInit, OnDestroy {
  private readonly stageEditor = inject(StageEditorService);
  private readonly stageService = inject(StageService);
  private readonly stageTabs = inject(StageTabsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggingService);

  /** Id of the stage this room belongs to. */
  readonly stageId = signal('');
  /** Room index being edited. */
  readonly roomIndex = signal(-1);
  /** Stage definition for the header. */
  readonly stage = signal<StageFile | null>(null);

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
  /** Whether the room has unsaved edits. */
  readonly dirty = signal(false);

  /** Header title, e.g. "Lake Hylia · Room 12". */
  readonly title = computed(() => {
    const name = this.stage()?.name ?? 'Stage';
    const room = this.roomIndex();
    return room >= 0 ? `${name} · Room ${room}` : name;
  });

  private sub: Subscription | null = null;

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      const stageId = params.get('stageId') ?? '';
      const roomIndex = Number.parseInt(params.get('roomIndex') ?? '', 10);
      if (!stageId || Number.isNaN(roomIndex)) {
        return;
      }
      if (stageId === this.stageId() && roomIndex === this.roomIndex() && this.room()) {
        return;
      }
      void this.loadRoom(stageId, roomIndex);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Loads the stage editor state and selects the requested room. */
  private async loadRoom(stageId: string, roomIndex: number): Promise<void> {
    this.stageId.set(stageId);
    this.roomIndex.set(roomIndex);
    this.isLoading.set(true);
    this.loadError.set('');
    this.room.set(null);
    this.dirty.set(false);

    try {
      await this.stageService.load();
      this.stage.set(this.stageService.getById(stageId) ?? null);

      const loaded = await this.stageEditor.load(stageId);
      if (!loaded) {
        this.loadError.set('This stage has no archive yet.');
        return;
      }
      const room = loaded.data.Rooms[roomIndex] ?? null;
      if (!room) {
        this.loadError.set(`Room ${roomIndex} does not exist in this stage.`);
        return;
      }
      this.renderer.set(loaded.renderer);
      this.room.set(room);
      this.stageTabs.openRoom(stageId, roomIndex);
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'Failed to load the room.');
      this.logger.error(`RoomPage: failed to load room ${roomIndex} of "${stageId}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Marks the room dirty after a tile edit. */
  onTileChanged(): void {
    this.dirty.set(true);
  }

  /** Closes the room tab and returns to the stage. */
  close(): void {
    const stageId = this.stageId();
    const roomIndex = this.roomIndex();
    if (stageId) {
      this.stageTabs.closeRoom(stageId, roomIndex);
    }
    void this.router.navigate(['/my-stages', stageId]);
  }
}
