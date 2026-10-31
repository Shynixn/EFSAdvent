import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RoomData } from '../../entity/fsalib.entity';
import { ActorData } from '../../entity/fsalib.entity';
import {
  CanvasContextMenuComponent,
  ContextMenuAction,
  ContextMenuChoiceGroup,
} from '../canvas-context-menu/canvas-context-menu.component';
import { ImageBuffer, TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { StageRenderer } from '../../service/render/stage-renderer';
import {
  applySmartObject,
  clearSmartObject,
  findSmartObjectDefinition,
  flattenPlacements,
  placementToActor,
  resolveSubTypeIndex,
  smartObjectBounds,
  smartObjectVariant,
  variantsForSubType,
  withChildren,
  SmartObjectDefinition,
  SmartObjectPlacement,
  SmartObjectSubType,
  SmartObjectTileOffset,
} from '../../entity/smartobject.entity';
import {
  SCALE_DIRECTIONS,
  SCALE_DIRECTION_LABELS,
  canScale,
  scaleOf,
  SmartObjectScale,
} from '../../entity/contract/scalable.entity';
import { connectDoors, disconnectDoor, isConnected } from '../../entity/smartobject/door.entity';
import { canRotate, nextRotation } from '../../entity/contract/rotateable.entity';
import {
  applyRotation,
  fieldsOf,
  isConnectableDefinition,
} from '../../entity/contract/placeable.entity';
import { isActivationSource, isActivationTarget } from '../../entity/contract/activatable.entity';
import {
  ActivationLink,
  isLinkedTarget,
  placementKey,
  sourceTargets,
} from '../../entity/smartobject/activation.entity';
import { SmartObjectDragService } from '../../service/smart-object-drag.service';
import {
  DIMENSION,
  ROOM_HEIGHT,
  roomCanvasSize,
  roomCanvasStyleSize,
  roomCanvasTilesH,
} from './room-canvas.layout';

/** A tile edit produced by painting on the canvas. */
export interface RoomTileChange {
  /** Layer index that was edited (0-7 base, 8-15 top). */
  layerIndex: number;
  /** Tile coordinate that changed. */
  x: number;
  y: number;
  /** New tile value. */
  tile: number;
}

/** A ground edit produced by painting the ground brush on the canvas. */
export interface RoomGroundChange {
  /** Base layer the ground belongs to (0-7). */
  baseLayerId: number;
  /** Tile coordinate that changed. */
  x: number;
  y: number;
  /** New ground tile value (0 clears the tile). */
  tile: number;
}

/** Merges two optional skip sets into one (either may be undefined/empty). */
function mergeSkip(a: Set<number> | undefined, b: Set<number>): Set<number> {
  if (!a || a.size === 0) {
    return b;
  }
  return new Set([...a, ...b]);
}

/** Context-menu group id of the scalable object "Scale" submenu. */
const SCALE_GROUP_ID = 'scale';

/**
 * RoomCanvasComponent
 * -------------------
 * Editable room canvas — the main room editor, modelled on EFSAdvent's WinForms
 * room view. It renders a single room layer onto a `<canvas>` and lets the user
 * paint tiles onto the active layer with the left mouse button (click or drag).
 *
 * Rendering uses the shared {@link StageRenderer} (TV or GBA tileset). Painting
 * mutates the room's layer tiles in place and emits each change so the parent
 * can mark the stage dirty / persist it.
 *
 * @example
 * <app-room-canvas
 *   [room]="room()"
 *   [renderer]="renderer()"
 *   [layerIndex]="layer()"
 *   [tile]="brushTile()"
 *   (tileChanged)="onTileChanged($event)"
 * />
 */
@Component({
  selector: 'app-room-canvas',
  imports: [CanvasContextMenuComponent],
  templateUrl: './room-canvas.component.html',
})
export class RoomCanvasComponent implements AfterViewInit, OnDestroy {
  private readonly dragService = inject(SmartObjectDragService);

  /** The room to edit. */
  @Input() room: RoomData | null = null;

  private _renderer: StageRenderer | null = null;
  /** The stage renderer (for drawing the layer). Triggers a redraw on change. */
  @Input()
  get renderer(): StageRenderer | null {
    return this._renderer;
  }
  set renderer(value: StageRenderer | null) {
    this._renderer = value;
    queueMicrotask(() => void this.redraw());
  }

  private _index = -1;
  /** Room index within the stage (needed to draw it). */
  @Input()
  get index(): number {
    return this._index;
  }
  set index(value: number) {
    this._index = value;
    queueMicrotask(() => void this.redraw());
  }

  private _layerIndex = 0;
  /** Active layer (0-7 base, 8-15 top). */
  @Input()
  get layerIndex(): number {
    return this._layerIndex;
  }
  set layerIndex(value: number) {
    this._layerIndex = value;
    queueMicrotask(() => void this.redraw());
  }

  private _gba = false;
  /** When true the GBA tileset/layers are drawn (layer level 1). */
  @Input()
  get gba(): boolean {
    return this._gba;
  }
  set gba(value: boolean) {
    this._gba = value;
    queueMicrotask(() => void this.redraw());
  }

  private _cropped = false;
  /**
   * When true the canvas is cropped to what the game's TV level shows (24 of
   * 32 tile rows, 512×384). Only the **Main Layer** sets this; the **Dark
   * World** and **Gameboy layers** render the full 32×32 grid so their bottom
   * rows are neither hidden nor unreachable.
   *
   * The crop is a canvas-size crop, so the backing store (and the overlay) is
   * 384px tall when enabled and 512px otherwise; pointer mapping follows the
   * canvas size automatically.
   */
  @Input()
  get cropped(): boolean {
    return this._cropped;
  }
  set cropped(value: boolean) {
    this._cropped = value;
    queueMicrotask(() => {
      this.applyCanvasSize();
      void this.redraw();
    });
  }

  private _topLayer = true;
  /**
   * When true the paired top layer (`layerIndex + 8`) is composited over the
   * base layer (matching the game view). Uncheck to see the base layer alone.
   */
  @Input()
  get topLayer(): boolean {
    return this._topLayer;
  }
  set topLayer(value: boolean) {
    this._topLayer = value;
    queueMicrotask(() => void this.redraw());
  }

  private _paintTop = false;
  /**
   * When true, painting writes to the paired **top** layer (`layerIndex + 8`)
   * instead of the base layer. Lets top-layer-only tiles (tree canopies, …) be
   * drawn directly. Emitted {@link tileChanged} events report the real layer
   * index that was written.
   */
  @Input()
  get paintTop(): boolean {
    return this._paintTop;
  }
  set paintTop(value: boolean) {
    this._paintTop = value;
  }

  private _tile = 0;
  /** Tile value painted on left click/drag. */
  @Input()
  get tile(): number {
    return this._tile;
  }
  set tile(value: number) {
    this._tile = value;
  }

  /** Active tool: `brush` paints, `eraser` clears tiles/ground, `hand` moves objects. */
  @Input() tool: 'brush' | 'hand' | 'eraser' = 'hand';

  /**
   * Whether this canvas should draw the red actor markers / hover outline.
   * Every canvas is fully editable; this only controls the actor markers.
   */
  @Input() showMarkers = true;

  private _smartObjects: SmartObjectPlacement[] = [];
  /** Smart objects placed in this room (for hit-testing, dragging, ground skip). */
  @Input()
  get smartObjects(): SmartObjectPlacement[] {
    return this._smartObjects;
  }
  set smartObjects(value: SmartObjectPlacement[]) {
    this._smartObjects = value ?? [];
    // A new placement (or a move) changes which base tiles the ground must not
    // hide, so repaint immediately instead of waiting for the next edit.
    queueMicrotask(() => void this.redraw());
  }

  private _hiddenObjects: ReadonlySet<string> = new Set<string>();
  /**
   * Keys of the objects hidden from the object column.
   *
   * Hidden objects are not drawn (tiles are skipped in the composite and their
   * actors are left out) and are not hit-tested, so they cannot be grabbed by
   * accident. They are NOT deleted: the placement data is untouched. A change
   * repaints so hiding is immediate.
   */
  @Input()
  get hiddenObjects(): ReadonlySet<string> {
    return this._hiddenObjects;
  }
  set hiddenObjects(value: ReadonlySet<string>) {
    this._hiddenObjects = value ?? new Set<string>();
    queueMicrotask(() => void this.redraw());
  }

  private _selectedObject: string | null = null;
  /**
   * Key of the object selected in the object column, or null.
   *
   * Drawn with a permanent highlight outline (like the hovered one) so picking a
   * row in the list points at the object on the canvas — the only reliable way
   * to tell apart objects that share a tile.
   */
  @Input()
  get selectedObject(): string | null {
    return this._selectedObject;
  }
  set selectedObject(value: string | null) {
    this._selectedObject = value ?? null;
    queueMicrotask(() => this.drawHoverOutline());
  }

  /**
   * Key of a placement the **host** asked to target with the context menu (a
   * right click in the object column). Lives here because the menu and its edit
   * actions are owned by this canvas.
   */
  private externalContextKey: string | null = null;
  /**
   * Key of the placement whose row was right-clicked in the object column, so a
   * canvas on its layer can open the context menu for it.
   *
   * Each stacked canvas receives this value; only the one holding the placement
   * reacts, so the menu appears exactly once.
   */
  @Input()
  get contextTargetKey(): string | null {
    return this.externalContextKey;
  }
  set contextTargetKey(value: string | null) {
    this.externalContextKey = value ?? null;
    queueMicrotask(() => this.applyContextTarget());
  }

  /**
   * Viewport position to place the context menu at when it was requested from
   * the object list (null = position it on the object itself).
   *
   * The host passes the pointer coordinates of the right click in the list, so
   * the menu appears **above the list** exactly where the user clicked instead
   * of jumping onto the canvas.
   */
  @Input() contextTargetPointer: { clientX: number; clientY: number } | null = null;

  /**
   * Emits when the context menu this canvas owns is dismissed.
   *
   * The host uses it to drop its `contextTargetPointer`, which otherwise stays
   * set and makes the NEXT menu request (even a different object) reuse a stale
   * position.
   */
  @Output() contextMenuClosed = new EventEmitter<void>();

  /**
   * Emits when a context-target key has been consumed, so the host can clear it.
   *
   * Without this the same key lingers on the input and any later re-render of
   * the layer stack re-applies it, re-opening the menu the user just dismissed.
   */
  @Output() contextTargetConsumed = new EventEmitter<void>();

  /**
   * Opens the context menu for a placement of this canvas (used when the user
   * right-clicks its row in the object list). Returns whether it was found.
   *
   * When the host supplies {@link contextTargetPointer} the menu is positioned
   * at that viewport position (i.e. over the list), otherwise it is anchored on
   * the object's own tile — converted from canvas backing-store pixels to the
   * wrapper's CSS pixels, which is the coordinate space the menu positions
   * itself in (see {@link onCanvasContextMenu}).
   */
  openContextFor(placement: SmartObjectPlacement): boolean {
    const definition = findSmartObjectDefinition(placement.id);
    const canvas = this.canvasRef()?.nativeElement;
    if (!definition) {
      return false;
    }
    const pointer = this.contextTargetPointer;
    if (pointer) {
      this.menuFixed = true;
      this.menuPosition = { x: pointer.clientX + 2, y: pointer.clientY + 2 };
    } else {
      if (!canvas) {
        return false;
      }
      const box = this.boxOf(placement, definition);
      const scaleX = this.canvasStyleSize.width / (canvas.width || 1);
      const scaleY = this.canvasStyleSize.height / (canvas.height || 1);
      // The canvas sits 4px inside the wrapper (its `p-1` padding).
      this.menuFixed = false;
      this.menuPosition = { x: Math.round(box.x * scaleX) + 4, y: Math.round(box.y * scaleY) + 4 };
    }
    this.contextMenu.set({
      placement,
      x: this.menuPosition.x,
      y: this.menuPosition.y,
    });
    this.menuIsFixed.set(this.menuFixed);
    this.drawHoverOutline();
    return true;
  }

  /**
   * Opens the context menu for the host-requested key, if it is on this layer.
   *
   * CRITICAL: every stacked canvas receives the SAME `smartObjects` list, so
   * "the list contains a placement with this key" is true on all 8 of them. The
   * placement must therefore also belong to THIS canvas's base layer — otherwise
   * all 8 open a menu, stack 8 full-screen backdrops and the user has to click
   * 8 times to dismiss them.
   *
   * The key is cleared locally once handled, so a later repaint cannot reopen a
   * menu the user already dismissed.
   */
  private applyContextTarget(): void {
    const key = this.externalContextKey;
    // A cleared key is just the host releasing the request — never reopen.
    if (!key) {
      return;
    }
    const placement = [...this.smartObjects, ...this._legacyActors].find(
      (entry) => placementKey(entry) === key,
    );
    // Only the canvas whose layer owns the placement may open the menu.
    if (!placement || !this.onThisLayer(placement)) {
      return;
    }
    this.openContextFor(placement);
    // Consumed: forget it here and tell the host to clear its own copy.
    this.externalContextKey = null;
    this.contextTargetConsumed.emit();
  }

  /**
   * Whether an object is hidden in the object column.
   *
   * Keyed by {@link placementKey} (id + anchor) — the same key the object list
   * uses, so hiding survives a rename (which only changes the display name).
   */
  private isHidden(placement: SmartObjectPlacement): boolean {
    return this._hiddenObjects.has(placementKey(placement));
  }

  private _legacyActors: SmartObjectPlacement[] = [];
  /**
   * Actor placements that represent **pre-existing (legacy) actors** — actors
   * found in the room's archive that were not recorded by the editor.
   *
   * They are the only actors drawn with a red border; editor-placed objects show
   * nothing until hovered (a black dotted outline). A change repaints so the red
   * markers appear as soon as the legacy list is known.
   */
  @Input()
  get legacyActors(): SmartObjectPlacement[] {
    return this._legacyActors;
  }
  set legacyActors(value: SmartObjectPlacement[]) {
    this._legacyActors = value ?? [];
    queueMicrotask(() => void this.redraw());
  }

  /**
   * The actor-baked placements in this room, as {@link ActorData} records —
   * derived from {@link smartObjects} (plus their children) AND
   * {@link legacyActors}, so every actor is drawn without a separate input.
   *
   * The placement currently being dragged with the hand tool is omitted, so the
   * grabbed sprite disappears from its old cell while it follows the cursor
   * (tile-baked objects achieve the same by being skipped in the render, see
   * {@link dragGhostSet} — their tiles are never cleared on grab).
   */
  private get actors(): ActorData[] {
    const draggingSource = this.dragging?.source ?? null;
    const actors: ActorData[] = [];
    for (const placement of [...flattenPlacements(this._smartObjects), ...this._legacyActors]) {
      if (placement === draggingSource || this.isHidden(placement)) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (definition?.baking === 'actor') {
        actors.push(placementToActor(placement));
      }
    }
    return actors;
  }

  /**
   * **Legacy** actor placements on this canvas's base layer (`layerIndex`) that
   * draw a sprite — the only actors marked with a red border.
   *
   * Actors on other base layers belong to their own section. Every actor is
   * shown, including invisible markers such as `TINB`/`SWEV` — the editor
   * deliberately surfaces them so nothing in the room is hidden from the user.
   * Editor-placed objects are intentionally NOT marked; they show only the
   * hover outline.
   */
  private legacyActorsOnLayer(): SmartObjectPlacement[] {
    return this.legacyActors.filter((placement) => {
      const definition = findSmartObjectDefinition(placement.id);
      return (
        definition?.baking === 'actor' &&
        (placement.baseLayerId ?? 0) === this.layerIndex &&
        !this.isHidden(placement)
      );
    });
  }

  /**
   * Whether a placement belongs to the layer this canvas draws.
   *
   * Actor placements read from the archive ({@link actorToPlacement}) carry the
   * actor's `Layer` as their base layer, exactly like editor placements, so the
   * same test covers both.
   *
   * IMPORTANT for context menus: every stacked canvas receives the SAME
   * `smartObjects` list, so this is the only thing that decides which canvas is
   * allowed to act on a placement. Opening a menu on more than one canvas
   * stacks multiple full-screen backdrops and requires one click per layer to
   * dismiss them.
   */
  private onThisLayer(placement: SmartObjectPlacement): boolean {
    return (placement.baseLayerId ?? 0) === this.layerIndex;
  }

  private _groundTiles: number[] | null = null; /**
   * Ground grid (row-major tile ids, 0 = empty) for the active base layer,
   * drawn as an underlay beneath the room layers/decorations. `null` disables
   * ground rendering (no ground record for this layer).
   */
  @Input()
  get groundTiles(): number[] | null {
    return this._groundTiles;
  }
  set groundTiles(value: number[] | null) {
    this._groundTiles = value;
    queueMicrotask(() => void this.redraw());
  }

  /**
   * Ground tile to paint with the brush while a ground is selected. When > 0,
   * the brush paints ground instead of tiles (see {@link groundMode}).
   */
  @Input() groundTile = 0;

  /**
   * Whether the brush paints ground. When true, painting writes to
   * {@link groundTiles} and emits {@link groundChanged} instead of
   * {@link tileChanged}.
   */
  @Input() groundMode = false;

  /** Base layer id the ground brush targets (0-7). */
  @Input() groundBaseLayerId = 0;

  /** Emits each tile edit as it is painted. */
  @Output() tileChanged = new EventEmitter<RoomTileChange>();

  /** Emits each ground edit as it is painted. */
  @Output() groundChanged = new EventEmitter<RoomGroundChange>();

  /** Emits when a decoration (smart object) is dropped onto the canvas. */
  @Output() decorationPlaced = new EventEmitter<SmartObjectPlacement>();

  /** Emits when a placed decoration is moved (re-stamped at a new anchor). */
  @Output() decorationMoved = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** Emits when a placed decoration is deleted from the context menu. */
  @Output() decorationDeleted = new EventEmitter<SmartObjectPlacement>();

  /**
   * Emits when a **legacy** actor is deleted from the context menu. Legacy
   * actors live outside `smartObjects` (see the host), so they are deleted
   * separately — their sprite/actor is removed from the room on save.
   */
  @Output() legacyDeleted = new EventEmitter<SmartObjectPlacement>();

  /**
   * Emits when a **legacy** actor is moved with the hand tool (its new anchor).
   */
  @Output() legacyMoved = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** Emits when a placed decoration is rotated to the next variant. */
  @Output() decorationRotated = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /**
   * Emits the placement clicked on the canvas (any tool), so the host can select
   * the matching row in the object column. Emits `null` when the click landed on
   * empty space.
   */
  @Output() objectSelected = new EventEmitter<SmartObjectPlacement | null>();

  /**
   * Emits `true` when a connect drag starts, and `false` when it ends (released,
   * completed or cancelled). The host uses this to own the connect line's
   * cross-layer overlay — see {@link startConnect}.
   */
  @Output() connectDragChanged = new EventEmitter<boolean>();

  /**
   * Emits when a placement's recorded data changes without moving it — used for
   * connecting/disconnecting two doors (which adds/removes a child `WARP` actor).
   */
  @Output() placementUpdated = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** The canvas element the room is drawn onto. */
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  /** The transparent overlay canvas used for drag previews. */
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');
  /**
   * The cross-layer overlay: a canvas the HOST paints connect lines onto, so a
   * line can run from a door in one layer section to a pointer (or door) in
   * another. Sized by the host to cover the whole layer stack.
   */
  private readonly overlayRef = viewChild<ElementRef<HTMLCanvasElement>>('overlay');

  /** Whether a connect drag is currently in progress (see {@link startConnect}). */
  readonly connecting = computed(() => this.connectingFrom() !== null);

  /** Whether the left mouse button is held (for drag-painting). */
  private painting = false;

  /**
   * The decoration being dragged (either a new one dragged from the toolbox or
   * an existing placement moved with the hand tool), plus its grab offset.
   */
  private dragging: {
    definition: SmartObjectDefinition;
    /** Existing placement being moved, or null when placing a new one. */
    source: SmartObjectPlacement | null;
    /** Grab offset (in tiles) from the anchor to the pointer. */
    grabRow: number;
    grabCol: number;
    /** Current anchor tile. */
    anchorRow: number;
    anchorCol: number;
    /** Active variant (rotation style) index within the definition's `set`. */
    variantIndex: number;
    /** Active sub-type index within the definition's `subTypes` (0 when none). */
    subTypeIndex: number;
    /** Growth of the object being moved (undefined when it is not scaled). */
    scale?: SmartObjectScale;
    /** True while the pointer is over the canvas. */
    active: boolean;
  } | null = null;

  /** True while the hand tool is hovering a placed smart object (grab cursor). */
  readonly hoveringObject = signal(false);

  /** True while a smart object is being dragged with the hand tool. */
  readonly draggingObject = signal(false);

  /**
   * True while an incompatible item (a `noGBASprite` actor) is dragged over this
   * GBA layer, so the canvas shows a "not allowed" X and rejects the drop.
   */
  readonly dragNotAllowed = signal(false);

  /**
   * The door the user is currently connecting from (a context-menu "Connect"),
   * or null. While set, moving the pointer draws a line from this door and
   * releasing over another door connects the two.
   */
  readonly connectingFrom = signal<SmartObjectPlacement | null>(null);

  /** Tile under the cursor while connecting (drives the connect line). */
  private readonly connectCursor = signal<{ x: number; y: number } | null>(null);

  /**
   * The activation SOURCE the user is currently linking from (context-menu
   * "Activates"), or null.
   *
   * Unlike the door connect (one source → one target), an activation source may
   * drive MANY targets, so the link mode stays active after each successful
   * drop and only ends via Escape / right-click / clicking the source again.
   */
  readonly activatingFrom = signal<SmartObjectPlacement | null>(null);

  /** Targets picked during the current activation session (for the live lines). */
  readonly activationTargets = signal<SmartObjectPlacement[]>([]);

  /** Emits `{ source, target }` when the user links a source to a target. */
  @Output() activationLinked = new EventEmitter<{
    source: SmartObjectPlacement;
    target: SmartObjectPlacement;
  }>();

  /** Emits when the activation session ends (host clears its overlay). */
  @Output() activationDragChanged = new EventEmitter<boolean>();

  /** Emits the placement whose activation links should be removed. */
  @Output() activationUnlinked = new EventEmitter<SmartObjectPlacement>();

  /** Persisted activation links for this room (used to draw committed lines). */
  @Input() activationLinks: readonly ActivationLink[] = [];

  /** Persisted activation links for this room (used to draw committed lines). */

  /** Smart object currently hovered by the pointer (for its boundary outline). */
  private hoveredPlacement: SmartObjectPlacement | null = null;

  /**
   * Resolver supplied by the host (the stacked layer view): maps a page-wide
   * pointer position to the door under it **on any layer**, so a connect drag
   * can start on one layer's canvas and end on another's.
   */
  resolveDoor: ((clientX: number, clientY: number) => SmartObjectPlacement | null) | null = null;

  /**
   * Right-click context menu state: the smart object placement it targets, plus
   * its position (in CSS pixels, relative to the canvas wrapper). `null` when
   * closed. Enemies are placements too, so no separate actor target is needed.
   */
  readonly contextMenu = signal<{
    placement: SmartObjectPlacement;
    x: number;
    y: number;
  } | null>(null);

  /**
   * Whether the open context menu is positioned in viewport coordinates (it was
   * opened from the object list) rather than relative to the canvas wrapper.
   */
  readonly menuIsFixed = signal(false);

  /** Position of the open context menu (see {@link menuIsFixed}). */
  private menuPosition = { x: 0, y: 0 };
  /** Backing field for {@link menuFixed} (set while opening the menu). */
  private menuFixed = false;

  /**
   * Whether the context menu's "Type" submenu is expanded. The menu lives over a
   * backdrop that closes it, so the submenu is toggled by click (a hover-open
   * popup would fight the backdrop / the `left-full` positioning).
   */
  ngAfterViewInit(): void {
    this.applyCanvasSize();
    void this.redraw();
  }

  ngOnDestroy(): void {
    this.stopConnectTracking();
  }

  /** The canvas element (used by the stacked layer view to align its overlay). */
  canvasElement(): HTMLCanvasElement | null {
    return this.canvasRef()?.nativeElement ?? null;
  }

  /** The cross-layer overlay element the host paints connect lines onto. */
  overlayElement(): HTMLCanvasElement | null {
    return this.overlayRef()?.nativeElement ?? null;
  }

  /** This canvas's crop flag, as set through the {@link cropped} input. */
  get isCropped(): boolean {
    return this._cropped;
  }

  /**
   * The canvas's top-left corner relative to a container, in the container's
   * CSS pixels.
   *
   * Cropped (Main Layer) and uncropped (Dark World / Gameboy) canvases have
   * different heights, but every section wraps its canvas in the same `p-2`
   * padding and the stack is a single column — so a container-relative rect is
   * all the host needs to place a cross-layer connect line.
   */
  canvasOffsetIn(container: HTMLElement | null): { x: number; y: number } | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !container) {
      return null;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return { x: canvasRect.left - containerRect.left, y: canvasRect.top - containerRect.top };
  }

  /**
   * Canvas-space centre of a tile, in CSS pixels relative to the canvas's
   * top-left corner (works for cropped and uncropped layers because the canvas
   * element itself is already the visible window).
   */
  tileCentreInCanvas(tile: { x: number; y: number }): { x: number; y: number } | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const tileW = rect.width / DIMENSION;
    const tileH = rect.height / roomCanvasTilesH(this._cropped);
    return { x: (tile.x + 0.5) * tileW, y: (tile.y + 0.5) * tileH };
  }

  /**
   * Pixel box (CSS px, canvas-relative) of a placement's footprint on **this**
   * canvas. Used by the host to outline a hovered/connectable door that lives
   * in another layer's section.
   */
  placementBoxInCanvas(placement: SmartObjectPlacement): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const canvas = this.canvasRef()?.nativeElement;
    const definition = findSmartObjectDefinition(placement.id);
    if (!canvas || !definition) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const box = this.boxOf(placement, definition);
    return {
      x: box.x * scaleX,
      y: box.y * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY,
    };
  }

  /**
   * A placement's footprint in canvas pixel coordinates, for any baking mode
   * (tile-baked bounds, or an actor sprite's real bounds).
   */
  private boxOf(
    placement: SmartObjectPlacement,
    definition: SmartObjectDefinition,
  ): { x: number; y: number; width: number; height: number } {
    // Objects that stamp tiles use their tile bounds, whichever mode baked them
    // (the floor switch is actor-baked but bakes tile 18 and has no sprite).
    const stampsTiles = definition.set.some(
      (variant) => variant.bottomLayerTiles.length > 0 || variant.topLayerTiles.length > 0,
    );
    if (definition.baking === 'actor' && !stampsTiles) {
      return this.actorBox(placement);
    }
    const bounds = smartObjectBounds(
      definition,
      placement.variantIndex ?? 0,
      placement.subTypeIndex ?? 0,
    );
    return {
      x: (placement.anchorCol + bounds.minCol) * TILE_SIZE,
      y: (placement.anchorRow + bounds.minRow) * TILE_SIZE,
      width: bounds.cols * TILE_SIZE,
      height: bounds.rows * TILE_SIZE,
    };
  }

  /**
   * The door covering a **page-wide** pointer position on THIS canvas, or null
   * when the pointer is not over this canvas.
   *
   * The connect drag is owned by the source door's canvas, but the pointer can
   * be over any layer's canvas — or over the padded gaps between sections. The
   * host walks every section with this and lets the one under the pointer
   * resolve the door, which is what makes a connection cross layers.
   */
  doorAtViewport(clientX: number, clientY: number): SmartObjectPlacement | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      return null;
    }
    const canvasX = ((clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((clientY - rect.top) / rect.height) * canvas.height;
    const tile = {
      x: Math.floor(canvasX / TILE_SIZE),
      y: Math.floor(canvasY / TILE_SIZE),
    };
    if (tile.x < 0 || tile.x >= DIMENSION || tile.y < 0 || tile.y >= DIMENSION) {
      return null;
    }
    return this.doorAtTile(tile);
  }

  /**
   * Finds a **door** covering a tile on THIS canvas's layer.
   *
   * Connect is cross-layer: a door may be targeted from another layer's drag,
   * so this ignores the currently edited layer and only requires the placement
   * to belong to this canvas's base layer.
   */
  doorAtTile(tile: { x: number; y: number }): SmartObjectPlacement | null {
    for (let i = this.smartObjects.length - 1; i >= 0; i--) {
      const placement = this.smartObjects[i];
      if ((placement.baseLayerId ?? 0) !== this.layerIndex || this.isHidden(placement)) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition || !isConnectableDefinition(definition)) {
        continue;
      }
      const box = this.boxOf(placement, definition);
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;
      if (px >= box.x && px < box.x + box.width && py >= box.y && py < box.y + box.height) {
        return placement;
      }
    }
    return null;
  }

  /**
   * Whether this canvas is cropped to the TV view. Exposed for the template,
   * which sizes both canvases and the border from it.
   */
  get croppedCanvas(): boolean {
    return this._cropped;
  }

  /** Backing-store size of the room canvas (also the overlay's size). */
  get canvasSize(): { width: number; height: number } {
    return roomCanvasSize(this._cropped);
  }

  /** CSS size of the room canvas (pixelated scale, shared by the overlay). */
  get canvasStyleSize(): { width: number; height: number } {
    return roomCanvasStyleSize(this._cropped);
  }

  /** Number of tile rows this canvas exposes (24 when cropped, else 32). */
  get visibleTilesH(): number {
    return roomCanvasTilesH(this._cropped);
  }

  /**
   * Sizes the room canvas and its preview overlay to the layer's crop.
   *
   * Setting `canvas.width`/`height` also clears the canvas, which is why this
   * runs before {@link redraw} (and why it must only assign when the size
   * actually changed — otherwise every redraw would needlessly reset pixels).
   */
  private applyCanvasSize(): void {
    const { width, height } = roomCanvasSize(this._cropped);
    for (const ref of [this.canvasRef(), this.previewRef()]) {
      const canvas = ref?.nativeElement;
      if (!canvas) {
        continue;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  }

  /** Re-renders the current layer onto the canvas. */
  async redraw(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const renderer = this.renderer;
    if (!canvas || !renderer) {
      return;
    }

    await renderer.prepareTileset();

    if (this.index < 0) {
      return;
    }

    // Always rasterize the FULL room grid, even when the canvas is cropped: the
    // crop is purely the backing-store size, so a cropped canvas simply drops
    // rows 24-31 while uncropped layers (Dark World / Gameboy) keep them.
    // Using the full height for the buffer keeps one code path and avoids
    // half-drawn tiles at the crop edge.
    const buffer = new ImageBuffer(canvas.width, ROOM_HEIGHT);
    buffer.fill(0, 0, 0, 255);

    // Ground acts as the base layer: it is drawn first, and the room's base
    // tiles are skipped wherever ground is painted — except on tiles covered by
    // a smart object (a decoration always keeps its own stamped tiles).
    const skip = this.groundTiles ? this.groundSkipSet() : undefined;
    if (this.groundTiles) {
      renderer.drawGround(buffer, this.groundTiles, this.gba);
    }
    // The grabbed object is HIDDEN (not erased) while it follows the cursor: its
    // footprint tiles are skipped in the composite so the tiles underneath (and
    // any overlapped object) show instead of its old sprite. The room layers
    // themselves stay untouched, so a cancel/drop can never lose tiles.
    // Objects hidden from the object column are skipped the same way.
    const dragGhost = mergeSkip(this.dragGhostSet(), this.hiddenObjectSet(this.layerIndex));
    renderer.drawSingleLayer(
      buffer,
      this.index,
      this.layerIndex,
      this.gba,
      dragGhost.size > 0 ? mergeSkip(skip, dragGhost) : skip,
    );
    if (this.topLayer) {
      const ghostTop = mergeSkip(
        this.dragGhostSet(this.layerIndex + 8),
        this.hiddenObjectSet(this.layerIndex + 8),
      );
      renderer.drawSingleLayer(
        buffer,
        this.index,
        this.layerIndex + 8,
        this.gba,
        ghostTop.size > 0 ? ghostTop : undefined,
      );
    }

    // Editor-only scenery for actor-baked objects (e.g. the item pedestal tile
    // beneath an Item Stand). Drawn BEFORE the actors so the sprite sits on top
    // of it. These tiles are never baked into the room, so this is the only
    // place they appear.
    this.drawActorPreviewTiles(buffer, renderer);

    // Actors (enemies) on the active layer, drawn over the tiles and over the
    // editor-only scenery above.
    if (this.actors.length > 0) {
      await renderer.prepareActors();
      for (const actor of this.actors) {
        if ((actor.Layer & 0x0f) !== this.layerIndex) {
          continue;
        }
        renderer.drawActorAt(buffer, actor, this.gba);
      }
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    // Upload only the window the canvas shows: the buffer is full-height, while
    // a cropped canvas is 384px tall and a `putImageData` call simply discards
    // everything below its bottom edge.
    const image = new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height);
    ctx.putImageData(image, 0, 0);

    // The overlay shares the canvas with the actor markers + hover outline, so
    // repaint it whenever the room is redrawn.
    this.drawHoverOutline();
  }

  /**
   * Draws the editor-only scenery an actor-baked placement carries in
   * {@link SmartObjectVariant.previewTiles} (e.g. the `Item pedestal` tile under
   * an Item Stand) onto `buffer`, before the actor sprites are composited.
   *
   * These tiles are never baked into the room: they exist only so a placed actor
   * does not look like it is floating. Only placements on the canvas's own base
   * layer are drawn, and hidden/dragged placements are skipped so hide and drag
   * ghosting behave exactly as they do for tile-baked objects.
   */
  private drawActorPreviewTiles(buffer: ImageBuffer, renderer: StageRenderer): void {
    const draggingSource = this.dragging?.source ?? null;
    for (const placement of flattenPlacements(this._smartObjects)) {
      if (placement === draggingSource || this.isHidden(placement)) {
        continue;
      }
      if ((placement.baseLayerId ?? 0) !== this.layerIndex) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (definition?.baking !== 'actor') {
        continue;
      }
      const variant = smartObjectVariant(
        definition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      for (const offset of variant.previewTiles ?? []) {
        const x = (placement.anchorCol + offset.dCol) * TILE_SIZE;
        const y = (placement.anchorRow + offset.dRow) * TILE_SIZE;
        if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
          continue;
        }
        renderer.drawTilesetTile(buffer, x, y, offset.tile, this.gba);
      }
    }
  }

  /**
   * Tile offsets (row*32+col) occupied on `layerIndex` by objects hidden in the
   * object column, so their stamped tiles are skipped in the render.
   *
   * Keyed on the variant's own tiles rather than `baking`: an actor-baked object
   * may ALSO bake tiles (the floor switch bakes tile 18 because `SWTH` has no
   * sprite), so "has no tiles" is the real test.
   */
  private hiddenObjectSet(layerIndex: number): Set<number> {
    const hidden = new Set<number>();
    if (this._hiddenObjects.size === 0) {
      return hidden;
    }
    for (const placement of flattenPlacements(this._smartObjects)) {
      if (!this.isHidden(placement)) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(
        definition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      const offsets =
        layerIndex === (placement.baseLayerId ?? 0) + 8
          ? variant.topLayerTiles
          : layerIndex === (placement.baseLayerId ?? 0)
            ? variant.bottomLayerTiles
            : [];
      for (const offset of offsets) {
        const row = placement.anchorRow + offset.dRow;
        const col = placement.anchorCol + offset.dCol;
        if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
          continue;
        }
        hidden.add(row * DIMENSION + col);
      }
    }
    return hidden;
  }

  /**
   * Tile offsets (row*32+col) our footprint occupies on the given layer, or an
   * empty set when nothing is being dragged. Used to skip the grabbed object's
   * tiles in the render so it visibly detaches from the room without any tile
   * being cleared (see {@link restampPlacement}).
   *
   * The SOURCE's recorded anchor/variant is used (not the live drag variant):
   * after a rotation the object may still be stamped in a different shape than
   * the one being dragged, and that old shape is what must disappear.
   */
  private dragGhostSet(layerIndex = this.layerIndex): Set<number> {
    const ghost = new Set<number>();
    const dragging = this.dragging;
    if (!dragging) {
      return ghost;
    }
    // Objects with no stamped tiles (most actor-baked objects) only hide their
    // sprite, which `actors` already does — nothing to skip in the tile pass.
    // The floor switch is actor-baked AND bakes a tile, so test the variant's
    // offsets instead of the `baking` mode.
    const hasTiles = this.footprintOffsets(dragging.source, layerIndex).some(
      (offsets) => offsets.length > 0,
    );
    if (!hasTiles) {
      return ghost;
    }
    for (const offsets of this.footprintOffsets(dragging.source, layerIndex)) {
      for (const offset of offsets) {
        const row = (dragging.source?.anchorRow ?? dragging.anchorRow) + offset.dRow;
        const col = (dragging.source?.anchorCol ?? dragging.anchorCol) + offset.dCol;
        if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
          continue;
        }
        ghost.add(row * DIMENSION + col);
      }
    }
    return ghost;
  }

  /**
   * The tile offsets a placement writes to `layerIndex`, for its recorded
   * variant (bottom tiles on `baseLayerId`, top tiles on `baseLayerId + 8`).
   * Returns `[]` when the placement does not touch that layer.
   */
  private footprintOffsets(
    placement: SmartObjectPlacement | null,
    layerIndex: number,
  ): SmartObjectTileOffset[][] {
    if (!placement) {
      return [];
    }
    const definition = findSmartObjectDefinition(placement.id);
    if (!definition) {
      return [];
    }
    const variant = smartObjectVariant(
      definition,
      placement.variantIndex ?? 0,
      placement.subTypeIndex ?? 0,
      placement.scale,
    );
    const baseLayerId = placement.baseLayerId ?? 0;
    if (layerIndex === baseLayerId + 8) {
      return [variant.topLayerTiles];
    }
    if (layerIndex === baseLayerId) {
      return [variant.bottomLayerTiles];
    }
    return [];
  }

  /**
   * Tile offsets (row*32+col) where the base layer must be hidden so the ground
   * shows through: every painted ground tile that is **not** covered by a smart
   * object (decorations keep their stamped base tiles on top of the ground).
   */
  private groundSkipSet(): Set<number> {
    const ground = this.groundTiles;
    const skip = new Set<number>();
    if (!ground) {
      return skip;
    }
    // Collect the tiles owned by smart objects on the active base layer, so the
    // ground never hides a decoration. Derived from each placement's definition
    // + anchor + variant (the same source of truth the compositor stamps from)
    // rather than the recorded refs, which can drift after a rotate/move.
    const owned = new Set<number>();
    for (const placement of flattenPlacements(this.smartObjects)) {
      if (placement.baseLayerId !== this.groundBaseLayerId || this.isHidden(placement)) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(
        definition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      for (const offset of variant.bottomLayerTiles) {
        const row = placement.anchorRow + offset.dRow;
        const col = placement.anchorCol + offset.dCol;
        if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
          continue;
        }
        owned.add(row * DIMENSION + col);
      }
    }
    for (let offset = 0; offset < ground.length; offset++) {
      if (ground[offset] !== 0 && !owned.has(offset)) {
        skip.add(offset);
      }
    }
    return skip;
  }

  /**
   * Starts painting/erasing, or grabs a smart object when the hand tool is active.
   */
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    // A connect drag is in progress: ignore the press (the release completes it).
    if (this.connectingFrom()) {
      return;
    }
    // Interacting with the canvas dismisses any open context menu. The menu's
    // backdrop normally handles this, but it is skipped when the menu was opened
    // from the object list (the pointer never reached the backdrop).
    if (this.contextMenu()) {
      this.closeContextMenu();
    }
    (event.target as HTMLElement).setPointerCapture(event.pointerId);

    // Tell the host what was clicked so the object column can highlight it.
    // Emitted before the grab/paint so the highlight is already in place when
    // the object starts moving.
    const clickedTile = this.tileAt(event);
    this.objectSelected.emit(clickedTile ? this.findPlacementAt(clickedTile) : null);

    if (this.tool === 'hand') {
      this.grabSmartObject(event);
      return;
    }

    this.painting = true;
    if (this.tool === 'eraser') {
      this.eraseAt(event);
    } else {
      this.paintAt(event);
    }
  }

  /** Continues painting / moves a grabbed smart object. */
  onPointerMove(event: PointerEvent): void {
    // While connecting, draw a line from the source door to the cursor.
    if (this.connectingFrom()) {
      this.drawConnectLine(event);
      return;
    }
    if (this.dragging) {
      this.moveDragged(event);
      return;
    }
    if (this.painting) {
      this.updateHover(event);
      if (this.tool === 'eraser') {
        this.eraseAt(event);
      } else {
        this.paintAt(event);
      }
      return;
    }
    // Keep the hovered-object boundary outline in sync with the pointer.
    this.updateHover(event);
    if (this.tool === 'hand') {
      this.hoveringObject.set(this.hoveredPlacement !== null);
    }
  }

  /** Stops painting / drops a grabbed smart object / completes a connect drag. */
  onPointerUp(event: PointerEvent): void {
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    // Completing a connect drag: attach the WARP child if a door is under the cursor.
    if (this.connectingFrom()) {
      this.finishConnect(event);
      return;
    }
    if (this.dragging) {
      this.dropDragged();
      return;
    }
    this.painting = false;
    this.hoveringObject.set(false);
  }

  /** Hides the hover outline when the pointer leaves the canvas. */
  onPointerLeaveCanvas(event: PointerEvent): void {
    // A connect drag keeps running while the pointer is outside the canvas (the
    // user may drag over another layer's canvas); do not complete it here.
    if (this.connectingFrom()) {
      return;
    }
    this.hoveredPlacement = null;
    this.hoveringObject.set(false);
    // Repaint the outline (keeps the context-menu target outlined if the menu
    // is still open; otherwise clears it since nothing is hovered).
    this.drawHoverOutline();
    this.onPointerUp(event);
  }

  /** Prevents the browser context menu on right click. */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  /**
   * Right-click on the canvas: opens the context menu for the smart object
   * under the cursor, otherwise closes any open menu. Enemies are smart objects
   * too, so a single placement lookup covers both.
   */
  onCanvasContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const tile = this.tileAt(event);
    // Position the menu relative to the canvas wrapper (its offset parent).
    const wrapper = (event.currentTarget as HTMLElement) ?? undefined;
    const rect = wrapper?.getBoundingClientRect();
    const x = rect ? event.clientX - rect.left : event.offsetX;
    const y = rect ? event.clientY - rect.top : event.offsetY;

    const placement = tile ? this.findPlacementAt(tile) : null;
    // A right click on the canvas always positions the menu inside the wrapper,
    // even if it was previously opened from the object list.
    this.menuIsFixed.set(false);
    this.contextMenu.set(placement ? { placement, x, y } : null);
    this.drawHoverOutline();
  }

  /** Closes the context menu. */
  closeContextMenu(): void {
    const wasOpen = this.contextMenu() !== null;
    this.menuIsFixed.set(false);
    this.contextMenu.set(null);
    this.drawHoverOutline();
    // Tell the host to forget the pointer position it supplied for this menu,
    // so a later menu (opened by right-clicking the canvas) is not positioned
    // over the object list.
    if (wasOpen) {
      this.contextMenuClosed.emit();
    }
  }

  /** Deletes the smart object targeted by the context menu. */
  deleteContextPlacement(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement || !this.room) {
      return;
    }
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    // A legacy actor bakes no tiles, so it is removed by the host (which owns the
    // legacy list) — nothing to clear on the room layers.
    if (this.isLegacy(placement)) {
      this.legacyDeleted.emit(placement);
      this.drawHoverOutline();
      void this.redraw();
      return;
    }
    // Remove the stamped tiles so the object disappears from the canvas, then
    // let the host drop the placement from the stage JSON.
    clearSmartObject(placement, this.room.Layers, placement.baseLayerId);
    // Re-stamp every remaining smart object so tiles that this one had covered
    // (overlapping objects) come back correctly.
    this.redrawSmartObjects({ list: this.smartObjects, skip: [placement] });
    this.decorationDeleted.emit(placement);
    this.drawHoverOutline();
    void this.redraw();
  }

  /** Whether a placement belongs to the legacy (archive) actor list. */
  private isLegacy(placement: SmartObjectPlacement): boolean {
    return this._legacyActors.includes(placement);
  }

  /**
   * Whether the smart object targeted by the context menu can be rotated (i.e.
   * its definition has more than one variant in its `set`).
   */
  canRotateContextPlacement(): boolean {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return false;
    }
    return canRotate(findSmartObjectDefinition(placement.id));
  }

  /**
   * Whether the context-menu target is connectable (a door), the only objects
   * that can be linked to another.
   */
  canConnectContextPlacement(): boolean {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return false;
    }
    return isConnectableDefinition(findSmartObjectDefinition(placement.id));
  }

  /**
   * Whether the context-menu target is a door that already has a connection —
   * either as the **source** (it owns a `WARP` child) or as the **target** (it
   * records a `connectedFrom` back-reference).
   */
  isContextPlacementConnected(): boolean {
    const placement = this.contextMenu()?.placement;
    return placement ? isConnected(placement) : false;
  }

  /**
   * Removes a door's connection. If the door is the **source** its `WARP` child
   * is dropped; if it is the **target** the source door's warp is cleared (and
   * this door's back-reference removed).
   */
  disconnectContextPlacement(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return;
    }
    this.contextMenu.set(null);
    this.hoveredPlacement = null;

    const changes = disconnectDoor(placement, this.smartObjects);
    if (changes.length === 0) {
      return;
    }
    // Replace each changed placement in the in-memory list by identity, then
    // re-stamp the survivors so the removed `WARP` child stops drawing.
    const list = this.smartObjects.map(
      (entry) => changes.find((change) => change.from === entry)?.to ?? entry,
    );
    this.redrawSmartObjects({ list, skip: [] });
    for (const change of changes) {
      this.placementUpdated.emit(change);
    }
    void this.redraw();
  }

  /**
   * Starts connecting the context-menu door: the pointer becomes a "connect"
   * cursor and a line follows the cursor until the user releases over another
   * door (or the connect is cancelled).
   */
  startConnect(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return;
    }
    this.connectingFrom.set(placement);
    this.connectCursor.set(null);
    this.contextMenu.set(null);
    // The line may have to leave this canvas entirely (the target door can live
    // in another layer's section), so the HOST draws it on a stack-wide
    // overlay. Track the pointer window-wide: releasing outside this canvas must
    // still complete (or cancel) the connection.
    window.addEventListener('pointermove', this.onWindowConnectMove);
    window.addEventListener('pointerup', this.onWindowConnectUp);
    this.connectDragChanged.emit(true);
    void this.redraw();
  }

  /** Cancels an in-progress connect drag. */
  cancelConnect(): void {
    this.connectingFrom.set(null);
    this.connectCursor.set(null);
    this.stopConnectTracking();
    this.connectDragChanged.emit(false);
    this.drawHoverOutline();
  }

  /**
   * Starts an ACTIVATION link from the context-menu source.
   *
   * The session is multi-target: each release over a valid target emits
   * {@link activationLinked} and the mode stays on, so one source can be linked
   * to several targets (the game uses a single room-local variable for all of
   * them). Ends via {@link cancelActivation} (Escape / right-click / re-click).
   */
  startActivation(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return;
    }
    this.contextMenu.set(null);
    // Clicking the same source again ends the session.
    if (this.activatingFrom() === placement) {
      this.cancelActivation();
      return;
    }
    this.activatingFrom.set(placement);
    this.activationTargets.set([]);
    this.connectCursor.set(null);
    window.addEventListener('pointermove', this.onWindowConnectMove);
    window.addEventListener('pointerup', this.onWindowConnectUp);
    window.addEventListener('keydown', this.onActivationKey);
    this.activationDragChanged.emit(true);
    void this.redraw();
  }

  /** Ends the activation session, clearing its lines. */
  cancelActivation(): void {
    if (!this.activatingFrom()) {
      return;
    }
    this.activatingFrom.set(null);
    this.activationTargets.set([]);
    this.connectCursor.set(null);
    this.stopConnectTracking();
    window.removeEventListener('keydown', this.onActivationKey);
    this.activationDragChanged.emit(false);
    this.drawHoverOutline();
    void this.redraw();
  }

  /** Escape cancels the activation session. */
  private readonly onActivationKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelActivation();
    }
  };

  /**
   * The activation TARGET (an actor object with `activatable.isTarget`) under a
   * tile, or null. Targets are actor placements, so the sprite bounds are used.
   */
  activationTargetAtTile(tile: { x: number; y: number }): SmartObjectPlacement | null {
    const source = this.activatingFrom();
    for (let i = this.smartObjects.length - 1; i >= 0; i--) {
      const placement = this.smartObjects[i];
      if (placement === source || (placement.baseLayerId ?? 0) !== this.layerIndex) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (!isActivationTarget(definition)) {
        continue;
      }
      const box = this.boxOf(placement, definition!);
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;
      if (px >= box.x && px < box.x + box.width && py >= box.y && py < box.y + box.height) {
        return placement;
      }
    }
    return null;
  }

  /** Stops listening for the connect drag once it leaves this canvas. */
  private stopConnectTracking(): void {
    window.removeEventListener('pointermove', this.onWindowConnectMove);
    window.removeEventListener('pointerup', this.onWindowConnectUp);
  }

  private readonly onWindowConnectMove = (event: PointerEvent): void => {
    if (this.connectingFrom() || this.activatingFrom()) {
      this.drawConnectLine(event);
    }
  };

  private readonly onWindowConnectUp = (event: PointerEvent): void => {
    if (this.activatingFrom()) {
      this.finishActivation(event);
      return;
    }
    if (this.connectingFrom()) {
      this.finishConnect(event);
    }
  };

  /**
   * Links the current activation source to the target under the pointer.
   *
   * Releasing over a valid target adds the link and the session STAYS OPEN, so
   * the user can link further targets. Releasing anywhere else cancels the
   * session — clicking empty space is the natural way out, alongside Escape.
   */
  private finishActivation(event: PointerEvent): void {
    const source = this.activatingFrom();
    if (!source) {
      return;
    }
    const target = this.activationTargetAtPointer(event);
    if (!target) {
      // Nothing under the cursor: treat the click as "I'm done".
      this.cancelActivation();
      return;
    }
    if (this.activationTargets().includes(target)) {
      // Already linked — keep the session open without adding a duplicate.
      return;
    }
    this.activationTargets.update((list) => [...list, target]);
    this.activationLinked.emit({ source, target });
    void this.redraw();
  }

  /** Resolves the activation target under a page-wide pointer position. */
  private activationTargetAtPointer(event: PointerEvent): SmartObjectPlacement | null {
    if (this.isPointerOverCanvas(event)) {
      const tile = this.tileAt(event);
      const local = tile ? this.activationTargetAtTile(tile) : null;
      if (local) {
        return local;
      }
    }
    return this.resolveDoor?.(event.clientX, event.clientY) ?? null;
  }

  /**
   * Paints every activation link as a dashed amber line from the source's centre
   * to each target's centre, plus the live line to the cursor while a link
   * session is running.
   *
   * Lines are drawn for links whose BOTH ends live on this canvas's base layer;
   * the host draws the cross-layer remainder (there is only ever one activation
   * layer view per room section, but targets may sit on other base layers).
   */
  private paintActivationLines(ctx: CanvasRenderingContext2D): void {
    const centre = (placement: SmartObjectPlacement): { x: number; y: number } | null => {
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        return null;
      }
      const bounds = this.actorBox(placement);
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };

    const drawLine = (
      from: SmartObjectPlacement,
      to: SmartObjectPlacement,
      dash: number[],
      alpha: number,
    ): void => {
      const a = centre(from);
      const b = centre(to);
      if (!a || !b) {
        return;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    };

    // Committed links (source → every recorded target).
    //
    // Only links whose SOURCE lives on THIS canvas's base layer are drawn: every
    // base layer renders its own `<app-room-canvas>`, so without this filter the
    // same line would appear once per layer section. (The source owns the link;
    // its targets may sit on other layers, and the line still belongs to the
    // source's section.)
    const byKey = new Map(this.smartObjects.map((p) => [placementKey(p), p] as const));
    for (const link of this.activationLinks) {
      const source = byKey.get(link.from);
      if (!source || (source.baseLayerId ?? 0) !== this.layerIndex) {
        continue;
      }
      for (const targetKey of link.to) {
        const target = byKey.get(targetKey);
        if (target) {
          drawLine(source, target, [5, 4], 0.9);
        }
      }
    }

    // Live session: the source, the targets picked so far, and the cursor.
    // Also only on the source's own layer canvas.
    const source = this.activatingFrom();
    if (!source || (source.baseLayerId ?? 0) !== this.layerIndex) {
      return;
    }
    for (const target of this.activationTargets()) {
      drawLine(source, target, [5, 4], 1);
    }
    const cursor = this.connectCursor();
    const from = centre(source);
    if (cursor && from) {
      ctx.save();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo((cursor.x + 0.5) * TILE_SIZE, (cursor.y + 0.5) * TILE_SIZE);
      ctx.stroke();
      ctx.restore();
    }

    // Highlight a target under the cursor.
    const hovered = this.activationTargetAtTile(cursor ?? { x: -1, y: -1 });
    if (hovered) {
      const box = this.actorBox(hovered);
      this.strokeOutline(ctx, box.x, box.y, box.width, box.height, { color: '#22c55e', dash: [] });
    }
  }

  /**
   * Completes a connect drag: if another door is under the pointer, delegates to
   * {@link connectDoors} to attach a child `WARP` actor to the **source** door
   * and record the target's back-reference, then reports both updates.
   */
  private finishConnect(event: PointerEvent): void {
    const source = this.connectingFrom();
    if (!source) {
      return;
    }
    this.connectingFrom.set(null);
    this.connectCursor.set(null);
    this.stopConnectTracking();
    // The drag is over however it ends — the host clears its cross-layer line.
    this.connectDragChanged.emit(false);
    // Ask the HOST which door is under the pointer: the target may live in
    // another base layer's section (its own canvas), so this canvas cannot
    // resolve it on its own.
    const target = this.doorAtPointer(event);
    if (!target || target === source) {
      this.drawHoverOutline();
      return;
    }

    // The door rules (warp type, anchor, back-reference) live in the door module
    // so the canvas only reports interaction; the host page persists the result.
    // Both definitions are passed so the warp actor AND its destination are
    // centred on their respective door footprints (actors use half-tiles).
    const sourceDefinition = findSmartObjectDefinition(source.id);
    const targetDefinition = findSmartObjectDefinition(target.id);
    const { source: sourceChange, target: targetChange } = connectDoors(
      source,
      target,
      sourceDefinition,
      targetDefinition,
    );
    // Apply both to this canvas's in-memory list so a second connect/render is
    // consistent even before the host round-trips the state.
    const list = this.smartObjects.map((placement) =>
      placement === source ? sourceChange.to : placement === target ? targetChange.to : placement,
    );
    this.redrawSmartObjects({ list, skip: [source, target] });
    this.placementUpdated.emit(sourceChange);
    this.placementUpdated.emit(targetChange);
    this.drawHoverOutline();
    void this.redraw();
  }

  /**
   * Resolves the door under a page-wide pointer position, through the host when
   * the pointer is outside this canvas.
   *
   * Inside this canvas the local hit-test is used directly; otherwise
   * {@link doorAtViewport} ask the host, which knows every layer's canvas.
   */
  private doorAtPointer(event: PointerEvent): SmartObjectPlacement | null {
    if (this.isPointerOverCanvas(event)) {
      const tile = this.tileAt(event);
      const local = tile ? this.doorAtTile(tile) : null;
      if (local) {
        return local;
      }
    }
    return this.resolveDoor?.(event.clientX, event.clientY) ?? null;
  }

  /** Whether a pointer position lies over this canvas's visible area. */
  private isPointerOverCanvas(event: PointerEvent): boolean {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom
    );
  }

  /** The door covering a tile on THIS canvas's layer (see {@link doorAtTile}). */

  /**
   * Rotates the smart object targeted by the context menu to the next variant in
   * its definition's `set`. Clears the current tiles, re-stamps the next variant
   * at the same anchor and emits the change so the host updates the stage JSON.
   *
   * For a **door** whose rotation drives an entrance direction, an attached
   * `WARP` child has its warp type advanced in lock-step (north → east → south →
   * west), so the connection's facing follows the sprite.
   */
  rotateContextPlacement(): void {
    const from = this.contextMenu()?.placement;
    const room = this.room;
    if (!from || !room) {
      return;
    }
    const definition = findSmartObjectDefinition(from.id);
    if (!canRotate(definition) || !definition) {
      return;
    }

    // The rotation descriptor says HOW MANY orientations exist; the definition's
    // own `onRotate` hook decides HOW one is applied (a door advances its WARP
    // type, the player start repacks its actor `Variable`, plain objects bump
    // `variantIndex`). The canvas never names an object.
    const nextVariant = nextRotation(definition, from.variantIndex ?? 0);
    const rotated = applyRotation(definition, from, nextVariant);

    const list = this.smartObjects.map((placement) => (placement === from ? rotated : placement));
    // `stale: [from]` tears down the OLD footprint — essential for objects whose
    // footprint changes drastically when rotated (big door 6×2 ↔ 2×6), otherwise
    // the old tiles linger as ghosts.
    this.redrawSmartObjects({ list, skip: [from], stale: [from] });
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    this.decorationRotated.emit({ from, to: rotated });
    this.drawHoverOutline();
    void this.redraw();
  }

  /**
   * Sets the growth of a scalable object in ONE direction and re-stamps it.
   *
   * The placement stays a single smart object: only its `scale` record changes,
   * and the tiles are re-composited from the (expanded) variant. The menu stays
   * open so several directions can be grown/shrunk in one go.
   */
  private scaleContextPlacement(directionIndex: number, value: number): void {
    const from = this.contextMenu()?.placement;
    if (!from || directionIndex < 0 || directionIndex >= SCALE_DIRECTIONS.length) {
      return;
    }
    const direction = SCALE_DIRECTIONS[directionIndex];
    const nextScale = { ...scaleOf(from.scale), [direction]: Math.max(0, value) };
    const scaled: SmartObjectPlacement = { ...from, scale: nextScale };
    // `stale: [from]` tears down the OLD footprint first, which is what makes
    // SHRINKING remove the tiles that are no longer covered.
    const list = this.smartObjects.map((placement) => (placement === from ? scaled : placement));
    this.redrawSmartObjects({ list, skip: [from], stale: [from] });
    // Keep the menu open and re-point it at the updated placement so the counts
    // it shows stay in sync and the next step builds on this one.
    this.contextMenu.update((menu) => (menu ? { ...menu, placement: scaled } : menu));
    this.hoveredPlacement = scaled;
    this.placementUpdated.emit({ from, to: scaled });
    this.drawHoverOutline();
    void this.redraw();
  }

  /**
   * The sub-types the context-menu target offers, or `[]` when it has none (so
   * the "Type" submenu stays hidden). Only definitions with `subTypes` (e.g. the
   * merged door) list anything.
   */
  contextSubTypes(): SmartObjectSubType[] {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return [];
    }
    return findSmartObjectDefinition(placement.id)?.subTypes ?? [];
  }

  /**
   * Plain actions for the shared context menu, in display order. Built from the
   * target's capabilities so the same menu serves decorations, enemies, doors and
   * the player start without per-type markup.
   */
  contextActions(): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [];
    if (this.canRotateContextPlacement()) {
      actions.push({
        id: 'rotate',
        label: 'Rotate',
        icon: 'M4 2a1 1 0 011 1v1.6a7 7 0 119.2 10.4 1 1 0 11-1.2-1.6A5 5 0 106 6.7V8a1 1 0 11-2 0V3a1 1 0 011-1z',
      });
    }
    // Activation SOURCES can link to targets. Targets never show this.
    if (this.isContextActivationSource()) {
      actions.push({
        id: 'activate',
        label: 'Activates',
        accent: true,
        icon: 'M11 2a1 1 0 10-2 0v7H2a1 1 0 100 2h7v7a1 1 0 102 0v-7h7a1 1 0 100-2h-7V2z',
      });
    }
    // Either end of an existing link can drop it from this menu.
    if (this.hasContextActivationLink()) {
      actions.push({
        id: 'unlink-activation',
        label: 'Cancel activation',
        accent: true,
        icon: 'M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z',
      });
    }
    if (this.canConnectContextPlacement()) {
      if (this.isContextPlacementConnected()) {
        actions.push({
          id: 'disconnect',
          label: 'Cancel connect',
          accent: true,
          icon: 'M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z',
        });
      } else {
        actions.push({
          id: 'connect',
          label: 'Connect',
          accent: true,
          icon: 'M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z',
        });
      }
    }
    actions.push({
      id: 'delete',
      label: 'Delete',
      danger: true,
      icon: 'M8 2a1 1 0 00-1 1v1H4a1 1 0 000 2h12a1 1 0 100-2h-3V3a1 1 0 00-1-1H8zM5 8a1 1 0 011 1v6a1 1 0 102 0V9a1 1 0 112 0v6a1 1 0 102 0V9a1 1 0 112 0v6a2 2 0 01-2 2H7a2 2 0 01-2-2V9a1 1 0 011-1z',
    });
    return actions;
  }

  /**
   * Submenu groups for the shared context menu: door styles ("Type") and the
   * player start's state/colour. Rendered as nested submenus, never as one long
   * list.
   */
  contextChoiceGroups(): ContextMenuChoiceGroup[] {
    const groups: ContextMenuChoiceGroup[] = [];

    const subTypes = this.contextSubTypes();
    if (subTypes.length > 0) {
      groups.push({
        id: 'type',
        label: 'Type',
        icon: 'M10 2a1 1 0 011 1v1.6a5.5 5.5 0 014.4 4.4H17a1 1 0 110 2h-1.6a5.5 5.5 0 01-4.4 4.4V17a1 1 0 11-2 0v-1.6a5.5 5.5 0 01-4.4-4.4H3a1 1 0 110-2h1.6A5.5 5.5 0 019 4.6V3a1 1 0 011-1zm0 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
        choices: subTypes.map((subType, index) => ({ value: index, label: subType.name })),
        selected: this.contextSubTypeIndex(),
      });
    }

    // Variable-backed fields the definition declares (a player start's
    // `Player State`, the gem's `Gem Type`, a goal's `Shape`). The canvas renders
    // them all the same way and never decodes an object's bits itself.
    const placement = this.contextMenu()?.placement;
    const definition = placement ? findSmartObjectDefinition(placement.id) : undefined;
    for (const field of fieldsOf(definition)) {
      groups.push({
        id: field.id,
        label: field.label,
        choices: field.choices.map((entry) => ({ value: entry.value, label: entry.label })),
        selected: placement ? field.value(placement) : 0,
        kind: field.kind,
        min: field.min,
        max: field.max,
      });
    }

    // "Scale": grow or shrink a scalable decoration one tile at a time in each
    // direction. The object stays a SINGLE placement — its edge tiles are
    // repeated — so a wall of breakable blocks is one object instead of dozens.
    if (placement && canScale(definition)) {
      const scale = scaleOf(placement.scale);
      groups.push({
        id: SCALE_GROUP_ID,
        label: 'Scale',
        icon: 'M3 3h5v2H5.914l9.086 9.086V11h2v6H3v-2h5.586L3 8.414V3zm14 0v6h-2V5.914l-4.5 4.5-1.414-1.414 4.5-4.5H11V3h6z',
        kind: 'steppers',
        choices: SCALE_DIRECTIONS.map((direction) => ({
          value: SCALE_DIRECTIONS.indexOf(direction),
          label: SCALE_DIRECTION_LABELS[direction],
        })),
        values: SCALE_DIRECTIONS.map((direction) => scale[direction]),
        selected: null,
        max: 31,
      });
    }

    return groups;
  }

  /** Dispatches a plain action from the shared context menu. */
  onContextAction(id: string): void {
    switch (id) {
      case 'rotate':
        this.rotateContextPlacement();
        break;
      case 'connect':
        this.startConnect();
        break;
      case 'disconnect':
        this.disconnectContextPlacement();
        break;
      case 'delete':
        this.deleteContextPlacement();
        break;
      case 'activate':
        this.startActivation();
        break;
      case 'unlink-activation':
        this.unlinkContextActivation();
        break;
    }
  }

  /** Whether the context-menu target can start activation links. */
  isContextActivationSource(): boolean {
    const placement = this.contextMenu()?.placement;
    return !!placement && isActivationSource(findSmartObjectDefinition(placement.id));
  }

  /**
   * Whether the context-menu target is either end of an existing activation
   * link — i.e. there is something for "Cancel activation" to remove.
   */
  hasContextActivationLink(): boolean {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return false;
    }
    if (isLinkedTarget(placement, this.activationLinks)) {
      return true;
    }
    return sourceTargets(placement, this.activationLinks).length > 0;
  }

  /**
   * Drops every activation link the context-menu target participates in and
   * emits the updated placements so the host clears their variables.
   *
   * A target only ever has one incoming link, so removing it means clearing
   * that target. A source may drive several targets, so removing it clears the
   * source's `Set Variable` AND every one of its targets' `Activation
   * Variable` — otherwise those targets would wait forever on a variable
   * nothing writes.
   */
  unlinkContextActivation(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement) {
      return;
    }
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    this.activationUnlinked.emit(placement);
    void this.redraw();
  }

  /** Dispatches a submenu choice from the shared context menu. */
  onContextChoice(event: { group: string; value: number }): void {
    // The Scale steppers report `<group>:<directionIndex>`, one row each.
    if (event.group.startsWith(`${SCALE_GROUP_ID}:`)) {
      const directionIndex = Number(event.group.slice(SCALE_GROUP_ID.length + 1));
      this.scaleContextPlacement(directionIndex, event.value);
      return;
    }
    // A definition MAY have both a sub-type list (group id `type`) and a
    // variable-backed field also called `Type` (e.g. AMOS). Resolve by looking up
    // the actual field first, so the field always wins when it exists.
    const placement = this.contextMenu()?.placement;
    const definition = placement ? findSmartObjectDefinition(placement.id) : undefined;
    const field = fieldsOf(definition).find((entry) => entry.id === event.group);
    if (field) {
      // Flags and steppers stay open so several edits can be made in one go.
      const keepOpen = field.kind === 'flags' || field.kind === 'number';
      this.updateContextPlacement(field.withValue(placement!, event.value), keepOpen);
      return;
    }
    if (event.group === 'type') {
      this.selectContextSubType(event.value);
    }
  }

  /**
   * Swaps the context-menu target for an updated copy and re-renders.
   *
   * Used by the variable-backed field setters; the definition supplied the new
   * placement, so nothing here depends on which field it was.
   */
  private updateContextPlacement(to: SmartObjectPlacement, keepOpen = false): void {
    const from = this.contextMenu()?.placement;
    if (!from) {
      return;
    }
    const list = this.smartObjects.map((placement) => (placement === from ? to : placement));
    this.redrawSmartObjects({ list });
    if (keepOpen) {
      // Flags and numeric steppers stay open across edits, so the menu keeps
      // pointing at the UPDATED placement (otherwise the next toggle would be
      // applied to the stale copy and lose the previous change).
      this.contextMenu.update((menu) => (menu ? { ...menu, placement: to } : menu));
      this.hoveredPlacement = to;
    } else {
      this.contextMenu.set(null);
      this.hoveredPlacement = null;
    }
    this.placementUpdated.emit({ from, to });
    this.drawHoverOutline();
    void this.redraw();
  }

  /** Index of the sub-type the context-menu target currently uses. */
  contextSubTypeIndex(): number {
    const placement = this.contextMenu()?.placement;
    return placement ? resolveSubTypeIndex(placement.id, placement.subTypeIndex) : 0;
  }

  /**
   * Switches the context-menu target to a different sub-type (e.g. door →
   * closed door → key door). The tiles are re-stamped with the new sub-type's
   * variant of the **same** facing, and the change is emitted so the host
   * records it.
   */
  selectContextSubType(subTypeIndex: number): void {
    const from = this.contextMenu()?.placement;
    const room = this.room;
    if (!from || !room) {
      return;
    }
    const definition = findSmartObjectDefinition(from.id);
    if (!definition?.subTypes?.[subTypeIndex]) {
      return;
    }
    if (resolveSubTypeIndex(from.id, from.subTypeIndex) === subTypeIndex) {
      this.contextMenu.set(null);
      return;
    }
    const changed: SmartObjectPlacement = { ...from, subTypeIndex };
    const list = this.smartObjects.map((placement) => (placement === from ? changed : placement));
    this.redrawSmartObjects({ list, skip: [from], stale: [from] });
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    this.placementUpdated.emit({ from, to: changed });
    this.drawHoverOutline();
    void this.redraw();
  }

  /**
   * Re-stamps every placed smart object onto the room layers.
   *
   * Each placement records its own definition id + anchor + variant, so clearing
   * and re-applying them restores the correct composite (useful after a
   * deletion/rotate, where the replaced object's tiles must not leave holes or
   * ghosts in objects that overlapped it).
   *
   * The footprint teardown always clears the union of the CURRENT placements
   * ({@link smartObjects}), the incoming `override.list` and any explicit
   * `override.stale` entries, then re-stamps `override.list` minus `skip`. This
   * is what makes a footprint-CHANGING edit (e.g. rotating the 6×2 ↔ 2×6 big
   * door) remove the OLD variant's tiles rather than only the new one's.
   */
  private redrawSmartObjects(override?: {
    list: SmartObjectPlacement[];
    skip?: SmartObjectPlacement[];
    stale?: SmartObjectPlacement[];
  }): void {
    const room = this.room;
    if (!room) {
      return;
    }
    // Children are baked into the layers too, so tear down and re-stamp the
    // flattened list (roots + descendants).
    const source = flattenPlacements(override ? override.list : this.smartObjects);
    // The placements whose footprints must be cleared: the objects currently on
    // the layers (which hold the OLD state — e.g. the pre-rotation variant) plus
    // any explicit `stale` entries not in `this.smartObjects`, plus the incoming
    // list itself (so a footprint that only exists in the new state is cleared
    // too, before being re-stamped uniformly).
    const staleSource = flattenPlacements([
      ...this.smartObjects,
      ...(override?.list ?? []),
      ...(override?.stale ?? []),
    ]);
    // The placements that will remain stamped, in their stored order (later
    // ones draw on top of earlier ones at shared tiles).
    const skip = flattenPlacements(override?.skip ?? []);
    const stampOrder = source.filter((placement) => !skip.includes(placement));

    // Tiles a survivor will (re)stamp, per layer. A tile claimed by any survivor
    // must NOT be cleared while tearing down the old composite, otherwise a
    // shared tile — e.g. the top-layer tiles of an object that overlaps another
    // — would be zeroed and never restored.
    const claimed = new Map<number, Set<number>>();
    for (const placement of stampOrder) {
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(
        definition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      const add = (layerIndex: number, offsets: SmartObjectTileOffset[]): void => {
        let set = claimed.get(layerIndex);
        if (!set) {
          set = new Set<number>();
          claimed.set(layerIndex, set);
        }
        for (const offset of offsets) {
          const row = placement.anchorRow + offset.dRow;
          const col = placement.anchorCol + offset.dCol;
          if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
            continue;
          }
          set.add(row * DIMENSION + col);
        }
      };
      add(placement.baseLayerId, variant.bottomLayerTiles);
      add(placement.baseLayerId + 8, variant.topLayerTiles);
    }

    // Tear down every placement being replaced/removed, but keep any tile a
    // survivor still claims. Each footprint is derived from the placement's
    // definition + recorded variant (same source as `claimed`), so the two stay
    // consistent even when the refs have drifted (rotate/move/loaded JSON).
    for (const placement of staleSource) {
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(
        definition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      const clear = (layerIndex: number, offsets: SmartObjectTileOffset[]): void => {
        const layer = room.Layers[layerIndex];
        if (!layer) {
          return;
        }
        for (const offset of offsets) {
          const row = placement.anchorRow + offset.dRow;
          const col = placement.anchorCol + offset.dCol;
          if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
            continue;
          }
          const index = row * DIMENSION + col;
          if (!claimed.get(layerIndex)?.has(index)) {
            layer.Tiles[index] = 0;
          }
        }
      };
      clear(placement.baseLayerId, variant.bottomLayerTiles);
      clear(placement.baseLayerId + 8, variant.topLayerTiles);
    }

    // Re-stamp every survivor in order so the composite matches the placement
    // stacking (decorations on top of what they overlap).
    for (const placement of stampOrder) {
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      applySmartObject(
        definition,
        placement.anchorRow,
        placement.anchorCol,
        room.Layers,
        placement.baseLayerId,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        // Preserve user-edited actor fields (player start colour/state/facing).
        placement.actorVariable,
        placement.scale,
      );
    }
  }

  // --- Smart object drag & drop (from the toolbox) -------------------------

  /** Allows dropping a smart object onto the canvas, showing a live preview. */
  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-smart-object')) {
      return;
    }
    // Reject incompatible actors (no GBA sprite) on GBA layers: no drop, no
    // preview, and a "not allowed" indicator instead.
    if (this.dragBlockedHere()) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
      this.dragging = null;
      this.clearPreview();
      this.dragNotAllowed.set(true);
      return;
    }
    this.dragNotAllowed.set(false);
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    // dragover cannot read the data payload, so the toolbox exposes the dragged
    // definition through the shared service.
    const definition = this.dragService.definition();
    if (!definition) {
      return;
    }
    const tile = this.tileAt(event);
    if (!tile) {
      return;
    }
    // Anchor the preview so the object's bounding box is centered under the
    // cursor (feels natural when dragging a whole object).
    const bounds = smartObjectBounds(definition, this.dragService.variantIndex());
    const anchorRow = tile.y - Math.floor((bounds.rows - 1) / 2);
    const anchorCol = tile.x - Math.floor((bounds.cols - 1) / 2);
    this.dragging = {
      definition,
      source: null,
      grabRow: 0,
      grabCol: 0,
      anchorRow,
      anchorCol,
      variantIndex: this.dragService.variantIndex(),
      subTypeIndex: 0,
      active: true,
    };
    this.drawPreview();
  }

  /** Hides the preview when the drag leaves the canvas. */
  onDragLeave(): void {
    if (this.dragging?.source === null) {
      this.dragging = null;
      this.clearPreview();
    }
    this.dragNotAllowed.set(false);
  }

  /**
   * Whether the actor being dragged (if any) cannot be placed on this layer.
   *
   * Actors flagged `noGBASprite` only exist on the TV layer (base layer 0);
   * dropping one on a GBA layer (base layer 1-7) would place an actor the game
   * cannot draw there, so the drag is rejected with a "not allowed" indicator.
   */
  private dragBlockedHere(): boolean {
    if (this.layerIndex === 0) {
      return false;
    }
    const definition = this.dragService.definition();
    return definition?.baking === 'actor' && definition.noGBASprite === true;
  }

  /**
   * Places the dragged smart object: bakes its tiles onto the room layers (or,
   * for an actor-baked object, its actor) at the drop position, and emits the
   * resulting placement so the host can record it in the stage JSON.
   */
  onDrop(event: DragEvent): void {
    const room = this.room;
    const dragging = this.dragging;
    if (!room) {
      return;
    }
    // Reject the drop when the actor cannot exist on this layer (dragBlockedHere
    // already showed the not-allowed indicator during dragover).
    if (this.dragBlockedHere()) {
      event.preventDefault();
      this.dragService.clear();
      this.dragging = null;
      this.dragNotAllowed.set(false);
      this.clearPreview();
      return;
    }
    const id =
      event.dataTransfer?.getData('application/x-smart-object') ??
      this.dragging?.definition.id ??
      this.dragService.definition()?.id;
    if (!id) {
      return;
    }
    event.preventDefault();

    const definition = findSmartObjectDefinition(id);
    const tile = this.tileAt(event);
    if (!definition || !tile) {
      this.dragging = null;
      this.clearPreview();
      return;
    }
    // An actor template bakes its OWN preset variable (e.g. a "Big Key" `KEY0`),
    // so prefer the drag state's value over the definition default.
    const actorVariable = this.dragService.actorVariable();
    const placed = actorVariable !== undefined ? { ...definition, actorVariable } : definition;
    const anchorRow = dragging?.anchorRow ?? tile.y;
    const anchorCol = dragging?.anchorCol ?? tile.x;

    const placement = applySmartObject(
      placed,
      anchorRow,
      anchorCol,
      room.Layers,
      this.layerIndex,
      dragging?.variantIndex ?? 0,
      dragging?.subTypeIndex ?? 0,
    );
    this.dragService.clear();
    this.dragging = null;
    this.clearPreview();
    this.decorationPlaced.emit(placement);
    void this.redraw();
  }

  // --- Placed smart object dragging (hand tool) ----------------------------

  /** Starts dragging a placed smart object under the pointer, if any. */
  private grabSmartObject(event: PointerEvent): void {
    const room = this.room;
    const tile = this.tileAt(event);
    const point = this.pixelAt(event);
    if (!room || !tile || !point) {
      return;
    }
    // Use the SAME pixel-precise test as the hover hand cursor, so whatever the
    // user can hover is exactly what they can grab. A tile lookup here made the
    // hand appear but the grab silently fail on the sprite's corner tiles.
    const placement = this.findPlacementAtPoint(point);
    const definition = placement ? findSmartObjectDefinition(placement.id) : null;
    if (!placement || !definition) {
      return;
    }
    // A legacy actor bakes no tiles, so nothing is cleared/stamped; it is just
    // moved (the host updates the legacy list on drop). Its sprite is hidden from
    // the render while dragging via the `dragging.source` exclusion.
    if (this.isLegacy(placement)) {
      this.dragging = {
        definition,
        source: placement,
        grabRow: tile.y - placement.anchorRow,
        grabCol: tile.x - placement.anchorCol,
        anchorRow: placement.anchorRow,
        anchorCol: placement.anchorCol,
        variantIndex: placement.variantIndex ?? 0,
        subTypeIndex: placement.subTypeIndex ?? 0,
        active: true,
      };
      void this.redraw();
      this.draggingObject.set(true);
      this.hoveringObject.set(false);
      this.drawPreview();
      return;
    }
    // Do NOT clear the tiles here. The footprint is only HIDDEN from the view
    // while dragging (see `dragGhost`), so cancelling a grab, dropping on
    // nothing, or dropping an object whose footprint changed shape (the big
    // door rotates 6×2 ↔ 2×6) can never destroy neighbour tiles or leave part
    // of the door stuck in the room.
    // Set `dragging` BEFORE redrawing: the actor-baked sprite is excluded from
    // the rendered actor list and tile-baked objects are skipped by footprint.
    this.dragging = {
      definition,
      source: placement,
      grabRow: tile.y - placement.anchorRow,
      grabCol: tile.x - placement.anchorCol,
      anchorRow: placement.anchorRow,
      anchorCol: placement.anchorCol,
      variantIndex: placement.variantIndex ?? 0,
      subTypeIndex: placement.subTypeIndex ?? 0,
      scale: placement.scale,
      active: true,
    };
    void this.redraw();
    this.draggingObject.set(true);
    this.hoveringObject.set(false);
    this.drawPreview();
  }

  /**
   * Re-stamps a smart object at a NEW anchor (or with its recorded data
   * unchanged), compositing it over every OTHER placement.
   *
   * The object's footprint is torn down from its **recorded** anchor/variant
   * (which may differ from the target — e.g. after a rotation of a 6×2 ↔ 2×6
   * big door) and only tiles that no other placement still claims are cleared,
   * then every other placement is re-stamped and the moved one is stamped last
   * (top-most, as a hand-dropped object should be).
   *
   * This is deliberately non-destructive: the object was never removed from the
   * layers on grab, so blindly stamping would overwrite overlapped objects and
   * blindly clearing would wipe them — and would leave the old variant's tiles
   * stuck when the footprint changed shape.
   */
  private restampPlacement(
    source: SmartObjectPlacement,
    target: { anchorRow: number; anchorCol: number },
  ): SmartObjectPlacement {
    const room = this.room;
    const definition = findSmartObjectDefinition(source.id);
    const baseLayerId = source.baseLayerId ?? 0;
    const variantIndex = source.variantIndex ?? 0;
    const subTypeIndex = source.subTypeIndex ?? 0;
    if (!room || !definition) {
      return source;
    }
    const base = { anchorRow: target.anchorRow, anchorCol: target.anchorCol };

    // Every OTHER placement (children included) keeps its tiles: build the set
    // of tiles they claim so the teardown below never zeroes them.
    const others = flattenPlacements(this.smartObjects.filter((entry) => entry !== source));
    const claimed = new Map<number, Set<number>>();
    for (const placement of others) {
      const otherDefinition = findSmartObjectDefinition(placement.id);
      if (!otherDefinition) {
        continue;
      }
      const variant = smartObjectVariant(
        otherDefinition,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        placement.scale,
      );
      const add = (layerIndex: number, offsets: SmartObjectTileOffset[]): void => {
        let set = claimed.get(layerIndex);
        if (!set) {
          set = new Set<number>();
          claimed.set(layerIndex, set);
        }
        for (const offset of offsets) {
          const row = placement.anchorRow + offset.dRow;
          const col = placement.anchorCol + offset.dCol;
          if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
            continue;
          }
          set.add(row * DIMENSION + col);
        }
      };
      add(placement.baseLayerId, variant.bottomLayerTiles);
      add(placement.baseLayerId + 8, variant.topLayerTiles);
    }

    // Tear down the object's OLD footprint (the tiles actually on the layers —
    // derived from the placement's RECORDED anchor/variant, not the target) but
    // keep any tile another placement claims.
    const oldVariant = smartObjectVariant(definition, variantIndex, subTypeIndex, source.scale);
    const clear = (layerIndex: number, offsets: SmartObjectTileOffset[]): void => {
      const layer = room.Layers[layerIndex];
      if (!layer) {
        return;
      }
      for (const offset of offsets) {
        const row = source.anchorRow + offset.dRow;
        const col = source.anchorCol + offset.dCol;
        if (row < 0 || row >= DIMENSION || col < 0 || col >= DIMENSION) {
          continue;
        }
        const index = row * DIMENSION + col;
        if (!claimed.get(layerIndex)?.has(index)) {
          layer.Tiles[index] = 0;
        }
      }
    };
    clear(baseLayerId, oldVariant.bottomLayerTiles);
    clear(baseLayerId + 8, oldVariant.topLayerTiles);

    // Re-stamp the survivors, then the moved object on top of them.
    for (const placement of others) {
      const otherDefinition = findSmartObjectDefinition(placement.id);
      if (!otherDefinition) {
        continue;
      }
      applySmartObject(
        otherDefinition,
        placement.anchorRow,
        placement.anchorCol,
        room.Layers,
        placement.baseLayerId,
        placement.variantIndex ?? 0,
        placement.subTypeIndex ?? 0,
        // Keep any user-edited actor fields (player start colour/state/facing).
        placement.actorVariable,
        placement.scale,
      );
    }
    return applySmartObject(
      definition,
      base.anchorRow,
      base.anchorCol,
      room.Layers,
      baseLayerId,
      variantIndex,
      subTypeIndex,
      // The moved object's own variable, not the definition default.
      source.actorVariable,
      source.scale,
    );
  }

  /** Returns the top-most placement covering a tile, or null. */
  private findPlacementAt(tile: { x: number; y: number }): SmartObjectPlacement | null {
    return this.findPlacementAtPoint({
      x: (tile.x + 0.5) * TILE_SIZE,
      y: (tile.y + 0.5) * TILE_SIZE,
    });
  }

  /**
   * Returns the top-most placement whose drawn border contains a canvas pixel,
   * or null.
   *
   * Prefer this over {@link findPlacementAt} for hover: the dotted selection
   * border is pixel-precise, so testing the tile centre made the hand cursor
   * appear on a corner tile and vanish one tile later while still inside the
   * border.
   */
  private findPlacementAtPoint(point: { x: number; y: number }): SmartObjectPlacement | null {
    // Legacy actors sit on top (they are drawn over the tiles) and are interactive
    // like any other actor, so they are hit-tested first.
    // Hidden objects are not interactive: they are invisible on the canvas, so a
    // click must reach whatever is under them instead.
    for (let i = this._legacyActors.length - 1; i >= 0; i--) {
      const placement = this._legacyActors[i];
      if (!this.isHidden(placement) && this.hitTestPlacement(placement, point)) {
        return placement;
      }
    }
    for (let i = this.smartObjects.length - 1; i >= 0; i--) {
      const placement = this.smartObjects[i];
      if (!this.isHidden(placement) && this.hitTestPlacement(placement, point)) {
        return placement;
      }
    }
    return null;
  }

  /** The pointer position in canvas pixels, or null when outside the canvas. */
  private pixelAt(event: MouseEvent): { x: number; y: number } | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  /**
   * Whether a pixel rectangle contains the pointer.
   *
   * Hover and grabbing use this rather than tile cells: the dotted border is
   * pixel-precise, so a tile-granular test made the hand cursor appear on a
   * corner tile and then vanish as soon as the pointer moved one tile away —
   * even though it was still inside the drawn border.
   */
  private boxContains(
    box: { x: number; y: number; width: number; height: number } | null,
    point: { x: number; y: number } | null,
  ): boolean {
    if (!box || !point) {
      return false;
    }
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    );
  }

  /**
   * Whether a placement's black dotted border encloses a canvas pixel.
   *
   * Uses {@link selectionBox} — the exact rectangle `strokeSelected` draws — so
   * hovering anywhere inside the border shows the hand cursor and clicking there
   * grabs the object. No sprite/tile measurement is involved here beyond what
   * the border itself uses.
   */
  private hitTestPlacement(
    placement: SmartObjectPlacement,
    point: { x: number; y: number },
  ): boolean {
    // Only objects on the active base layer are interactive; the paired top
    // layer belongs to the same base layer, so a single check covers both.
    if ((placement.baseLayerId ?? 0) !== this.layerIndex) {
      return false;
    }
    return this.boxContains(this.selectionBox(placement), point);
  }

  /** Moves a grabbed smart object to follow the pointer. */
  private moveDragged(event: PointerEvent): void {
    const tile = this.tileAt(event);
    const dragging = this.dragging;
    if (!tile || !dragging) {
      return;
    }
    dragging.anchorRow = tile.y - dragging.grabRow;
    dragging.anchorCol = tile.x - dragging.grabCol;
    this.drawPreview();
  }

  /** Commits a grabbed smart object at its new position. */
  private dropDragged(): void {
    const dragging = this.dragging;
    const room = this.room;
    this.dragging = null;
    this.draggingObject.set(false);
    this.clearPreview();
    if (!dragging || !room) {
      return;
    }
    if (dragging.source) {
      // A legacy actor bakes nothing: just report its new anchor and let the host
      // update the legacy list.
      if (this.isLegacy(dragging.source)) {
        const moved: SmartObjectPlacement = {
          ...dragging.source,
          anchorRow: dragging.anchorRow,
          anchorCol: dragging.anchorCol,
        };
        this.legacyMoved.emit({ from: dragging.source, to: moved });
        void this.redraw();
        return;
      }
      // Re-stamp the object at the new anchor (on the placement's own base
      // layer), compositing over the survivors instead of blindly overwriting
      // them: the grab only HID the footprint from the view, so the source is
      // still stamped. Clearing would wipe overlapped neighbours, and for a
      // footprint-changing object (the big door's 6×2 ↔ 2×6 rotation) it would
      // leave the OLD variant's tiles stuck in the room.
      const moved = this.restampPlacement(dragging.source, {
        anchorRow: dragging.anchorRow,
        anchorCol: dragging.anchorCol,
      });
      // A child (e.g. the connecting WARP actor) travels with its parent: keep
      // the children but translate their anchors by the same delta so the
      // connection stays attached to the moved door. Their `actorVariable`
      // (destination) is untouched; the host re-points the OTHER end of the
      // connection via `reanchorConnections` on `decorationMoved`.
      const deltaRow = moved.anchorRow - dragging.source.anchorRow;
      const deltaCol = moved.anchorCol - dragging.source.anchorCol;
      let withChildrenMoved: SmartObjectPlacement = moved;
      if (dragging.source.children && dragging.source.children.length > 0) {
        withChildrenMoved = withChildren(
          moved,
          dragging.source.children.map((child) => ({
            ...child,
            anchorRow: child.anchorRow + deltaRow,
            anchorCol: child.anchorCol + deltaCol,
          })),
        );
      }
      // A TARGET door keeps its back-reference (its source door is re-pointed by
      // the host on `decorationMoved`), so carrying it here keeps the placement
      // "connected" until the host updates both ends.
      if (dragging.source.connectedFrom) {
        withChildrenMoved = { ...withChildrenMoved, connectedFrom: dragging.source.connectedFrom };
      }
      this.decorationMoved.emit({ from: dragging.source, to: withChildrenMoved });
    }
    void this.redraw();
  }

  // --- Drag preview --------------------------------------------------------

  /**
   * Updates which smart object is hovered and repaints the boundary outline on
   * the overlay. The overlay is shared with the drag preview, so the outline is
   * only drawn while nothing is being dragged.
   */
  private updateHover(event: PointerEvent): void {
    if (this.dragging) {
      return;
    }
    // Test the exact pointer pixel, not the tile cell: the dotted border is
    // pixel-precise, so a tile-granular test dropped the hover as soon as the
    // pointer moved one tile while still inside the border.
    const point = this.pixelAt(event);
    this.hoveredPlacement = point ? this.findPlacementAtPoint(point) : null;
    this.drawHoverOutline();
  }

  /**
   * Repaints the overlay: a red box around EVERY placed actor (enemies are easy
   * to lose among the tiles), plus a black dotted outline for the hovered /
   * context-menu target. The overlay is shared with the drag preview, so this is
   * only drawn while nothing is being dragged.
   */
  private drawHoverOutline(): void {
    const canvas = this.previewRef()?.nativeElement;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // While dragging, the overlay belongs to the drag preview (see drawPreview).
    if (this.dragging) {
      return;
    }

    // Draw the in-progress connect line (source door -> cursor).
    if (this.connectingFrom()) {
      this.paintConnectLine(ctx);
    }

    // Draw activation links: the committed ones, plus the live line to the
    // cursor while an activation session is running.
    this.paintActivationLines(ctx);

    // Red markers for **legacy** actors on this layer only — editor-placed
    // objects show nothing until hovered.
    if (this.showMarkers) {
      for (const placement of this.legacyActorsOnLayer()) {
        const box = this.actorBox(placement);
        this.strokeOutline(ctx, box.x, box.y, box.width, box.height, {
          color: '#ef4444',
          dash: [],
        });
      }
    }

    // Black dotted outline for the hovered / selected placement.
    const placement = this.contextMenu()?.placement ?? this.hoveredPlacement;
    if (placement) {
      this.strokeSelected(ctx, placement);
    }

    // The object picked in the object column gets the same permanent highlight
    // as hovering it directly on the canvas, so both selections are visually
    // identical (objects sharing a tile can still be told apart).
    const selected = this.selectedPlacement();
    if (selected && selected !== placement && !this.isHidden(selected)) {
      this.strokeSelected(ctx, selected);
    }
  }

  /** The placement selected in the object column, if it is on this layer. */
  private selectedPlacement(): SmartObjectPlacement | null {
    const key = this._selectedObject;
    if (!key) {
      return null;
    }
    const placement = [...this.smartObjects, ...this._legacyActors].find(
      (entry) => placementKey(entry) === key,
    );
    return placement && this.onThisLayer(placement) ? placement : null;
  }

  /**
   * Strokes the highlight outline of a placement (actor box or tile footprint).
   *
   * This black dotted border is ALSO the object's grab region: hit-testing uses
   * the same box, so anything the border encloses can be clicked.
   */
  /**
   * The pixel rectangle the black dotted selection border is drawn with.
   *
   * SINGLE SOURCE OF TRUTH: `strokeSelected` strokes exactly this rectangle and
   * `hitTestPlacement` grabs exactly this rectangle, so the hand cursor appears
   * over precisely the area the border encloses — border and hit area cannot
   * drift apart.
   */
  private selectionBox(
    placement: SmartObjectPlacement,
  ): { x: number; y: number; width: number; height: number } | null {
    const definition = findSmartObjectDefinition(placement.id);
    if (!definition) {
      return null;
    }
    if (definition.baking === 'actor') {
      return this.actorBox(placement);
    }
    const bounds = smartObjectBounds(
      definition,
      placement.variantIndex ?? 0,
      placement.subTypeIndex ?? 0,
      placement.scale,
    );
    return {
      x: (placement.anchorCol + bounds.minCol) * TILE_SIZE,
      y: (placement.anchorRow + bounds.minRow) * TILE_SIZE,
      width: bounds.cols * TILE_SIZE,
      height: bounds.rows * TILE_SIZE,
    };
  }

  /** Strokes the highlight outline of a placement using {@link selectionBox}. */
  private strokeSelected(
    ctx: CanvasRenderingContext2D,
    placement: SmartObjectPlacement,
    style: { color: string; dash: number[] } = { color: '#000', dash: [3, 3] },
  ): void {
    const box = this.selectionBox(placement);
    if (!box) {
      return;
    }
    this.strokeOutline(ctx, box.x, box.y, box.width, box.height, style);
  }

  /**
   * Pixel box an actor placement's sprite actually occupies.
   *
   * Delegates to {@link StageRenderer.actorBounds}, which accounts for the
   * variant's offsets and the sprite's real size (sprites span several
   * attributes, so large actors cover many tiles). Falls back to a 16×16 box
   * centred on the actor's anchor tile when the sprite cannot be resolved.
   */
  private actorBox(placement: SmartObjectPlacement): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const actor = placementToActor(placement);
    const bounds = this.renderer?.actorBounds(actor, this.gba);
    if (bounds) {
      return bounds;
    }
    return {
      x: actor.X * 8 - TILE_SIZE / 2,
      y: actor.Y * 8 - TILE_SIZE / 2,
      width: TILE_SIZE,
      height: TILE_SIZE,
    };
  }

  /**
   * Records the pointer position during a connect drag and repaints the local
   * overlay.
   *
   * The line leans on the host's stack-wide overlay: once the pointer leaves
   * this canvas the line is drawn there instead (see
   * {@link connectDragChanged}), so this only tracks the local cursor tile.
   */
  private drawConnectLine(event: PointerEvent): void {
    this.connectCursor.set(this.isPointerOverCanvas(event) ? this.tileAt(event) : null);
    this.drawHoverOutline();
  }

  /**
   * Draws the in-progress connect line onto the LOCAL overlay: a dashed line
   * from the source door to the cursor, and a green outline around a valid
   * target door. Only used while the pointer is over this canvas — the
   * cross-layer part of the line is drawn by the host.
   */
  private paintConnectLine(ctx: CanvasRenderingContext2D): void {
    const source = this.connectingFrom();
    if (!source) {
      return;
    }
    const cursor = this.connectCursor();
    if (!cursor) {
      return;
    }
    const sourceDef = findSmartObjectDefinition(source.id);
    const sourceBounds = sourceDef ? smartObjectBounds(sourceDef, source.variantIndex ?? 0) : null;
    const fromX =
      (source.anchorCol + (sourceBounds?.minCol ?? 0) + (sourceBounds?.cols ?? 1) / 2) * TILE_SIZE;
    const fromY =
      (source.anchorRow + (sourceBounds?.minRow ?? 0) + (sourceBounds?.rows ?? 1) / 2) * TILE_SIZE;

    // Outline the source door.
    if (sourceBounds) {
      this.strokeOutline(
        ctx,
        (source.anchorCol + sourceBounds.minCol) * TILE_SIZE,
        (source.anchorRow + sourceBounds.minRow) * TILE_SIZE,
        sourceBounds.cols * TILE_SIZE,
        sourceBounds.rows * TILE_SIZE,
        { color: '#38bdf8', dash: [] },
      );
    }

    const toX = (cursor.x + 0.5) * TILE_SIZE;
    const toY = (cursor.y + 0.5) * TILE_SIZE;

    // The line itself.
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();

    // Highlight a valid target door under the cursor on THIS layer (doors on
    // other layers are highlighted by the host's overlay).
    const target = this.doorAtTile(cursor);
    if (target && target !== source) {
      const targetDef = findSmartObjectDefinition(target.id);
      const tb = targetDef ? smartObjectBounds(targetDef, target.variantIndex ?? 0) : null;
      if (tb) {
        this.strokeOutline(
          ctx,
          (target.anchorCol + tb.minCol) * TILE_SIZE,
          (target.anchorRow + tb.minRow) * TILE_SIZE,
          tb.cols * TILE_SIZE,
          tb.rows * TILE_SIZE,
          { color: '#22c55e', dash: [] },
        );
      }
    }
  }
  /** Strokes a rectangle (crisp 1px) at the given pixel rectangle. */
  private strokeOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    style: { color?: string; dash?: number[] } = {},
  ): void {
    ctx.save();
    ctx.strokeStyle = style.color ?? '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash(style.dash ?? [3, 3]);
    // Offset by 0.5px so the 1px line lands on a pixel centre (crisp).
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  /** Draws the transparent preview of the dragged smart object on the overlay. */
  private drawPreview(): void {
    const canvas = this.previewRef()?.nativeElement;
    const dragging = this.dragging;
    const renderer = this.renderer;
    if (!canvas || !dragging || !renderer) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Keep the red legacy-actor markers visible while dragging (the dragged
    // actor is excluded — its ghost follows the cursor instead).
    if (this.showMarkers) {
      for (const placement of this.legacyActorsOnLayer()) {
        const box = this.actorBox(placement);
        this.strokeOutline(ctx, box.x, box.y, box.width, box.height, {
          color: '#ef4444',
          dash: [],
        });
      }
    }

    // Actor-baked objects draw their actor sprite instead of tiles — unless they
    // also bake tiles (the floor switch: `SWTH` has no sprite, so tile 18 IS its
    // look). Then the tile ghost below is the accurate preview.
    const dragVariant = smartObjectVariant(
      dragging.definition,
      dragging.variantIndex ?? 0,
      dragging.subTypeIndex ?? 0,
    );
    const dragStampsTiles =
      dragVariant.bottomLayerTiles.length > 0 || dragVariant.topLayerTiles.length > 0;
    if (dragging.definition.baking === 'actor' && !dragStampsTiles) {
      // Build the exact actor record the drop would create and draw it through
      // the same renderer path — so the ghost lines up pixel-for-pixel with the
      // placed result (sprites are bottom-centre anchored and may use offsets).
      const actor = placementToActor({
        id: dragging.definition.id,
        baseLayerId: dragging.source?.baseLayerId ?? 0,
        anchorRow: dragging.anchorRow,
        anchorCol: dragging.anchorCol,
        bottomLayerTiles: [],
        topLayerTiles: [],
        actorVariable: dragging.source?.actorVariable ?? dragging.definition.actorVariable ?? 0,
      });
      const scratch = new ImageBuffer(canvas.width, canvas.height);
      scratch.fill(0, 0, 0, 0);
      renderer.drawActorAt(scratch, actor, this.gba);
      const image = new ImageData(
        new Uint8ClampedArray(scratch.pixels),
        scratch.width,
        scratch.height,
      );
      ctx.globalAlpha = 0.5;
      ctx.putImageData(image, 0, 0);
      ctx.globalAlpha = 1;
      return;
    }

    const bounds = smartObjectBounds(
      dragging.definition,
      dragging.variantIndex,
      dragging.subTypeIndex,
      dragging.scale,
    );
    const originX = (dragging.anchorCol + bounds.minCol) * TILE_SIZE;
    const originY = (dragging.anchorRow + bounds.minRow) * TILE_SIZE;

    // Render the object into an offscreen buffer, then blit it at 50% alpha.
    const buffer = renderer.renderSmartObjectPreview(
      dragging.definition,
      this.gba,
      dragging.variantIndex,
      dragging.subTypeIndex,
      dragging.scale,
    );
    const image = new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height);
    ctx.globalAlpha = 0.5;
    ctx.putImageData(image, originX, originY);
    ctx.globalAlpha = 1;
  }

  /** Clears the drag preview overlay, restoring the actor markers/hover outline. */
  private clearPreview(): void {
    const canvas = this.previewRef()?.nativeElement;
    const ctx = canvas?.getContext('2d');
    ctx?.clearRect(0, 0, canvas!.width, canvas!.height);
    this.drawHoverOutline();
  }

  /** Maps a pointer/drag event to the tile coordinate under it, or null. */
  private tileAt(event: MouseEvent): { x: number; y: number } | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const x = Math.floor(canvasX / TILE_SIZE);
    const y = Math.floor(canvasY / TILE_SIZE);
    if (x < 0 || x >= DIMENSION || y < 0 || y >= DIMENSION) {
      return null;
    }
    return { x, y };
  }

  /** Paints the selected ground at the canvas position of the pointer event. */
  private paintAt(event: PointerEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return;
    }

    const tile = this.tileAt(event);
    if (!tile) {
      return;
    }
    const { x, y } = tile;
    const offset = y * DIMENSION + x;

    // Ground brush: paints the selected ground tile into the ground grid for
    // the active base layer. Painting over a decoration is allowed (the ground
    // is still recorded in the stage JSON) — the decoration just keeps drawing
    // on top of it. The grid may not exist yet for this layer, so the host
    // creates it from the emitted change.
    //
    // The brush ONLY paints ground: with no ground selected (or a 0 tile) it is
    // a no-op, so a stray click never stamps a tile.
    if (!this.groundMode || this.groundTile <= 0) {
      return;
    }
    if (this._groundTiles?.[offset] === this.groundTile) {
      return;
    }
    if (this._groundTiles) {
      // Mutate in place when the grid already exists.
      this._groundTiles[offset] = this.groundTile;
    }
    this.groundChanged.emit({
      baseLayerId: this.groundBaseLayerId,
      x,
      y,
      tile: this.groundTile,
    });
    void this.redraw();
  }

  /**
   * Erases the tile under the pointer: both the base layer (`layerIndex`) and
   * its paired top layer (`layerIndex + 8`), plus any ground painted on the
   * active base layer. Smart objects are never erased — a tile owned by a
   * decoration is left untouched.
   */
  private eraseAt(event: PointerEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    const room = this.room;
    if (!canvas || !room) {
      return;
    }

    const tile = this.tileAt(event);
    if (!tile) {
      return;
    }
    const { x, y } = tile;
    const offset = y * DIMENSION + x;

    // Never erase a tile occupied by a smart object.
    if (this.findPlacementAt(tile)) {
      return;
    }

    let changed = false;

    // Base + paired top layer tiles.
    for (const layerIndex of [this.layerIndex, this.layerIndex + 8]) {
      const layer = room.Layers[layerIndex];
      if (layer && layer.Tiles[offset] !== 0) {
        layer.Tiles[offset] = 0;
        this.tileChanged.emit({ layerIndex, x, y, tile: 0 });
        changed = true;
      }
    }

    // Ground painted on the active base layer.
    if (this._groundTiles && this._groundTiles[offset] !== 0) {
      this._groundTiles[offset] = 0;
      this.groundChanged.emit({ baseLayerId: this.groundBaseLayerId, x, y, tile: 0 });
      changed = true;
    }

    if (changed) {
      void this.redraw();
    }
  }
}
