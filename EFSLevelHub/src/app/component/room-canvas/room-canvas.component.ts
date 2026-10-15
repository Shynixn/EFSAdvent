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
import { ImageBuffer, TILE_SIZE } from '../../service/render/gba-tile-renderer';
import { StageRenderer } from '../../service/render/stage-renderer';
import {
  applySmartObject,
  clearSmartObject,
  findSmartObjectDefinition,
  smartObjectBounds,
  SmartObjectDefinition,
  SmartObjectPlacement,
} from '../../entity/smart-object.entity';
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

  /** Active tool: `brush` paints tiles, `hand` moves placed smart objects. */
  @Input() tool: 'brush' | 'hand' = 'brush';

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

  private _groundTiles: number[] | null = null;
  /**
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
    /** True while the pointer is over the canvas. */
    active: boolean;
  } | null = null;

  /** True while the hand tool is hovering a placed smart object (grab cursor). */
  readonly hoveringObject = signal(false);

  /** True while a smart object is being dragged with the hand tool. */
  readonly draggingObject = signal(false);

  /** Smart object currently hovered by the pointer (for its boundary outline). */
  private hoveredPlacement: SmartObjectPlacement | null = null;

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
    // ground never hides a decoration.
    const owned = new Set<number>();
    for (const placement of this.smartObjects) {
      if (placement.baseLayerId !== this.groundBaseLayerId) {
        continue;
      }
      for (const ref of placement.bottomLayerTiles) {
        owned.add(ref.row * DIMENSION + ref.col);
      }
    }
    for (let offset = 0; offset < ground.length; offset++) {
      if (ground[offset] !== 0 && !owned.has(offset)) {
        skip.add(offset);
      }
    }
    return skip;
  }

  /** Starts painting, or grabs a smart object when the hand tool is active. */
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
    this.paintAt(event);
  }

  /** Continues painting / moves a grabbed smart object. */
  onPointerMove(event: PointerEvent): void {
    if (this.dragging) {
      this.moveDragged(event);
      return;
    }
    if (this.painting) {
      this.updateHover(event);
      this.paintAt(event);
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
    this.clearPreview();
    this.onPointerUp(event);
  }

  /** Prevents the browser context menu on right click. */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  // --- Smart object drag & drop (from the toolbox) -------------------------

  /** Allows dropping a decoration onto the canvas, showing a live preview. */
  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('application/x-smart-object')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    // dragover cannot read the data payload, so the toolbox exposes the dragged
    // definition through the shared service.
    const definition = this.dragService.dragging();
    if (!definition) {
      return;
    }
    const tile = this.tileAt(event);
    if (!tile) {
      return;
    }
    // Anchor the preview so the object's bounding box is centered under the
    // cursor (feels natural when dragging a whole decoration).
    const bounds = smartObjectBounds(definition);
    const anchorRow = tile.y - Math.floor((bounds.rows - 1) / 2);
    const anchorCol = tile.x - Math.floor((bounds.cols - 1) / 2);
    this.dragging = {
      definition,
      source: null,
      grabRow: 0,
      grabCol: 0,
      anchorRow,
      anchorCol,
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
   * Places the dragged decoration: stamps its tiles onto the room layers at the
   * drop position and emits the resulting placement so the host can record it in
   * the stage JSON.
   */
  onDrop(event: DragEvent): void {
    const id =
      event.dataTransfer?.getData('application/x-smart-object') ?? this.dragging?.definition.id;
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
    );
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
    clearSmartObject(placement, room.Layers, this.layerIndex);
    void this.redraw();
    this.dragging = {
      definition,
      source: placement,
      grabRow: tile.y - placement.anchorRow,
      grabCol: tile.x - placement.anchorCol,
      anchorRow: placement.anchorRow,
      anchorCol: placement.anchorCol,
      active: true,
    };
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
      const bounds = smartObjectBounds(definition);
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
      // re-stamp at the new anchor and report the move.
      const moved = applySmartObject(
        dragging.definition,
        dragging.anchorRow,
        dragging.anchorCol,
        room.Layers,
        this.layerIndex,
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

  /** Draws a black dotted rectangle around the hovered smart object's bounds. */
  private drawHoverOutline(): void {
    const canvas = this.previewRef()?.nativeElement;
    const placement = this.hoveredPlacement;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!placement) {
      return;
    }
    const definition = findSmartObjectDefinition(placement.id);
    if (!definition) {
      return;
    }
    const bounds = smartObjectBounds(definition);
    const x = (placement.anchorCol + bounds.minCol) * TILE_SIZE;
    const y = (placement.anchorRow + bounds.minRow) * TILE_SIZE;
    const w = bounds.cols * TILE_SIZE;
    const h = bounds.rows * TILE_SIZE;

    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    // Offset by 0.5px so the 1px dotted line lands on a pixel centre (crisp).
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  /** Draws the transparent preview of the dragged decoration on the overlay. */
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

    const bounds = smartObjectBounds(dragging.definition);
    const originX = (dragging.anchorCol + bounds.minCol) * TILE_SIZE;
    const originY = (dragging.anchorRow + bounds.minRow) * TILE_SIZE;

    // Render the decoration into an offscreen buffer, then blit it at 50% alpha.
    const buffer = renderer.renderSmartObjectPreview(dragging.definition, this.gba);
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

  /** Paints the selected tile at the canvas position of the pointer event. */
  private paintAt(event: PointerEvent): void {
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

    // Ground brush: paints the selected ground tile into the ground grid for
    // the active base layer. Painting over a decoration is allowed (the ground
    // is still recorded in the stage JSON) — the decoration just keeps drawing
    // on top of it. The grid may not exist yet for this layer, so the host
    // creates it from the emitted change.
    if (this.groundMode && this.groundTile > 0) {
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
      return;
    }

    // Paint onto the base layer, or its paired top layer (index + 8) when the
    // "edit top layer" toggle is on.
    const targetLayerIndex = this.paintTop ? this.layerIndex + 8 : this.layerIndex;
    const layer = room.Layers[targetLayerIndex];
    if (!layer) {
      return;
    }
    if (layer.Tiles[offset] === this.tile) {
      return;
    }

    // Mutate the layer in place and repaint the affected tile.
    layer.Tiles[offset] = this.tile;
    this.tileChanged.emit({ layerIndex: targetLayerIndex, x, y, tile: this.tile });
    void this.redraw();
  }
}
