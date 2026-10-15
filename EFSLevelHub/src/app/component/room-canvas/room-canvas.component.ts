import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RoomData } from '../../entity/fsalib.entity';
import { ActorData } from '../../entity/fsalib.entity';
import { ImageBuffer, TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { StageRenderer } from '../../service/render/stage-renderer';
import {
  applySmartObject,
  clearSmartObject,
  findSmartObjectDefinition,
  placementToActor,
  smartObjectBounds,
  smartObjectVariant,
  SmartObjectDefinition,
  SmartObjectPlacement,
  SmartObjectTileOffset,
} from '../../entity/smartobject.entity';
import { SmartObjectDragService } from '../../service/smart-object-drag.service';

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

/** Room layer grid dimension (32×32 tiles). */
const DIMENSION = 32;

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
  templateUrl: './room-canvas.component.html',
})
export class RoomCanvasComponent implements AfterViewInit {
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

  /**
   * The actor-baked placements in this room, as {@link ActorData} records —
   * derived from {@link smartObjects} so enemies need no separate input.
   *
   * The placement currently being dragged with the hand tool is omitted, so the
   * grabbed sprite disappears from its old cell while it follows the cursor
   * (tile-baked objects achieve the same by clearing their stamped tiles).
   */
  private get actors(): ActorData[] {
    const draggingSource = this.dragging?.source ?? null;
    const actors: ActorData[] = [];
    for (const placement of this._smartObjects) {
      if (placement === draggingSource) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (definition?.baking === 'actor') {
        actors.push(placementToActor(placement));
      }
    }
    return actors;
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

  /** Emits when a placed decoration is rotated to the next variant. */
  @Output() decorationRotated = new EventEmitter<{
    from: SmartObjectPlacement;
    to: SmartObjectPlacement;
  }>();

  /** The canvas element the room is drawn onto. */
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  /** The transparent overlay canvas used for drag previews. */
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');

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
    /** True while the pointer is over the canvas. */
    active: boolean;
  } | null = null;

  /** True while the hand tool is hovering a placed smart object (grab cursor). */
  readonly hoveringObject = signal(false);

  /** True while a smart object is being dragged with the hand tool. */
  readonly draggingObject = signal(false);

  /** Smart object currently hovered by the pointer (for its boundary outline). */
  private hoveredPlacement: SmartObjectPlacement | null = null;

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

  ngAfterViewInit(): void {
    void this.redraw();
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

    const width = canvas.width;
    const height = canvas.height;
    const buffer = new ImageBuffer(width, height);
    buffer.fill(0, 0, 0, 255);

    // Ground acts as the base layer: it is drawn first, and the room's base
    // tiles are skipped wherever ground is painted — except on tiles covered by
    // a smart object (a decoration always keeps its own stamped tiles).
    const skip = this.groundTiles ? this.groundSkipSet() : undefined;
    if (this.groundTiles) {
      renderer.drawGround(buffer, this.groundTiles, this.gba);
    }
    renderer.drawSingleLayer(buffer, this.index, this.layerIndex, this.gba, skip);
    if (this.topLayer) {
      renderer.drawSingleLayer(buffer, this.index, this.layerIndex + 8, this.gba);
    }

    // Actors (enemies) on the active layer, drawn over the tiles.
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
    const image = new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height);
    ctx.putImageData(image, 0, 0);
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
    for (const placement of this.smartObjects) {
      if (placement.baseLayerId !== this.groundBaseLayerId) {
        continue;
      }
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(definition, placement.variantIndex ?? 0);
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

  /** Starts painting/erasing, or grabs a smart object when the hand tool is active. */
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    (event.target as HTMLElement).setPointerCapture(event.pointerId);

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

  /** Stops painting / drops a grabbed smart object. */
  onPointerUp(event: PointerEvent): void {
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (this.dragging) {
      this.dropDragged();
      return;
    }
    this.painting = false;
    this.hoveringObject.set(false);
  }

  /** Hides the hover outline when the pointer leaves the canvas. */
  onPointerLeaveCanvas(event: PointerEvent): void {
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
    this.contextMenu.set(placement ? { placement, x, y } : null);
    this.drawHoverOutline();
  }

  /** Closes the context menu. */
  closeContextMenu(): void {
    this.contextMenu.set(null);
    this.drawHoverOutline();
  }

  /** Deletes the smart object targeted by the context menu. */
  deleteContextPlacement(): void {
    const placement = this.contextMenu()?.placement;
    if (!placement || !this.room) {
      return;
    }
    // Remove the stamped tiles so the object disappears from the canvas, then
    // let the host drop the placement from the stage JSON.
    clearSmartObject(placement, this.room.Layers, placement.baseLayerId);
    // Re-stamp every remaining smart object so tiles that this one had covered
    // (overlapping objects) come back correctly.
    this.redrawSmartObjects({ list: this.smartObjects, skip: [placement] });
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    this.decorationDeleted.emit(placement);
    this.drawHoverOutline();
    void this.redraw();
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
    return (findSmartObjectDefinition(placement.id)?.set.length ?? 0) > 1;
  }

  /**
   * Rotates the smart object targeted by the context menu to the next variant in
   * its definition's `set`. Clears the current tiles, re-stamps the next variant
   * at the same anchor and emits the change so the host updates the stage JSON.
   */
  rotateContextPlacement(): void {
    const from = this.contextMenu()?.placement;
    const room = this.room;
    if (!from || !room) {
      return;
    }
    const definition = findSmartObjectDefinition(from.id);
    if (!definition || definition.set.length <= 1) {
      return;
    }
    const nextVariant = ((from.variantIndex ?? 0) + 1) % definition.set.length;
    // Re-stamp the next variant at the same anchor, keeping the same stacking.
    const rotated = { ...from, variantIndex: nextVariant };
    const list = this.smartObjects.map((placement) => (placement === from ? rotated : placement));
    this.redrawSmartObjects({ list, skip: [from] });
    this.contextMenu.set(null);
    this.hoveredPlacement = null;
    this.decorationRotated.emit({ from, to: rotated });
    this.drawHoverOutline();
    void this.redraw();
  }

  /**
   * Re-stamps every placed smart object onto the room layers, except `skip`.
   *
   * Each placement records its own definition id + anchor + absolute tiles, so
   * clearing and re-applying them restores the correct composite (useful after a
   * deletion, where the removed object's tiles must not leave holes in objects
   * that overlapped it).
   */
  private redrawSmartObjects(override?: {
    list: SmartObjectPlacement[];
    skip: SmartObjectPlacement[];
  }): void {
    const room = this.room;
    if (!room) {
      return;
    }
    const source = override ? override.list : this.smartObjects;
    const skip = override ? override.skip : [];
    // The placements that will remain stamped, in their stored order (later
    // ones draw on top of earlier ones at shared tiles).
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
      const variant = smartObjectVariant(definition, placement.variantIndex ?? 0);
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
    // survivor still claims. The footprint is derived from each placement's
    // definition (same as `claimed`), NOT its recorded refs, so the two stay
    // consistent even when the refs have drifted (rotate/move/loaded JSON).
    for (const placement of source) {
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      const variant = smartObjectVariant(definition, placement.variantIndex ?? 0);
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
      );
    }
  }

  // --- Smart object drag & drop (from the toolbox) -------------------------

  /** Allows dropping a smart object onto the canvas, showing a live preview. */
  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-smart-object')) {
      return;
    }
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
  }

  /**
   * Places the dragged smart object: bakes its tiles onto the room layers (or,
   * for an actor-baked object, its actor) at the drop position, and emits the
   * resulting placement so the host can record it in the stage JSON.
   */
  onDrop(event: DragEvent): void {
    const id =
      event.dataTransfer?.getData('application/x-smart-object') ??
      this.dragging?.definition.id ??
      this.dragService.definition()?.id;
    const room = this.room;
    const dragging = this.dragging;
    if (!id || !room) {
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
    const anchorRow = dragging?.anchorRow ?? tile.y;
    const anchorCol = dragging?.anchorCol ?? tile.x;

    const placement = applySmartObject(
      definition,
      anchorRow,
      anchorCol,
      room.Layers,
      this.layerIndex,
      dragging?.variantIndex ?? 0,
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
    if (!room || !tile) {
      return;
    }
    const placement = this.findPlacementAt(tile);
    const definition = placement ? findSmartObjectDefinition(placement.id) : null;
    if (!placement || !definition) {
      return;
    }
    // Clear the original tiles right away so the object is *grabbed* in the
    // view (it follows the cursor) rather than copied and removed on drop.
    // Use the placement's OWN base layer (not the viewed layer) so grabbing an
    // object on another base layer does not wipe tiles on the wrong layers.
    clearSmartObject(placement, room.Layers, placement.baseLayerId);
    // Set `dragging` BEFORE redrawing: the actor-baked sprite is excluded from
    // the rendered actor list while it is being dragged (tile-baked objects
    // disappear via the tile clear above).
    this.dragging = {
      definition,
      source: placement,
      grabRow: tile.y - placement.anchorRow,
      grabCol: tile.x - placement.anchorCol,
      anchorRow: placement.anchorRow,
      anchorCol: placement.anchorCol,
      variantIndex: placement.variantIndex ?? 0,
      active: true,
    };
    void this.redraw();
    this.draggingObject.set(true);
    this.hoveringObject.set(false);
    this.drawPreview();
  }

  /** Returns the top-most placement covering a tile, or null. */
  private findPlacementAt(tile: { x: number; y: number }): SmartObjectPlacement | null {
    for (let i = this.smartObjects.length - 1; i >= 0; i--) {
      const placement = this.smartObjects[i];
      const definition = findSmartObjectDefinition(placement.id);
      if (!definition) {
        continue;
      }
      // Actor-baked objects bake no tiles: their sprite straddles the anchor
      // tile's right/bottom halves (drawn at +8/-8), so hit-test the 2×2 cells
      // around the anchor — the sprite is always inside that area, matching
      // where the user sees and grabs it.
      if (definition.baking === 'actor') {
        if (
          (tile.x === placement.anchorCol || tile.x === placement.anchorCol + 1) &&
          (tile.y === placement.anchorRow || tile.y === placement.anchorRow - 1)
        ) {
          return placement;
        }
        continue;
      }
      const bounds = smartObjectBounds(definition, placement.variantIndex ?? 0);
      if (
        tile.y >= placement.anchorRow + bounds.minRow &&
        tile.y <= placement.anchorRow + bounds.maxRow &&
        tile.x >= placement.anchorCol + bounds.minCol &&
        tile.x <= placement.anchorCol + bounds.maxCol
      ) {
        return placement;
      }
    }
    return null;
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
      // The old tiles were already cleared when the grab started, so just
      // re-stamp at the new anchor (on the placement's own base layer) and
      // report the move.
      const moved = applySmartObject(
        dragging.definition,
        dragging.anchorRow,
        dragging.anchorCol,
        room.Layers,
        dragging.source.baseLayerId,
        dragging.variantIndex,
      );
      this.decorationMoved.emit({ from: dragging.source, to: moved });
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
    const tile = this.tileAt(event);
    this.hoveredPlacement = tile ? this.findPlacementAt(tile) : null;
    this.drawHoverOutline();
  }

  /**
   * Draws a black dotted rectangle around the smart object's bounds. The
   * context-menu target takes precedence (so the selected object stays outlined
   * while the menu is open); otherwise the hovered one is outlined.
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

    const placement = this.contextMenu()?.placement ?? this.hoveredPlacement;
    if (!placement) {
      return;
    }
    const definition = findSmartObjectDefinition(placement.id);
    if (!definition) {
      return;
    }
    // Actor-baked objects: the sprite is drawn at exactly (X*8 + 8, Y*8 - 8) —
    // the same anchor (and same +8/-8 nudge) `drawActorAt` uses — and occupies
    // one 16px cell from there. Box that cell so the outline sits on the sprite.
    if (definition.baking === 'actor') {
      const actor = placementToActor(placement);
      this.strokeOutline(
        ctx,
        actor.X * 8 + 8 - TILE_SIZE / 2,
        actor.Y * 8 - 8 - TILE_SIZE / 2,
        TILE_SIZE,
        TILE_SIZE,
      );
      return;
    }
    const bounds = smartObjectBounds(definition, placement.variantIndex ?? 0);
    const width = bounds.cols * TILE_SIZE;
    const height = bounds.rows * TILE_SIZE;
    const x = (placement.anchorCol + bounds.minCol) * TILE_SIZE;
    const y = (placement.anchorRow + bounds.minRow) * TILE_SIZE;
    this.strokeOutline(ctx, x, y, width, height);
  }

  /** Strokes a dotted rectangle (crisp 1px) at the given pixel rectangle. */
  private strokeOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    // Offset by 0.5px so the 1px dotted line lands on a pixel centre (crisp).
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

    // Actor-baked objects draw their actor sprite instead of tiles.
    if (dragging.definition.baking === 'actor') {
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

    const bounds = smartObjectBounds(dragging.definition, dragging.variantIndex);
    const originX = (dragging.anchorCol + bounds.minCol) * TILE_SIZE;
    const originY = (dragging.anchorRow + bounds.minRow) * TILE_SIZE;

    // Render the object into an offscreen buffer, then blit it at 50% alpha.
    const buffer = renderer.renderSmartObjectPreview(
      dragging.definition,
      this.gba,
      dragging.variantIndex,
    );
    const image = new ImageData(new Uint8ClampedArray(buffer.pixels), buffer.width, buffer.height);
    ctx.globalAlpha = 0.5;
    ctx.putImageData(image, originX, originY);
    ctx.globalAlpha = 1;
  }

  /** Clears the drag preview overlay. */
  private clearPreview(): void {
    const canvas = this.previewRef()?.nativeElement;
    const ctx = canvas?.getContext('2d');
    ctx?.clearRect(0, 0, canvas!.width, canvas!.height);
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
