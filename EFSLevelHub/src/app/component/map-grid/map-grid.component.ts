import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';

/**
 * MapGridComponent
 * ----------------
 * Renders a stage's room layout as a clickable grid of room cells (row-major,
 * matching `MapLayout.Rooms`). It is used both at full size on the stage page
 * and as a compact "quick swap" card on the room page.
 *
 * The component is purely presentational: it owns no loading logic and simply
 * reads the supplied {@link StageData}. Clicking a non-empty cell emits the
 * room's index through {@link roomSelected}.
 *
 * @example
 * <app-map-grid [stage]="stageData()" [compact]="true" (roomSelected)="openRoom($event)" />
 */
@Component({
  selector: 'app-map-grid',
  templateUrl: './map-grid.component.html',
})
export class MapGridComponent {
  private _stage: StageData | null = null;
  /** The parsed stage whose layout is drawn. */
  @Input()
  get stage(): StageData | null {
    return this._stage;
  }
  set stage(value: StageData | null) {
    this._stage = value;
    this._height = value?.Map.YDimension ?? 0;
    this._width = value?.Map.XDimension ?? 0;
    this._rows = this.range(this._height);
    this._cols = this.range(this._width);
  }

  /** Currently selected room index (highlighted), or null. */
  @Input() selectedRoom: number | null = null;

  /** Compact mode shrinks the cells (used for the floating quick-swap card). */
  @Input() compact = false;

  /** Emits the room index when a non-empty cell is clicked. */
  @Output() roomSelected = new EventEmitter<number>();

  private _width = 0;
  private _height = 0;
  private _rows: number[] = [];
  private _cols: number[] = [];

  /** Cached row indices (avoids rebuilding the array every change detection). */
  get rows(): number[] {
    return this._rows;
  }

  /** Cached column indices. */
  get cols(): number[] {
    return this._cols;
  }

  /** Grid width (rooms). */
  get width(): number {
    return this._width;
  }

  /** Grid height (rooms). */
  get height(): number {
    return this._height;
  }

  /** Current layout, if loaded. */
  private get layout(): MapLayoutData | null {
    return this._stage?.Map ?? null;
  }

  /** The empty-room sentinel reported by wasm. */
  get emptyRoomValue(): number {
    return this._stage?.Map.EmptyRoomValue ?? -1;
  }

  /** Room index at (x, y) in the row-major array, or the empty sentinel. */
  roomAt(x: number, y: number): number {
    const layout = this.layout;
    if (!layout) {
      return this.emptyRoomValue;
    }
    return layout.Rooms[x + y * this._width] ?? this.emptyRoomValue;
  }

  /** True if the cell at (x, y) is empty (no room). */
  isEmpty(x: number, y: number): boolean {
    return this.roomAt(x, y) === this.emptyRoomValue;
  }

  /** True if the cell is the map's start room. */
  isStart(x: number, y: number): boolean {
    const layout = this.layout;
    return !!layout && x === layout.StartX && y === layout.StartY;
  }

  /** True if the cell is the currently selected room. */
  isSelected(x: number, y: number): boolean {
    const room = this.roomAt(x, y);
    return this.selectedRoom != null && room === this.selectedRoom;
  }

  /** Opens the room under a cell (if it is not empty). */
  select(x: number, y: number): void {
    const room = this.roomAt(x, y);
    if (room < 0 || room === this.emptyRoomValue) {
      return;
    }
    this.roomSelected.emit(room);
  }

  /** Builds `[0, 1, …, count-1]`. */
  private range(count: number): number[] {
    return Array.from({ length: Math.max(0, count) }, (_, i) => i);
  }

  /** Tailwind cell size class (compact vs. full). */
  get cellClass(): string {
    // Compact cells stretch to fill the column width (square via aspect ratio);
    // full cells use a fixed size for the larger stage-page grid.
    return this.compact ? 'aspect-square w-full text-[10px]' : 'h-14 w-14 text-xs';
  }
}
