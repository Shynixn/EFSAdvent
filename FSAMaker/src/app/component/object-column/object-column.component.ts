import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { SmartObjectDefinition, SmartObjectPlacement } from '../../entity/smartobject.entity';

/** The layer a row belongs to (used to group the list like Photoshop's panel). */
export type ObjectRowKind = 'smart' | 'legacy';

/** A row of the object list — one per placement in the room. */
export interface ObjectRow {
  /** Stable key (root placements only; children are not listed). */
  key: string;
  /** The placement this row represents (root, never a child). */
  placement: SmartObjectPlacement;
  /** Whether the placement was recorded by the editor or read from the archive. */
  kind: ObjectRowKind;
  /** Display name (the user-set name wins over the definition's name). */
  name: string;
  /** Definition name shown as a subtitle (e.g. "Door"). */
  typeName: string;
  /** Whether the object bakes a sprite (actor) instead of tiles. */
  actorBaked: boolean;
}

/**
 * ObjectColumnComponent
 * ---------------------
 * A Photoshop-like "objects" panel that lists **every** object in the room —
 * editor smart objects (decorations, enemies) **and** legacy actors that came
 * from the archive — in one place.
 *
 * Objects frequently share a tile (a door marker on top of a decoration), so the
 * list is the only reliable way to reach them, and it lets any of them be hidden
 * without deleting it:
 *
 * - the eye toggles the row's visibility (the host filters its render lists),
 * - a left click selects the row and highlights the object on the canvas,
 * - a right click opens the canvas context menu for that object (passed through
 *   to the room canvas, which owns the menu and the edit actions),
 * - a double click opens the "Rename" prompt (a modal text input in the host).
 *
 * Rows are grouped by base layer and, inside a layer, listed front-to-back so
 * the order matches the canvas' top-most-wins compositing.
 *
 * The component is purely presentational: it never mutates a placement and only
 * emits what the user asked for.
 *
 * @example
 * <app-object-column
 *   [rows]="objectRows()"
 *   [hidden]="hiddenObjects()"
 *   [selected]="selectedObject()"
 *   (visibilityToggled)="toggleObjectVisibility($event)"
 *   (selectedRow)="selectObjectRow($event)"
 *   (contextRequested)="openObjectContextMenu($event)"
 *   (renameRequested)="openRenameObject($event)"
 * />
 */
@Component({
  selector: 'app-object-column',
  templateUrl: './object-column.component.html',
  host: { class: 'block h-full w-full' },
})
export class ObjectColumnComponent {
  /**
   * Every object of the room (smart objects + legacy actors).
   *
   * Signal-backed on purpose: {@link groups} is a `computed()` and the app is
   * ZONELESS, so it only re-evaluates when a signal it reads changes. Reading a
   * plain `@Input` field there made the list compute once (while the room was
   * still loading, i.e. empty) and never again — the count in the header came
   * from `rows.length` (read directly in the template, so it updated) while the
   * body stayed empty.
   */
  private readonly rowsSignal = signal<ObjectRow[]>([]);

  @Input()
  get rows(): ObjectRow[] {
    return this.rowsSignal();
  }
  set rows(value: ObjectRow[]) {
    this.rowsSignal.set(value ?? []);
  }

  /** Keys of the hidden objects. */
  @Input() hidden: ReadonlySet<string> = new Set<string>();

  /** Key of the selected object (highlighted on the canvas), or null. */
  @Input() selected: string | null = null;

  /** All objects hidden / shown with one click. */
  @Output() visibilityToggled = new EventEmitter<string>();
  @Output() allVisibilitySet = new EventEmitter<boolean>();
  /** Left click on a row: select it (and highlight it on the canvas). */
  @Output() selectedRow = new EventEmitter<ObjectRow>();
  /** Right click on a row: open the canvas context menu for it (page coords). */
  @Output() contextRequested = new EventEmitter<{
    row: ObjectRow;
    clientX: number;
    clientY: number;
  }>();
  /** Double click on a row: ask the host to open the rename prompt. */
  @Output() renameRequested = new EventEmitter<ObjectRow>();

  /** Whether the panel body is expanded. */
  readonly open = signal(true);

  /** Rows grouped by base layer, front-most first. */
  readonly groups = computed(() => {
    const rows = this.rowsSignal();
    const layers = [...new Set(rows.map((row) => row.placement.baseLayerId ?? 0))].sort(
      (a, b) => a - b,
    );
    return layers.map((layer) => ({
      layer,
      name: layerName(layer),
      rows: rows
        .map((row, index) => ({ row, index }))
        .filter((entry) => (entry.row.placement.baseLayerId ?? 0) === layer)
        // Reverse: the last placement is composited on top, so it lists first.
        .sort((a, b) => b.index - a.index)
        .map((entry) => entry.row),
    }));
  });

  /** Whether every row is currently hidden (drives the "all" eye icon). */
  readonly allHidden = computed(
    () =>
      this.rowsSignal().length > 0 && this.rowsSignal().every((row) => this.hidden.has(row.key)),
  );

  /** Toggles the panel body. */
  toggleOpen(): void {
    this.open.update((value) => !value);
  }

  /** Whether a row is hidden. */
  isHidden(row: ObjectRow): boolean {
    return this.hidden.has(row.key);
  }

  /** Toggles one row's visibility. */
  toggleVisibility(row: ObjectRow, event: MouseEvent): void {
    // The eye must not also select / open the menu.
    event.stopPropagation();
    event.preventDefault();
    this.visibilityToggled.emit(row.key);
  }

  /** Hides or shows every object at once. */
  toggleAll(event: MouseEvent): void {
    event.stopPropagation();
    this.allVisibilitySet.emit(!this.allHidden());
  }

  /** Left click: select the row. */
  select(row: ObjectRow): void {
    this.selectedRow.emit(row);
  }

  /**
   * Double click: rename the object.
   *
   * Legacy actors cannot be renamed: their names are never persisted (they are
   * re-derived from the archive on every load), so an edit would be silently
   * thrown away. The dialog is not opened at all for them.
   */
  rename(row: ObjectRow): void {
    if (!this.canRename(row)) {
      return;
    }
    this.renameRequested.emit(row);
  }

  /** Whether a row can be renamed (editor placements only). */
  canRename(row: ObjectRow): boolean {
    return row.kind !== 'legacy';
  }

  /** Right click: let the host open the canvas context menu for the object. */
  openContext(row: ObjectRow, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextRequested.emit({ row, clientX: event.clientX, clientY: event.clientY });
  }

  /** Small caption for a row, e.g. "Enemy · tile 4,7". */
  caption(row: ObjectRow): string {
    const tile = `${row.placement.anchorCol},${row.placement.anchorRow}`;
    return `${row.typeName} · tile ${tile}`;
  }

  /**
   * Hover tooltip of a row.
   *
   * Legacy actors lead with a warning — they belong to the original room data
   * and cannot be renamed, only deleted/moved/reconfigured.
   */
  rowTooltip(row: ObjectRow): string {
    if (row.kind === 'legacy') {
      return 'Warning: legacy actor from the original room data (cannot be renamed). Right-click for more';
    }
    return `${row.name} — Double-click to rename, right-click for more`;
  }
}

/** Human-readable base layer name (matches the room-layers sections). */
export function layerName(index: number): string {
  if (index === 0) {
    return 'Main Layer';
  }
  if (index === 1) {
    return 'Dark World';
  }
  return `Gameboy Layer ${index - 1}`;
}

/**
 * Builds the object list for a room.
 *
 * Editor placements (`smartObjects`) come first in their recorded order and
 * legacy actors (`legacyActors`) after them, so the list mirrors the canvas'
 * compositing (legacy sprites are drawn on top). Children (e.g. a door's
 * connecting `WARP`) are NOT listed — they are not directly selectable.
 *
 * The name is the user's custom name when one was recorded for the placement,
 * else the definition's name (actor catalog name for actor-baked objects), else
 * the raw id.
 *
 * `hidden` is also a map of hidden keys (name overrides live there, see
 * {@link objectDisplayNames}) so a renamed object can be hidden by key as well.
 */
export function buildObjectRows(options: {
  smartObjects: readonly SmartObjectPlacement[];
  legacyActors: readonly SmartObjectPlacement[];
  define: (id: string) => SmartObjectDefinition | undefined;
  displayName: (placement: SmartObjectPlacement) => string | undefined;
  keyOf: (placement: SmartObjectPlacement) => string;
}): ObjectRow[] {
  const rows: ObjectRow[] = [];
  const push = (placement: SmartObjectPlacement, kind: ObjectRowKind): void => {
    const definition = options.define(placement.id);
    const typeName = definition?.name ?? placement.id;
    rows.push({
      key: options.keyOf(placement),
      placement,
      kind,
      name: options.displayName(placement) ?? typeName,
      typeName,
      actorBaked: definition?.baking === 'actor',
    });
  };
  for (const placement of options.smartObjects) {
    push(placement, 'smart');
  }
  for (const placement of options.legacyActors) {
    push(placement, 'legacy');
  }
  return rows;
}

/** Convenience re-export so hosts only need one import for the row type. */
export type { SmartObjectPlacement as ObjectPlacement };
