import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FSALibService } from '../../service/fsalib.service';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';
import { OpfsCacheService } from '../../service/opfs-cache.service';
import { LoggingService } from '../../service/logging.service';

/**
 * MapViewerComponent
 * ------------------
 * Test component that loads a stage archive from OPFS, parses it through the
 * FSALib browser-wasm module (returning the whole `Stage` entity), and renders
 * the resulting map layout as a grid.
 *
 * Default path: `GC4Sword_pal/Boss/boss010.arc`; override with the `?path=` query.
 */
@Component({
  selector: 'app-map-viewer',
  templateUrl: './map-viewer.component.html',
  styleUrl: './map-viewer.component.css',
})
export class MapViewerComponent implements OnInit {
  private readonly fsaLib = inject(FSALibService);
  private readonly opfs = inject(OpfsCacheService);
  private readonly logger = inject(LoggingService);
  private readonly route = inject(ActivatedRoute);

  /** Default archive to inspect. */
  static readonly DEFAULT_PATH = 'GC4Sword_pal/Boss/boss010.arc';

  readonly arcPath = signal(MapViewerComponent.DEFAULT_PATH);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  /** The full parsed Stage entity graph returned from wasm. */
  readonly stageData = signal<StageData | null>(null);
  /** Room index the user last clicked (for a simple highlight/readout). */
  readonly selectedRoom = signal<number | null>(null);

  ngOnInit(): void {
    const fromQuery = this.route.snapshot.queryParamMap.get('path');
    if (fromQuery) {
      this.arcPath.set(fromQuery);
    }
    void this.loadMap();
  }

  /** The primary map layout from the parsed stage, if available. */
  map(): MapLayoutData | null {
    return this.stageData()?.Map ?? null;
  }

  /** Grid width (rooms) of the primary map. */
  mapWidth(): number {
    return this.stageData()?.Map.XDimension ?? 0;
  }

  /** Grid height (rooms) of the primary map. */
  mapHeight(): number {
    return this.stageData()?.Map.YDimension ?? 0;
  }

  /** Loads the archive from OPFS and parses it with FSALib (wasm). */
  async loadMap(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.stageData.set(null);
    this.selectedRoom.set(null);

    const path = this.arcPath();
    try {
      this.logger.info(`MapViewer: reading "${path}" from OPFS…`);
      const bytes = await this.opfs.readExtractedFile(path);
      this.logger.info(`MapViewer: read ${bytes.byteLength} bytes; parsing via wasm…`);

      const stage = await this.fsaLib.parseStage(bytes);
      this.stageData.set(stage);
      this.logger.info(
        `MapViewer: parsed stage ${stage.Index} ` +
          `(map ${stage.Map.Index}, ${stage.Map.XDimension}x${stage.Map.YDimension}, ` +
          `${stage.Rooms.filter((r) => r).length} room(s))`,
      );
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to load map.');
      this.logger.error(`MapViewer: failed to load "${path}"`, error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Called when the user clicks a room cell. */
  selectRoom(roomIndex: number): void {
    this.selectedRoom.set(roomIndex);
  }

  /**
   * Returns the room index at (x, y) in the row-major `rooms` array, or the
   * empty-room sentinel when out of range.
   */
  roomAt(x: number, y: number): number {
    const layout = this.map();
    if (!layout) {
      return -1;
    }
    return layout.Rooms[x + y * this.mapWidth()] ?? this.emptyRoomValue();
  }

  /** The empty-room sentinel reported by wasm. */
  emptyRoomValue(): number {
    return this.stageData()?.Map.EmptyRoomValue ?? -1;
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

  /** Row index helper for the template (*ngFor over a computed range). */
  range(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i);
  }
}
