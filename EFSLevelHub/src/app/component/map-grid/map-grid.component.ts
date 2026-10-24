import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { MapLayoutData, StageData } from '../../entity/fsalib.entity';

/** A map-grid cell (grid coordinates, not a room index). */
export interface RoomCell {
  x: number;
  y: number;
}

/** An action chosen from the grid's context menu. */
export type RoomMenuAction = 'create' | 'copy' | 'paste' | 'delete' | 'start';

/** Payload of the grid's {@link MapGridComponent.roomAction} output. */
export interface RoomGridAction {
  action: RoomMenuAction;
  cell: RoomCell;
  room: number | null;
}

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
 * Right-clicking any cell opens a context menu with the actions that apply:
 *
 * | Cell              | Menu items             |
 * | ----------------- | ---------------------- |
 * | existing room     | Copy, Delete, Set Start Room |
 * | existing + copied | Paste, Copy, Delete, Set Start Room |
 * | empty             | Create                 |
 * | empty + copied    | Create, Paste          |
 *
 * The menu is **opt-in** ({@link roomMenu}, default `false`): hosts that must not
 * edit the layout — e.g. the stage page — keep a plain clickable grid. The menu
 * only reports the chosen {@link RoomMenuAction}; the host performs the change
 * (the grid has no persistence logic).
 *
 * @example
 * <app-map-grid
 *   [stage]="stageData()"
 *   [compact]="true"
 *   [roomMenu]="true"
 *   [copiedRoom]="copiedRoom()"
 *   (roomSelected)="openRoom($event)"
 *   (roomAction)="onRoomAction($event)"
 * />
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
    // A new stage means the old cell coordinates are meaningless.
    this.contextMenu.set(null);
  }

  /** Currently selected room index (highlighted), or null. */
  @Input() selectedRoom: number | null = null;

  /** Compact mode shrinks the cells (used for the floating quick-swap card). */
  @Input() compact = false;

  /**
   * Whether right-click opens the room context menu.
   *
   * OFF by default so pages that must not edit the layout (the stage page) get a
   * plain grid: empty cells stay disabled and right-click does nothing.
   */
  @Input() roomMenu = false;

  /** Room index currently copied, or null when nothing was copied. */
  @Input() copiedRoom: number | null = null;

  /** Emits the room index when a non-empty cell is clicked. */
  @Output() roomSelected = new EventEmitter<number>();

  /**
   * Emits the action chosen from a cell's context menu, together with the cell
   * and the room it contains (null for an empty cell). For `paste`, the source
   * is {@link copiedRoom}.
   */
  @Output() roomAction = new EventEmitter<RoomGridAction>();

  /** The open context menu; `x`/`y` are relative to the grid container. */
  readonly contextMenu = signal<{
    cell: RoomCell;
    room: number | null;
    x: number;
    y: number;
  } | null>(null);

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
    this.closeMenu();
    const room = this.roomAt(x, y);
    if (room < 0 || room === this.emptyRoomValue) {
      return;
    }
    this.roomSelected.emit(room);
  }

  /**
   * Opens the context menu for a cell.
   *
   * The position comes from the pointer and is made relative to the grid, so the
   * menu appears next to the cursor regardless of page scroll.
   */
  onContextMenu(event: MouseEvent, x: number, y: number): void {
    if (!this.roomMenu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const host = event.currentTarget as HTMLElement | null;
    const container = host?.closest('.map-grid-root') as HTMLElement | null;
    const rect = (container ?? host)?.getBoundingClientRect();
    const room = this.roomAt(x, y);
    this.contextMenu.set({
      cell: { x, y },
      room: room === this.emptyRoomValue ? null : room,
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    });
  }

  /** Closes the context menu. */
  closeMenu(): void {
    this.contextMenu.set(null);
  }

  /** The actions available for the open context menu's cell. */
  menuActions(): RoomMenuAction[] {
    const menu = this.contextMenu();
    if (!menu) {
      return [];
    }
    if (menu.room == null) {
      const canPaste = this.copiedRoom != null;
      return canPaste ? ['create', 'paste'] : ['create'];
    }
    // Only existing rooms can become the start room, and offering it for the
    // current start room would be a no-op.
    const canBeStart = !this.isStart(menu.cell.x, menu.cell.y);
    const actions: RoomMenuAction[] = this.copiedRoom != null
      ? ['paste', 'copy', 'delete']
      : ['copy', 'delete'];
    if (canBeStart) {
      actions.push('start');
    }
    return actions;
  }

  /** Human-readable label for a menu action. */
  actionLabel(action: RoomMenuAction): string {
    switch (action) {
      case 'create':
        return 'Create';
      case 'copy':
        return 'Copy';
      case 'paste':
        return 'Paste';
      case 'delete':
        return 'Delete';
      case 'start':
        return 'Set Start Room';
    }
  }

  /** Whether a menu action is destructive (styled in red). */
  isDestructive(action: RoomMenuAction): boolean {
    return action === 'delete';
  }

  /** Runs a menu action and closes the menu. */
  runAction(action: RoomMenuAction): void {
    const menu = this.contextMenu();
    if (!menu) {
      return;
    }
    this.closeMenu();
    this.roomAction.emit({ action, cell: menu.cell, room: menu.room });
  }

  /** Builds `[0, 1, …, count-1]`. */
  private range(count: number): number[] {
    return Array.from({ length: Math.max(0, count) }, (_, i) => i);
  }

  /**
   * Tailwind classes for one cell.
   *
   * Compact cells stretch to fill the column width (square via aspect ratio);
   * full cells use a fixed size for the larger stage-page grid. `editable` is
   * true when the context menu is enabled, which makes empty cells interactive
   * (right-click target) instead of inert.
   */
  cellClasses(x: number, y: number, editable: boolean): string {
    const size = this.compact ? 'aspect-square w-full text-[10px]' : 'h-14 w-14 text-xs';
    const empty = this.isEmpty(x, y)
      ? editable
        ? 'cursor-context-menu border-slate-700 bg-slate-800/40 text-slate-600 hover:border-indigo-400 hover:bg-slate-700/60'
        : 'cursor-default border-slate-700 bg-slate-800/40 text-slate-600'
      : 'cursor-pointer border-slate-500 bg-slate-700 text-slate-100 hover:border-indigo-400 hover:bg-slate-600';
    return (
      `flex flex-col items-center justify-center rounded border font-mono transition ${size} ` +
      empty +
      (this.isStart(x, y) ? ' ring-2 ring-emerald-400' : '') +
      (this.isSelected(x, y) ? ' ring-2 ring-indigo-400 bg-indigo-500/30' : '')
    );
  }
}
